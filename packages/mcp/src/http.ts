import { createHash, timingSafeEqual } from "node:crypto";
import { createMcpHandler } from "@modelcontextprotocol/server";
import {
  createMcpServer,
  ReceiptRepository,
  type McpServerOptions,
} from "./index.js";

const DEFAULT_MAX_BODY_BYTES = 262_144;
const DEFAULT_DEADLINE_MS = 30_000;
export interface HttpAuthorization {
  authorize(
    token: string,
    request: Request,
    signal: AbortSignal,
  ): Promise<boolean> | boolean;
}
export interface HttpHandlerOptions extends McpServerOptions {
  readonly bearerToken?: string;
  readonly authorization?: HttpAuthorization;
  readonly allowedHosts?: readonly string[];
  readonly allowedOrigins?: readonly string[];
  readonly maxBodyBytes?: number;
  readonly maxConcurrency?: number;
  readonly deadlineMs?: number;
}

/**
 * Strict, stateless, modern-only Streamable HTTP wrapper. The caller mounts
 * this handler behind a loopback listener by default; it never trusts forwarded
 * headers or implements OAuth itself.
 */
export function createHttpHandler(options: HttpHandlerOptions): {
  fetch(request: Request): Promise<Response>;
  close(): Promise<void>;
} {
  if (!options.bearerToken && !options.authorization)
    throw new TypeError("HTTP requires bearer authentication");
  if (options.bearerToken !== undefined && options.bearerToken.length < 16)
    throw new RangeError("bearer token must be at least 16 characters");
  const maxBodyBytes = bounded(
    options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
    1,
    1_000_000,
    "maxBodyBytes",
  );
  const maxConcurrency = bounded(
    options.maxConcurrency ?? 32,
    1,
    128,
    "maxConcurrency",
  );
  const deadlineMs = bounded(
    options.deadlineMs ?? DEFAULT_DEADLINE_MS,
    1,
    60_000,
    "deadlineMs",
  );
  const allowedHosts = new Set(
    (options.allowedHosts ?? ["localhost", "127.0.0.1", "[::1]"]).map(
      normalizeHost,
    ),
  );
  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  // MCP v2 creates a server per stateless exchange. Keep receipts in one
  // bounded repository and scope them to the authenticated bearer credential,
  // never to caller-provided tool fields such as tenantId.
  const receipts =
    options.receiptStore ??
    new ReceiptRepository(options.maxReceipts ?? 100, options.now);
  const handler = createMcpHandler(
    (context) =>
      createMcpServer({
        ...options,
        receiptStore: receipts,
        receiptScope: scopeForBearer(
          context.requestInfo?.headers.get("authorization"),
        ),
      }),
    {
      legacy: "reject",
      responseMode: "json",
      maxSubscriptions: 0,
      keepAliveMs: 0,
    },
  );
  let active = 0;
  return {
    async fetch(request: Request): Promise<Response> {
      if (active >= maxConcurrency) return reject(429, "CONCURRENCY_LIMIT");
      active += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), deadlineMs);
      const abort = () => controller.abort();
      request.signal.addEventListener("abort", abort, { once: true });
      try {
        const basic = validateRequest(
          request,
          allowedHosts,
          allowedOrigins,
          maxBodyBytes,
        );
        if (basic) return basic;
        const auth = await authorized(request, options, controller.signal);
        if (!auth)
          return reject(401, "UNAUTHORIZED", { "www-authenticate": "Bearer" });
        const bytes = await readBody(request, controller.signal, maxBodyBytes);
        if (controller.signal.aborted) return reject(408, "DEADLINE_EXCEEDED");
        const forwarded = new Request(request.url, {
          method: "POST",
          headers: request.headers,
          body: Buffer.from(bytes) as unknown as BodyInit,
          signal: controller.signal,
        });
        const response = await handler.fetch(forwarded);
        return secure(response);
      } catch (error) {
        return reject(
          controller.signal.aborted
            ? 408
            : error instanceof RangeError
              ? 413
              : 400,
          controller.signal.aborted
            ? "DEADLINE_EXCEEDED"
            : error instanceof RangeError
              ? "BODY_TOO_LARGE"
              : "MALFORMED_REQUEST",
        );
      } finally {
        clearTimeout(timer);
        request.signal.removeEventListener("abort", abort);
        active -= 1;
      }
    },
    close: () => handler.close(),
  };
}
function validateRequest(
  request: Request,
  hosts: Set<string>,
  origins: Set<string>,
  maxBody: number,
): Response | undefined {
  const url = new URL(request.url);
  if (url.username || url.password)
    return reject(400, "URL_CREDENTIALS_FORBIDDEN");
  if (request.method !== "POST")
    return reject(405, "METHOD_NOT_ALLOWED", { allow: "POST" });
  const host = request.headers.get("host");
  if (!host || host.includes(",") || !hosts.has(normalizeHost(host)))
    return reject(421, "HOST_FORBIDDEN");
  const origin = request.headers.get("origin");
  if (origin && (origin.includes(",") || !origins.has(origin)))
    return reject(403, "ORIGIN_FORBIDDEN");
  const auth = request.headers.get("authorization");
  if (!auth || auth.includes(","))
    return reject(401, "UNAUTHORIZED", { "www-authenticate": "Bearer" });
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/iu.test(contentType))
    return reject(415, "CONTENT_TYPE_REQUIRED");
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/u.test(length) || Number(length) > maxBody))
    return reject(413, "BODY_TOO_LARGE");
  if (request.headers.get("transfer-encoding"))
    return reject(400, "CHUNKED_BODY_FORBIDDEN");
  if (!acceptsJson(request.headers.get("accept")))
    return reject(406, "ACCEPT_NOT_SUPPORTED");
  return undefined;
}
async function authorized(
  request: Request,
  options: HttpHandlerOptions,
  signal: AbortSignal,
): Promise<boolean> {
  const token = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/iu, "");
  if (
    !token ||
    !/^Bearer\s+[^\s]+$/iu.test(request.headers.get("authorization") ?? "")
  )
    return false;
  if (
    options.bearerToken !== undefined &&
    !sameSecret(token, options.bearerToken)
  )
    return false;
  return options.authorization
    ? Boolean(
        await abortable(
          Promise.resolve(
            options.authorization.authorize(token, request, signal),
          ),
          signal,
        ),
      )
    : true;
}
/** Races injected work against both the request caller and handler deadline. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("aborted"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(new Error("aborted"));
    };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}
function sameSecret(left: string, right: string): boolean {
  // Always compare fixed-size values: unlike a direct timingSafeEqual call,
  // unequal token lengths do not take an observable early-return path.
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}
function acceptsJson(value: string | null): boolean {
  if (value === null || value.trim() === "") return true;
  let acceptable = false;
  for (const part of value.split(",")) {
    const pieces = part.split(";").map((piece) => piece.trim());
    const media = pieces.shift()?.toLowerCase();
    if (
      media !== "application/json" &&
      media !== "application/*" &&
      media !== "*/*"
    )
      continue;
    let quality = 1;
    for (const parameter of pieces) {
      const match = /^q\s*=\s*(?:"([^"]+)"|([^\s]+))$/iu.exec(parameter);
      if (!match) continue;
      const value = match[1] ?? match[2];
      if (
        value === undefined ||
        !/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/u.test(value)
      )
        return false;
      quality = Number(value);
    }
    if (quality > 0) acceptable = true;
  }
  return acceptable;
}

function scopeForBearer(authorization: string | null | undefined): string {
  // The outer boundary has already verified this exact bearer syntax. Hash it
  // so neither a receipt key nor an in-memory map reveals credential material.
  const token = authorization?.replace(/^Bearer\s+/iu, "") ?? "invalid";
  return `http:${createHash("sha256").update(token, "utf8").digest("base64url")}`;
}
async function readBody(
  request: Request,
  signal: AbortSignal,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let rejectAbort: ((reason?: unknown) => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const abort = () => {
    void reader.cancel();
    rejectAbort?.(new Error("aborted"));
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new Error("aborted");
      const next = await Promise.race([reader.read(), aborted]);
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new RangeError("body too large");
      }
      chunks.push(next.value);
    }
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  const result = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/:\d+$/u, "");
}
function bounded(
  value: number,
  min: number,
  max: number,
  label: string,
): number {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new RangeError(`${label} is out of range`);
  return value;
}
function reject(
  status: number,
  code: string,
  headers: Record<string, string> = {},
): Response {
  return secure(
    new Response(JSON.stringify({ code }), {
      status,
      headers: { "content-type": "application/json", ...headers },
    }),
  );
}
function secure(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

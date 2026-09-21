import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type {
  DecisionProvider,
  DecisionRequest,
  DecisionResponse,
  DecisionUsage,
  EvaluateOptions,
  ProviderCapabilities,
} from "@mokimeow/jev-fabric-protocol";
import {
  type DnsResolver,
  type EndpointConnectionPlan,
  EndpointPolicy,
  EndpointPolicyError,
} from "./endpoint-policy.js";
import {
  buildCompatiblePrompt,
  buildCompatibleResponseFormat,
} from "./prompt.js";
import {
  extractCompatibleResponse,
  parseCompatibleAnswers,
} from "./response.js";

export interface OpenAICompatibleMappedResult {
  readonly response: DecisionResponse;
  readonly usage?: DecisionUsage;
}

export type OpenAICompatibleErrorCategory =
  | "authentication"
  | "authorization"
  | "invalid_request"
  | "rate_limited"
  | "unavailable"
  | "timeout"
  | "cancelled"
  | "invalid_response"
  | "configuration"
  | "network";
export class OpenAICompatibleProviderError extends Error {
  readonly name = "OpenAICompatibleProviderError";
  constructor(
    readonly category: OpenAICompatibleErrorCategory,
    readonly retryable: boolean,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(`OpenAI-compatible provider ${category.replaceAll("_", " ")}`);
  }
}
export interface CompatibleAttempt {
  readonly requestId: string;
  readonly attempt: number;
  readonly outcome: "succeeded" | "failed" | "cancelled";
}
/** A transport is deliberately passed an address-pinned plan, never a URL string. */
export interface CompatibleTransport {
  execute(
    plan: EndpointConnectionPlan,
    init: RequestInit,
    maximumResponseBytes: number,
  ): Promise<Response>;
}
/**
 * Node production transport. It connects to the plan's resolved address while
 * retaining the original HTTPS SNI, certificate hostname verification, and Host.
 * Callers that inject a transport own this same connection-binding boundary.
 */
export class PinnedNodeTransport implements CompatibleTransport {
  execute(
    plan: EndpointConnectionPlan,
    init: RequestInit,
    maximum: number,
  ): Promise<Response> {
    return new Promise((resolve, reject) => {
      const headers = new Headers(init.headers);
      headers.set("host", plan.hostHeader);
      const port =
        plan.url.port === ""
          ? plan.url.protocol === "https:"
            ? 443
            : 80
          : Number(plan.url.port);
      const request = (
        plan.url.protocol === "https:" ? httpsRequest : httpRequest
      )(
        {
          protocol: plan.url.protocol,
          hostname: plan.address,
          port,
          path: `${plan.url.pathname}${plan.url.search}`,
          method: init.method,
          headers: Object.fromEntries(headers.entries()),
          signal: init.signal ?? undefined,
          ...(plan.url.protocol === "https:"
            ? { servername: plan.serverName, rejectUnauthorized: true }
            : {}),
        },
        (response) => {
          const length = response.headers["content-length"];
          if (
            typeof length === "string" &&
            (!/^\d+$/.test(length) || Number(length) > maximum)
          ) {
            response.destroy();
            reject(new TypeError("response body too large"));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > maximum)
              response.destroy(new TypeError("response body too large"));
            else chunks.push(chunk);
          });
          response.on("error", reject);
          response.on("end", () => {
            const responseHeaders = new Headers();
            for (const [name, value] of Object.entries(response.headers))
              if (value !== undefined)
                responseHeaders.set(
                  name,
                  Array.isArray(value) ? value.join(", ") : value,
                );
            resolve(
              new Response(Buffer.concat(chunks), {
                status: response.statusCode ?? 502,
                ...(response.statusMessage === undefined
                  ? {}
                  : { statusText: response.statusMessage }),
                headers: responseHeaders,
              }),
            );
          });
        },
      );
      request.on("error", reject);
      if (typeof init.body === "string") request.end(init.body);
      else request.end();
    });
  }
}
export interface OpenAICompatibleProviderOptions {
  readonly id: string;
  readonly endpoint: string;
  readonly model: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly transport?: CompatibleTransport;
  readonly resolve: DnsResolver;
  readonly allowLoopbackHttp?: boolean;
  readonly allowedPorts?: readonly number[];
  readonly maxRedirects?: number;
  readonly repairAttempts?: number;
  readonly maxResponseBytes?: number;
  readonly onAttempt?: (attempt: CompatibleAttempt) => void;
  /** Request strict JSON Schema output from compatible endpoints that support it. */
  readonly structuredOutput?: boolean;
  /** Optional upstream sampling temperature; zero is appropriate for evaluation. */
  readonly temperature?: number;
  /** Optional one-hot constraint for small local models that cannot add reliably. */
  readonly probabilityMode?: "continuous" | "one_hot";
}

export interface OpenAICompatibleExecutionPolicy {
  readonly maxRedirects: number;
  readonly repairAttempts: number;
  readonly structuredOutput: boolean;
  readonly temperature: number | null;
  readonly probabilityMode: "continuous" | "one_hot";
}

export class OpenAICompatibleProvider implements DecisionProvider {
  readonly capabilities: ProviderCapabilities = {
    questionTypes: ["choice", "noul", "score"],
    probabilitySemantics: ["self_reported"],
    maxQuestions: 100,
  };
  readonly id: string;
  readonly #executionPolicy: OpenAICompatibleExecutionPolicy;
  readonly #endpoint: string;
  readonly #model: string;
  readonly #headers: Readonly<Record<string, string>>;
  readonly #transport: CompatibleTransport;
  readonly #policy: EndpointPolicy;
  readonly #maxRedirects: number;
  readonly #repairAttempts: number;
  readonly #maxResponseBytes: number;
  readonly #onAttempt: ((attempt: CompatibleAttempt) => void) | undefined;
  readonly #structuredOutput: boolean;
  readonly #temperature: number | undefined;
  readonly #probabilityMode: "continuous" | "one_hot";
  constructor(options: OpenAICompatibleProviderOptions) {
    if (
      !options.id ||
      !options.endpoint ||
      !options.model ||
      !Number.isSafeInteger(options.repairAttempts ?? 0) ||
      (options.repairAttempts ?? 0) < 0 ||
      !Number.isSafeInteger(options.maxRedirects ?? 2) ||
      (options.maxRedirects ?? 2) < 0 ||
      !Number.isSafeInteger(options.maxResponseBytes ?? 1_000_000) ||
      (options.maxResponseBytes ?? 1_000_000) < 1 ||
      (options.temperature !== undefined &&
        (!Number.isFinite(options.temperature) ||
          options.temperature < 0 ||
          options.temperature > 2)) ||
      (options.probabilityMode !== undefined &&
        options.probabilityMode !== "continuous" &&
        options.probabilityMode !== "one_hot")
    )
      throw new OpenAICompatibleProviderError("configuration", false);
    this.id = options.id;
    this.#endpoint = options.endpoint;
    this.#model = options.model;
    this.#headers = options.headers ?? {};
    this.#transport = options.transport ?? new PinnedNodeTransport();
    this.#policy = new EndpointPolicy({
      resolve: options.resolve,
      ...(options.allowLoopbackHttp === undefined
        ? {}
        : { allowLoopbackHttp: options.allowLoopbackHttp }),
      ...(options.allowedPorts === undefined
        ? {}
        : { allowedPorts: options.allowedPorts }),
    });
    this.#maxRedirects = options.maxRedirects ?? 2;
    this.#repairAttempts = options.repairAttempts ?? 0;
    this.#executionPolicy = Object.freeze({
      maxRedirects: this.#maxRedirects,
      repairAttempts: this.#repairAttempts,
      structuredOutput: options.structuredOutput === true,
      temperature: options.temperature ?? null,
      probabilityMode: options.probabilityMode ?? "continuous",
    });
    this.#maxResponseBytes = options.maxResponseBytes ?? 1_000_000;
    this.#onAttempt = options.onAttempt;
    this.#structuredOutput = options.structuredOutput === true;
    this.#temperature = options.temperature;
    this.#probabilityMode = options.probabilityMode ?? "continuous";
  }
  /** Immutable, inspectable transport multiplicity controls. */
  get executionPolicy(): OpenAICompatibleExecutionPolicy {
    return this.#executionPolicy;
  }
  /** Private-brand-checked policy proof for trusted harnesses. */
  static executionPolicyOf(
    provider: OpenAICompatibleProvider,
  ): OpenAICompatibleExecutionPolicy {
    return provider.#executionPolicy;
  }
  async evaluate(
    request: DecisionRequest,
    options?: EvaluateOptions,
  ): Promise<DecisionResponse> {
    return (await this.evaluateWithMetadata(request, options)).response;
  }
  async evaluateWithMetadata(
    request: DecisionRequest,
    options?: EvaluateOptions,
  ): Promise<OpenAICompatibleMappedResult> {
    if (
      options?.deadlineMs !== undefined &&
      (!Number.isFinite(options.deadlineMs) || options.deadlineMs < 0)
    )
      throw new OpenAICompatibleProviderError("configuration", false);
    const controller = new AbortController();
    const abort = () => controller.abort(options?.signal?.reason);
    if (options?.signal?.aborted) abort();
    else options?.signal?.addEventListener("abort", abort, { once: true });
    const timer =
      options?.deadlineMs === undefined || options.deadlineMs === 0
        ? undefined
        : setTimeout(
            () => controller.abort(new Error("deadline")),
            options.deadlineMs,
          );
    if (options?.deadlineMs === 0) controller.abort(new Error("deadline"));
    try {
      for (let attempt = 1; attempt <= this.#repairAttempts + 1; attempt += 1) {
        try {
          return await this.dispatch(request, attempt, controller.signal);
        } catch (error) {
          const mapped = sanitize(error, controller.signal);
          if (
            mapped.category === "invalid_response" &&
            attempt <= this.#repairAttempts
          )
            continue;
          throw mapped;
        }
      }
      throw new OpenAICompatibleProviderError("invalid_response", false);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      options?.signal?.removeEventListener("abort", abort);
    }
  }
  async dispatch(
    request: DecisionRequest,
    attempt: number,
    signal: AbortSignal,
  ): Promise<OpenAICompatibleMappedResult> {
    try {
      let connection = await this.#policy.plan(this.#endpoint, signal);
      for (let redirect = 0; redirect <= this.#maxRedirects; redirect += 1) {
        if (signal.aborted) throw signal.reason ?? new Error("cancelled");
        const response = await this.#transport.execute(
          connection,
          {
            method: "POST",
            redirect: "manual",
            signal,
            headers: {
              ...this.#headers,
              "content-type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify({
              model: this.#model,
              messages: [
                {
                  role: "user",
                  content: buildCompatiblePrompt(request, attempt > 1),
                },
              ],
              stream: false,
              ...(this.#structuredOutput
                ? {
                    response_format: buildCompatibleResponseFormat(
                      request,
                      this.#probabilityMode,
                    ),
                  }
                : {}),
              ...(this.#temperature === undefined
                ? {}
                : { temperature: this.#temperature }),
            }),
          },
          this.#maxResponseBytes,
        );
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location || redirect === this.#maxRedirects)
            throw new OpenAICompatibleProviderError("network", false);
          connection = await this.#policy.planRedirect(
            connection.url,
            location,
            signal,
          );
          continue;
        }
        if (!response.ok) throw responseError(response);
        if (
          response.headers
            .get("content-type")
            ?.toLowerCase()
            .split(";", 1)[0] !== "application/json"
        )
          throw new OpenAICompatibleProviderError("invalid_response", false);
        const envelope = extractCompatibleResponse(
          await readBoundedBody(response, this.#maxResponseBytes),
        );
        const parsed = parseCompatibleAnswers(
          request,
          this.id,
          envelope.model,
          envelope.content,
        );
        this.#onAttempt?.({
          requestId: request.id,
          attempt,
          outcome: "succeeded",
        });
        return {
          response: parsed,
          ...(envelope.usage === undefined ? {} : { usage: envelope.usage }),
        };
      }
      throw new OpenAICompatibleProviderError("network", false);
    } catch (error) {
      this.#onAttempt?.({
        requestId: request.id,
        attempt,
        outcome: signal.aborted ? "cancelled" : "failed",
      });
      throw error;
    }
  }
}
function responseError(response: Response): OpenAICompatibleProviderError {
  const status = response.status;
  const retryAfterMs = retryAfter(response.headers.get("retry-after"));
  if (status === 401)
    return new OpenAICompatibleProviderError("authentication", false, status);
  if (status === 403)
    return new OpenAICompatibleProviderError("authorization", false, status);
  if (status === 400 || status === 404 || status === 422)
    return new OpenAICompatibleProviderError("invalid_request", false, status);
  if (status === 429)
    return new OpenAICompatibleProviderError(
      "rate_limited",
      true,
      status,
      retryAfterMs,
    );
  return new OpenAICompatibleProviderError(
    "unavailable",
    status >= 500,
    status,
  );
}
function retryAfter(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const milliseconds = Number(value) * 1000;
  return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
}
function sanitize(
  error: unknown,
  signal: AbortSignal,
): OpenAICompatibleProviderError {
  if (signal.aborted)
    return new OpenAICompatibleProviderError("cancelled", false);
  if (error instanceof OpenAICompatibleProviderError) return error;
  if (error instanceof EndpointPolicyError)
    return new OpenAICompatibleProviderError("configuration", false);
  if (error instanceof TypeError)
    return new OpenAICompatibleProviderError("invalid_response", false);
  return new OpenAICompatibleProviderError("network", true);
}
async function readBoundedBody(
  response: Response,
  maximum: number,
): Promise<string> {
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum))
    throw new TypeError("response body too large");
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new TypeError("response body too large");
    }
    chunks.push(next.value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

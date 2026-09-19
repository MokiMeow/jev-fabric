import { McpServer, type ServerContext } from "@modelcontextprotocol/server";
import type {
  FabricRuntimeInput,
  FabricRuntimeResult,
} from "@mokimeow/jev-fabric-core";
import type { DecisionPack } from "@mokimeow/jev-fabric-core";
import { assertSafeDecisionState } from "@mokimeow/jev-fabric-core";
import { builtinPacks } from "@mokimeow/jev-fabric-packs";
import { randomBytes } from "node:crypto";
import { z } from "zod";
export { createHttpHandler, type HttpHandlerOptions } from "./http.js";
export { serveStdio, type StdioOptions } from "./stdio.js";

const MAX_DEADLINE_MS = 60_000;
const MAX_OUTPUT_BYTES = 256_000;
const MAX_INPUT_BYTES = 32_768;
const MAX_STATE_DEPTH = 8;
const MAX_STATE_ITEMS = 100;
const MAX_STRING_BYTES = 4_096;
const MAX_RECEIPT_BYTES = 128_000;

/** The complete advisory surface. No tool can execute an action. */
export const toolNames = Object.freeze([
  "decision_evaluate_pack",
  "decision_route",
  "decision_rank",
  "decision_verify",
  "decision_explain_receipt",
] as const);

export interface McpRuntime {
  evaluate(input: FabricRuntimeInput): Promise<FabricRuntimeResult>;
}
export interface McpLogger {
  error(event: "mcp_error", details: { readonly code: string }): void;
}
export interface McpServerOptions {
  readonly runtime: McpRuntime;
  readonly packs?: ReadonlyMap<string, DecisionPack>;
  readonly logger?: McpLogger;
  readonly now?: () => number;
  readonly maxReceipts?: number;
  /** Shared only by servers that have the same trusted receipt boundary. */
  readonly receiptStore?: ReceiptRepository;
  /** Trusted/authenticated scope. Never derive this from tool arguments. */
  readonly receiptScope?: string;
}

const evaluationInput = z
  .object({
    pack: z.string().regex(/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u),
    // Shape/depth are checked iteratively below. A recursive Zod schema would
    // itself be vulnerable to a deeply nested JSON bomb before its limits run.
    state: z.unknown(),
    tenantId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/u),
    action: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/u),
    knownActions: z.array(z.string().min(1).max(128)).min(1).max(32),
    trustedRisk: z.number().finite().min(0).max(100).optional(),
    deadlineMs: z.number().int().min(1).max(MAX_DEADLINE_MS).optional(),
  })
  .strict();
const safeEvaluationInput = evaluationInput.superRefine((value, context) => {
  boundedValue(value, context);
  safeState(value.state, context);
});
const specificEvaluationInput = evaluationInput.omit({ pack: true });
const receiptInput = z
  .object({ decisionId: z.string().min(1).max(256) })
  .strict();

function inputFor() {
  return specificEvaluationInput.superRefine((value, context) => {
    boundedValue(value, context);
    safeState(value.state, context);
  });
}

const resultSchema = z
  .object({
    advisory: z.literal(true),
    semantic: z.unknown(),
    receipt: z.unknown(),
    accounting: z.unknown(),
    termination: z.enum(["cancelled", "deadline"]).optional(),
  })
  .strict();
const receiptResultSchema = z
  .object({ advisory: z.literal(true), receipt: z.unknown() })
  .strict();

/**
 * Creates a fresh server with finite, declared tool definitions. The injected
 * runtime is the only decision seam; this server has no execution capability.
 */
export function createMcpServer(options: McpServerOptions): McpServer {
  if (!options.runtime || typeof options.runtime.evaluate !== "function")
    throw new TypeError("an injected decision runtime is required");
  const packs =
    options.packs ??
    new Map(builtinPacks.map((pack) => [pack.manifest.id, pack]));
  const receipts =
    options.receiptStore ??
    new ReceiptRepository(options.maxReceipts ?? 100, options.now);
  const receiptScope = trustedReceiptScope(options.receiptScope);
  const logger = options.logger;
  const server = new McpServer(
    { name: "jev-fabric", version: "0.1.0-alpha.1" },
    { capabilities: { tools: {} } },
  );
  const register = (name: (typeof toolNames)[number], pack?: string) => {
    const schema =
      pack === undefined
        ? receiptInput
        : pack === "decision_evaluate_pack"
          ? safeEvaluationInput
          : inputFor();
    const output = pack === undefined ? receiptResultSchema : resultSchema;
    server.registerTool(
      name,
      {
        title: name,
        description:
          "Advisory decision only. It does not execute, authorize, or grant permission.",
        inputSchema: schema,
        outputSchema: output,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async (args: unknown, context: ServerContext) => {
        try {
          if (pack === undefined) {
            const found = receipts.get(
              receiptScope,
              (args as z.infer<typeof receiptInput>).decisionId,
            );
            if (!found) return toolError("RECEIPT_NOT_FOUND");
            return structured({ advisory: true as const, receipt: found });
          }
          const parsed = args as z.infer<typeof evaluationInput>;
          const packId = pack === "decision_evaluate_pack" ? parsed.pack : pack;
          const selected = packs.get(packId);
          if (!selected) return toolError("PACK_NOT_FOUND");
          const result = await options.runtime.evaluate({
            pack: selected,
            state: parsed.state,
            tenantId: parsed.tenantId,
            action: parsed.action,
            knownActions: parsed.knownActions,
            ...(parsed.trustedRisk === undefined
              ? {}
              : { trustedRisk: parsed.trustedRisk }),
            ...(parsed.deadlineMs === undefined
              ? {}
              : { deadlineMs: parsed.deadlineMs }),
            signal: context.mcpReq.signal,
          });
          const opaqueDecisionId = receipts.issueId();
          const receipt = { ...result.receipt, decisionId: opaqueDecisionId };
          const output = {
            advisory: true as const,
            semantic: result.semantic,
            receipt,
            accounting: result.accounting,
            ...(result.termination === undefined
              ? {}
              : { termination: result.termination }),
          };
          if (!withinBytes(receipt, MAX_RECEIPT_BYTES))
            return toolError("RECEIPT_TOO_LARGE");
          if (!withinBytes(output, MAX_OUTPUT_BYTES))
            return toolError("OUTPUT_TOO_LARGE");
          receipts.set(receiptScope, opaqueDecisionId, receipt);
          return structured(output);
        } catch (error) {
          const code =
            error instanceof z.ZodError
              ? "INVALID_INPUT"
              : context.mcpReq.signal.aborted
                ? "CANCELLED"
                : "DECISION_UNAVAILABLE";
          logger?.error("mcp_error", { code });
          return toolError(code);
        }
      },
    );
  };
  register("decision_evaluate_pack", "decision_evaluate_pack");
  register("decision_route", "route");
  register("decision_rank", "rank");
  register("decision_verify", "verify");
  register("decision_explain_receipt");
  return server;
}

function structured(value: object) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text, "utf8") > MAX_OUTPUT_BYTES)
    return toolError("OUTPUT_TOO_LARGE");
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: value,
  };
}
function toolError(code: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ code }) }],
    isError: true,
  };
}
function boundedValue(value: unknown, context: z.RefinementCtx): void {
  if (!withinBytes(value, MAX_INPUT_BYTES)) {
    context.addIssue({ code: "custom", message: "input exceeds byte limit" });
    return;
  }
  let items = 0;
  const pending: Array<{
    readonly entry: unknown;
    readonly depth: number;
    readonly path: PropertyKey[];
  }> = [{ entry: value, depth: 0, path: [] }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    const { entry, depth, path } = current;
    if (depth > MAX_STATE_DEPTH) {
      context.addIssue({
        code: "custom",
        message: "input exceeds structural limits",
      });
      return;
    }
    if (typeof entry === "string") {
      if (Buffer.byteLength(entry, "utf8") > MAX_STRING_BYTES) {
        context.addIssue({
          code: "custom",
          message: "input exceeds structural limits",
        });
        return;
      }
      continue;
    }
    if (entry === null || typeof entry === "boolean") continue;
    if (typeof entry === "number") {
      if (!Number.isFinite(entry)) {
        context.addIssue({
          code: "custom",
          message: "input must be JSON",
        });
        return;
      }
      continue;
    }
    if (!entry || typeof entry !== "object") {
      context.addIssue({ code: "custom", message: "input must be JSON" });
      return;
    }
    const entries = Array.isArray(entry)
      ? entry.map((child, index) => [String(index), child] as const)
      : Object.entries(entry as Record<string, unknown>);
    for (const [key, child] of entries) {
      if (key.length > 128) {
        context.addIssue({
          code: "custom",
          message: "input exceeds structural limits",
        });
        return;
      }
      items += 1;
      if (items > MAX_STATE_ITEMS) {
        context.addIssue({
          code: "custom",
          message: "input exceeds structural limits",
        });
        return;
      }
      pending.push({ entry: child, depth: depth + 1, path: [...path, key] });
    }
  }
}
function safeState(value: unknown, context: z.RefinementCtx): void {
  try {
    assertSafeDecisionState(value);
  } catch {
    context.addIssue({
      code: "custom",
      path: ["state"],
      message: "state cannot contain credentials or action tickets",
    });
  }
}
function withinBytes(value: unknown, maxBytes: number): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= maxBytes;
  } catch {
    return false;
  }
}
/** Bounded shared receipt repository keyed by an opaque ID plus trusted scope. */
export class ReceiptRepository {
  readonly #values = new Map<
    string,
    {
      readonly receipt: unknown;
      readonly bytes: number;
      readonly expiresAt: number;
    }
  >();
  #totalBytes = 0;
  constructor(
    private readonly max: number,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isSafeInteger(max) || max < 1 || max > 1_000)
      throw new RangeError("maxReceipts must be between 1 and 1000");
  }
  get(scope: string, id: string): unknown | undefined {
    const key = receiptKey(scope, id);
    const item = this.#values.get(key);
    if (!item || item.expiresAt <= this.now()) {
      if (item) {
        this.#values.delete(key);
        this.#totalBytes -= item.bytes;
      }
      return undefined;
    }
    return item.receipt;
  }
  set(scope: string, id: string, receipt: unknown): void {
    const bytes = Buffer.byteLength(JSON.stringify(receipt), "utf8");
    if (bytes > MAX_RECEIPT_BYTES) return;
    const key = receiptKey(scope, id);
    const previous = this.#values.get(key);
    if (previous) this.#totalBytes -= previous.bytes;
    this.#values.delete(key);
    this.#values.set(key, {
      receipt,
      bytes,
      expiresAt: this.now() + 300_000,
    });
    this.#totalBytes += bytes;
    while (
      this.#values.size > this.max ||
      this.#totalBytes > MAX_RECEIPT_BYTES
    ) {
      const key = this.#values.keys().next().value as string;
      const removed = this.#values.get(key);
      this.#values.delete(key);
      if (removed) this.#totalBytes -= removed.bytes;
    }
  }
  issueId(): string {
    return `receipt_${randomBytes(24).toString("base64url")}`;
  }
}

function trustedReceiptScope(value: string | undefined): string {
  const scope = value ?? "stdio-local";
  if (scope.length < 1 || Buffer.byteLength(scope, "utf8") > 256)
    throw new RangeError("trusted receipt scope is invalid");
  return scope;
}
function receiptKey(scope: string, id: string): string {
  return `${scope}\u0000${id}`;
}

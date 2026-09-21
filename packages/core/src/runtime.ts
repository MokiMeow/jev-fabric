import type {
  AuthorizationContext,
  DecisionAnswer,
  DecisionProvider,
  DecisionResponse,
  PolicyOutcome,
} from "@mokimeow/jev-fabric-protocol";
import { validateDecisionResponse } from "@mokimeow/jev-fabric-protocol";
import { type AccountingSummary, summarizeAccounting } from "./accounting.js";
import type { DecisionCache } from "./cache.js";
import {
  CandidateCoverageError,
  compileCandidates,
  type DecisionCandidate,
} from "./candidates.js";
import { sha256Digest } from "./canonical.js";
import { projectStateWithBinding } from "./context.js";
import { DeadlineExceededError, DecisionAbortedError } from "./errors.js";
import { assertProviderCapabilities, type DecisionPack } from "./pack.js";
import {
  evaluatePolicy,
  type PolicyRule,
  preflightStaticPolicy,
} from "./policy.js";
import { ReceiptBuilder } from "./receipt.js";
import { type RetryPolicy, validPolicy } from "./retry.js";
import type { SchedulerAttempt } from "./scheduler.js";
import { DecisionScheduler } from "./scheduler.js";

export class ProviderOutageError extends Error {
  override name = "ProviderOutageError";
}
/** The runtime uses two attempts by default; callers may lower it, never raise it above three. */
export const DEFAULT_RUNTIME_RETRY_POLICY: Readonly<RetryPolicy> =
  Object.freeze({
    maxAttempts: 2,
    baseDelayMs: 25,
    maxDelayMs: 250,
  });
export const MAX_RUNTIME_RETRY_ATTEMPTS = 3;
export interface RuntimeCacheValue {
  readonly response: DecisionResponse;
}
export interface FabricRuntimeOptions {
  readonly provider: DecisionProvider;
  /** Administrator-pinned requested model identity; it scopes raw judgments. */
  readonly model: string;
  readonly cache: DecisionCache<RuntimeCacheValue>;
  readonly scheduler: DecisionScheduler;
  readonly now?: () => number;
  readonly policyVersion?: string;
  readonly estimatedTokens?: number;
  /** Bounded per-live-stage retry policy (default: two attempts). */
  readonly retry?: RetryPolicy;
}
export interface FabricRuntimeInput {
  readonly pack: DecisionPack;
  readonly state: unknown;
  /** Trusted tenant identity; state can never supply it. */
  readonly tenantId: string;
  readonly action: string;
  readonly knownActions: readonly string[];
  readonly authorization?: AuthorizationContext;
  readonly rules?: readonly PolicyRule[];
  /** Trusted host-computed risk, conservatively combined with risk-pack signals. */
  readonly trustedRisk?: number;
  readonly signal?: AbortSignal;
  readonly deadlineMs?: number;
}
export interface FabricRuntimeResult {
  readonly answers: readonly DecisionAnswer[];
  readonly semantic: import("./pack.js").PackSemanticResult;
  readonly receipt: import("@mokimeow/jev-fabric-protocol").DecisionReceipt;
  readonly accounting: AccountingSummary;
  readonly coverageFailure?: string;
  readonly cacheWriteFailure?: string;
  readonly termination?: "cancelled" | "deadline";
}

/**
 * Composes trusted projection/candidates with cache, scheduler, provider, policy,
 * receipt, and accounting seams. It never persists raw state or authorization.
 */
export class FabricRuntime {
  readonly #now: () => number;
  readonly #policyVersion: string;
  readonly #estimatedTokens: number;
  readonly #retry: RetryPolicy;
  constructor(private readonly options: FabricRuntimeOptions) {
    if (
      !options.provider ||
      !options.model ||
      !options.cache ||
      !(options.scheduler instanceof DecisionScheduler)
    )
      throw new TypeError(
        "provider, cache, and mandatory scheduler are required",
      );
    this.#now = options.now ?? Date.now;
    this.#policyVersion = options.policyVersion ?? "1";
    this.#estimatedTokens = options.estimatedTokens ?? 0;
    this.#retry = runtimeRetry(options.retry);
  }

  async evaluate(input: FabricRuntimeInput): Promise<FabricRuntimeResult> {
    const startedAt = this.#now();
    const implementation = input.pack.implementations;
    if (!implementation)
      throw new TypeError("runtime requires trusted pack implementations");
    if (!input.tenantId || !input.action)
      throw new TypeError("trusted tenantId and action are required");
    const preflight = preflightStaticPolicy({
      action: input.action,
      knownActions: input.knownActions,
      ...(input.rules === undefined ? {} : { rules: input.rules }),
      now: this.#now(),
    });
    if (preflight)
      return this.deterministic(
        input,
        sha256Digest(
          { pack: input.pack.manifest.id, stage: "preflight" },
          "jev-fabric/preflight/v1",
        ),
        sha256Digest(
          {
            tenantId: input.tenantId,
            workspaceId: input.authorization?.workspaceId ?? "none",
          },
          "jev-fabric/decision-scope/v1",
        ),
        startedAt,
        preflight.outcome,
        preflight.reasonCodes[0] ?? "STATIC_DENY",
        "bypass",
      );
    const projection = projectStateWithBinding(
      implementation.projector,
      input.state,
      input.pack.manifest.limits,
      { nowEpochMs: startedAt },
    );
    const state = projection.state;
    const stateHash =
      projection.bindingHash === undefined
        ? sha256Digest(state, "jev-fabric/projected-state/v1")
        : sha256Digest(
            { bindingHash: projection.bindingHash, state },
            "jev-fabric/bound-projected-state/v1",
          );
    const scopeHash = sha256Digest(
      {
        tenantId: input.tenantId,
        workspaceId: input.authorization?.workspaceId ?? "none",
      },
      "jev-fabric/decision-scope/v1",
    );
    if (input.signal?.aborted)
      return this.terminated(
        input,
        stateHash,
        scopeHash,
        startedAt,
        [],
        "cancelled",
      );
    if (
      input.deadlineMs !== undefined &&
      (!Number.isFinite(input.deadlineMs) || input.deadlineMs < 0)
    )
      throw new RangeError("deadlineMs must be non-negative and finite");
    if (input.deadlineMs === 0)
      return this.terminated(
        input,
        stateHash,
        scopeHash,
        startedAt,
        [],
        "deadline",
      );
    const bypass = implementation.bypass?.(state);
    if (bypass)
      return this.deterministic(
        input,
        stateHash,
        scopeHash,
        startedAt,
        bypass.outcome,
        bypass.reasonCode,
        "bypass",
      );

    let candidates: readonly DecisionCandidate[];
    try {
      candidates = compileCandidates(
        implementation.candidates,
        state,
        input.pack.manifest.limits,
      );
    } catch (error) {
      if (error instanceof CandidateCoverageError)
        return this.deterministic(
          input,
          stateHash,
          scopeHash,
          startedAt,
          "unavailable",
          "CANDIDATE_COVERAGE_FAILURE",
          "bypass",
          error.message,
        );
      throw error;
    }
    if (candidates.length === 0)
      return this.deterministic(
        input,
        stateHash,
        scopeHash,
        startedAt,
        input.pack.manifest.candidateBehavior === "no_match"
          ? "abstain"
          : input.pack.manifest.candidateBehavior,
        "EMPTY_CANDIDATE_SET",
        "bypass",
        undefined,
        [],
        input.pack.manifest.candidateBehavior === "no_match"
          ? "no_match"
          : undefined,
      );

    const questions = implementation.questions(state, candidates);
    if (questions.length === 0)
      return this.deterministic(
        input,
        stateHash,
        scopeHash,
        startedAt,
        "abstain",
        "NO_SEMANTIC_QUESTION",
        "bypass",
      );
    assertProviderCapabilities(input.pack, this.options.provider.capabilities);
    if (questions.length > this.options.provider.capabilities.maxQuestions)
      throw new RangeError("pack question count exceeds provider maxQuestions");
    const key = sha256Digest(
      {
        pack: input.pack.manifest.id,
        version: input.pack.manifest.version,
        provider: this.options.provider.id,
        model: this.options.model,
        scopeHash,
        stateHash,
        questions,
        candidates,
      },
      "jev-fabric/runtime-cache/v1",
    );
    const cached = await this.options.cache.get({
      tenantId: input.tenantId,
      namespace: "judgment",
      key,
    });
    if (cached) {
      const response = validateDecisionResponse(
        { id: this.requestId(input.pack, stateHash), state, questions },
        cached.response,
      );
      return this.fromResponse(
        input,
        response,
        stateHash,
        scopeHash,
        startedAt,
        "hit",
        [],
        implementation.interpret(
          response.answers,
          candidates,
          interpretationContext(response),
        ),
      );
    }

    const request = {
      id: this.requestId(input.pack, stateHash),
      state,
      questions,
    };
    const attempts: SchedulerAttempt[] = [];
    let validated: DecisionResponse;
    let semantic: import("./pack.js").PackSemanticResult;
    try {
      const providerOptions = {
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        ...(input.deadlineMs === undefined
          ? {}
          : { deadlineMs: input.deadlineMs }),
      };
      const response = await this.options.scheduler.run(
        {
          tenantId: input.tenantId,
          providerId: this.options.provider.id,
          budget: { requests: 1, tokens: this.#estimatedTokens },
          retry: this.#retry,
          onAttempt: (attempt) => attempts.push(attempt),
          ...providerOptions,
        },
        (attempt) => this.options.provider.evaluate(request, attempt),
      );
      validated = validateDecisionResponse(request, response);
      semantic = freezeSemantic(
        implementation.interpret(
          validated.answers,
          candidates,
          interpretationContext(validated),
        ),
      );
    } catch (error) {
      const termination = terminationOf(error, input.signal);
      if (termination)
        return this.terminated(
          input,
          stateHash,
          scopeHash,
          startedAt,
          attempts,
          termination,
        );
      const outcome = hasCause(error, ProviderOutageError)
        ? input.pack.manifest.failure.outage
        : input.pack.manifest.failure.providerFailure;
      return this.deterministic(
        input,
        stateHash,
        scopeHash,
        startedAt,
        outcome,
        hasCause(error, ProviderOutageError)
          ? "PROVIDER_OUTAGE"
          : "PROVIDER_FAILURE",
        "bypass",
        undefined,
        attempts,
      );
    }
    try {
      await this.options.cache.set(
        { tenantId: input.tenantId, namespace: "judgment", key },
        { response: validated },
      );
    } catch (cacheError) {
      return this.fromResponse(
        input,
        validated,
        stateHash,
        scopeHash,
        startedAt,
        "miss",
        attempts,
        semantic,
        "failed",
        cacheError instanceof Error ? cacheError.message : "cache write failed",
      );
    }
    return this.fromResponse(
      input,
      validated,
      stateHash,
      scopeHash,
      startedAt,
      "miss",
      attempts,
      semantic,
    );
  }

  private deterministic(
    input: FabricRuntimeInput,
    stateHash: string,
    scopeHash: string,
    startedAt: number,
    proposed: PolicyOutcome,
    reason: string,
    cache: "bypass",
    coverageFailure?: string,
    attempts: readonly SchedulerAttempt[] = [],
    semanticStatus?: import("./pack.js").PackSemanticResult["status"],
  ): FabricRuntimeResult {
    // A trusted deterministic pack denial is already a safety boundary; policy
    // may add another denial but must never weaken it to escalation.
    const policy =
      proposed === "deny"
        ? { outcome: "deny" as const, reasonCodes: ["PACK_DETERMINISTIC_DENY"] }
        : this.policy(input, proposed);
    const receipt = new ReceiptBuilder().build({
      schemaVersion: "1",
      decisionId: this.requestId(input.pack, stateHash),
      stateHash,
      scopeHash,
      packVersion: input.pack.manifest.version,
      policyVersion: this.#policyVersion,
      providerId: "deterministic",
      model: "deterministic",
      probabilitySemantics: "synthetic",
      answers: [],
      outcome: policy.outcome,
      reasonCodes: [reason, ...policy.reasonCodes],
      cache,
      fallback: proposed === "unavailable" ? "unavailable" : "none",
      latencyMs: Math.max(0, this.#now() - startedAt),
    });
    return {
      answers: [],
      semantic: {
        status:
          semanticStatus ??
          (proposed === "unavailable"
            ? "unavailable"
            : proposed === "abstain"
              ? "abstain"
              : "decision"),
        proposedOutcome:
          proposed as import("./pack.js").PackSemanticResult["proposedOutcome"],
        metadata: {},
      },
      receipt,
      accounting: summarizeAccounting({
        logicalRequests:
          attempts.length === 0
            ? []
            : [
                {
                  id: this.requestId(input.pack, stateHash),
                  startedAt,
                  endedAt: this.#now(),
                },
              ],
        transportAttempts: attempts.map((attempt) => ({
          logicalRequestId: this.requestId(input.pack, stateHash),
          startedAt: attempt.startedAt,
          endedAt: attempt.endedAt,
          providerStartedAt: attempt.startedAt,
          providerEndedAt: attempt.endedAt,
          outcome: attempt.outcome,
        })),
        spans: [],
      }),
      ...(coverageFailure === undefined ? {} : { coverageFailure }),
    };
  }
  private fromResponse(
    input: FabricRuntimeInput,
    response: DecisionResponse,
    stateHash: string,
    scopeHash: string,
    startedAt: number,
    cache: "hit" | "miss",
    attempts: readonly SchedulerAttempt[],
    semantic: import("./pack.js").PackSemanticResult,
    cacheWrite?: "failed",
    cacheWriteFailure?: string,
  ): FabricRuntimeResult {
    const policy = this.policy(
      input,
      semantic.proposedOutcome,
      semantic.metadata,
    );
    const endedAt = this.#now();
    const receipt = new ReceiptBuilder().build({
      schemaVersion: "1",
      decisionId: this.requestId(input.pack, stateHash),
      stateHash,
      scopeHash,
      packVersion: input.pack.manifest.version,
      policyVersion: this.#policyVersion,
      providerId: response.providerId,
      model: response.model,
      probabilitySemantics: response.probabilitySemantics,
      answers: response.answers,
      outcome: policy.outcome,
      reasonCodes: policy.reasonCodes,
      cache,
      fallback: "none",
      ...(cacheWrite === undefined ? {} : { cacheWrite }),
      latencyMs: Math.max(0, endedAt - startedAt),
    });
    return {
      answers: response.answers,
      semantic,
      receipt,
      accounting: summarizeAccounting({
        logicalRequests:
          cache === "miss"
            ? [{ id: receipt.decisionId, startedAt, endedAt }]
            : [],
        transportAttempts:
          attempts.length === 0
            ? []
            : attempts.map((attempt) => ({
                logicalRequestId: receipt.decisionId,
                startedAt: attempt.startedAt,
                endedAt: attempt.endedAt,
                providerStartedAt: attempt.startedAt,
                providerEndedAt: attempt.endedAt,
                outcome: attempt.outcome,
              })),
        spans: [],
      }),
      ...(cacheWriteFailure === undefined ? {} : { cacheWriteFailure }),
    };
  }
  private terminated(
    input: FabricRuntimeInput,
    stateHash: string,
    scopeHash: string,
    startedAt: number,
    attempts: readonly SchedulerAttempt[],
    termination: "cancelled" | "deadline",
  ): FabricRuntimeResult {
    const endedAt = this.#now();
    const receipt = new ReceiptBuilder().build({
      schemaVersion: "1",
      decisionId: this.requestId(input.pack, stateHash),
      stateHash,
      scopeHash,
      packVersion: input.pack.manifest.version,
      policyVersion: this.#policyVersion,
      providerId: "deterministic",
      model: "deterministic",
      probabilitySemantics: "synthetic",
      answers: [],
      outcome: "unavailable",
      reasonCodes: [
        termination === "cancelled" ? "CALLER_ABORTED" : "DEADLINE_EXCEEDED",
      ],
      cache: "bypass",
      fallback: "unavailable",
      termination,
      latencyMs: Math.max(0, endedAt - startedAt),
    });
    return {
      answers: [],
      semantic: {
        status: "unavailable",
        proposedOutcome: "unavailable",
        metadata: {},
      },
      receipt,
      accounting: summarizeAccounting({
        logicalRequests: attempts.length
          ? [{ id: receipt.decisionId, startedAt, endedAt }]
          : [],
        transportAttempts: attempts.map((attempt) => ({
          logicalRequestId: receipt.decisionId,
          startedAt: attempt.startedAt,
          endedAt: attempt.endedAt,
          providerStartedAt: attempt.startedAt,
          providerEndedAt: attempt.endedAt,
          outcome: attempt.outcome,
        })),
        spans: [],
      }),
      termination,
    };
  }
  private policy(
    input: FabricRuntimeInput,
    proposed: PolicyOutcome,
    metadata: Readonly<
      Record<string, import("@mokimeow/jev-fabric-protocol").JsonValue>
    > = {},
  ) {
    const risk = semanticRisk(metadata, input.trustedRisk);
    const decision = evaluatePolicy({
      action: input.action,
      knownActions: input.knownActions,
      ...(input.authorization === undefined
        ? {}
        : { authorization: input.authorization }),
      ...(input.rules === undefined ? {} : { rules: input.rules }),
      risk,
      now: this.#now(),
    });
    return decision.outcome === "abstain"
      ? {
          outcome: proposed,
          reasonCodes: ["PACK_DEFAULT", ...decision.reasonCodes],
        }
      : decision;
  }
  private requestId(pack: DecisionPack, stateHash: string): string {
    return `decision-${pack.manifest.id}-${stateHash.slice(0, 16)}`;
  }
}

function freezeSemantic<T extends import("./pack.js").PackSemanticResult>(
  value: T,
): T {
  return Object.freeze({
    ...value,
    metadata: Object.freeze({ ...value.metadata }),
  }) as T;
}

function interpretationContext(
  response: DecisionResponse,
): import("./pack.js").PackInterpretContext {
  return Object.freeze({
    providerId: response.providerId,
    model: response.model,
    probabilitySemantics: response.probabilitySemantics,
  });
}

function runtimeRetry(policy: RetryPolicy | undefined): RetryPolicy {
  const resolved = policy ?? DEFAULT_RUNTIME_RETRY_POLICY;
  validPolicy(resolved);
  if (resolved.maxAttempts > MAX_RUNTIME_RETRY_ATTEMPTS)
    throw new RangeError(
      `runtime retry maxAttempts must not exceed ${MAX_RUNTIME_RETRY_ATTEMPTS}`,
    );
  return Object.freeze({ ...resolved });
}

function hasCause(
  value: unknown,
  Type: abstract new (...args: never[]) => Error,
): boolean {
  const seen = new Set<object>();
  let current: unknown = value;
  while (current && typeof current === "object" && !seen.has(current)) {
    if (current instanceof Type) return true;
    seen.add(current);
    current =
      "cause" in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

function terminationOf(
  error: unknown,
  signal: AbortSignal | undefined,
): "cancelled" | "deadline" | undefined {
  if (hasCause(error, DeadlineExceededError)) return "deadline";
  if (signal?.aborted || hasCause(error, DecisionAbortedError))
    return "cancelled";
  return undefined;
}

function semanticRisk(
  metadata: Readonly<
    Record<string, import("@mokimeow/jev-fabric-protocol").JsonValue>
  >,
  trustedRisk: number | undefined,
): number {
  const host =
    trustedRisk === undefined || !Number.isFinite(trustedRisk)
      ? trustedRisk === undefined
        ? 0
        : 100
      : Math.max(0, Math.min(100, trustedRisk));
  const providerRisk = metadata.risk === "high" ? 60 : 0;
  const authorizationRisk = metadata.authorizationNeeded === "yes" ? 30 : 0;
  const influenceRisk = metadata.untrustedInfluence === "yes" ? 60 : 0;
  return Math.max(host, providerRisk, authorizationRisk, influenceRisk);
}

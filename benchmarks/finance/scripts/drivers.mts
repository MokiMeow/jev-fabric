import { createHash } from "node:crypto";
import type { FinanceAdvisoryState } from "../../../packages/adapters/src/index.js";
import {
  BudgetLedger,
  type BudgetSnapshot,
  type DecisionCache,
  DecisionScheduler,
  FabricRuntime,
  type RuntimeCacheValue,
} from "../../../packages/core/src/index.js";
import {
  type FinanceArchitecture,
  type FinanceAtomicCandidateBinding,
  type FinanceAtomicEvidenceLedger,
  type FinanceRoute,
  type FinanceRouteProbabilities,
  financeRoutes,
  stableJson,
} from "../../../packages/evals/src/index.js";
import type {
  DecisionProvider,
  DecisionRequest,
  DecisionResponse,
  EvaluateOptions,
  ProbabilitySemantics,
  ProviderCapabilities,
} from "../../../packages/protocol/src/index.js";
import { OpenAICompatibleProvider } from "../../../packages/provider-openai-compatible/src/index.js";
import type { TypeSafeProvider } from "../../../packages/provider-typesafe/src/index.js";
import { financeSurveillancePack } from "../../../packs/finance-surveillance/pack.js";
import type {
  ArchitectureRuntime,
  ArchitectureRuntimeModelVersionEvidence,
  ArchitectureRuntimePricing,
  FinanceBenchmarkDriver,
  FinanceBenchmarkDrivers,
  FinanceDriverContext,
  FinanceDriverResult,
  FinanceRuntimeProvenance,
} from "./run.mjs";

export type FinanceProviderPricing = ArchitectureRuntimePricing;

export interface FinanceMeasuredProviderResult {
  readonly response: DecisionResponse;
  /** Provider-measured usage; both values are known or both are null. */
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  /** Hash-only upstream identity, or explicit null when unavailable. */
  readonly providerRequestIdHash?: string | null;
}

/**
 * A trusted in-process transport seam. Implementations own credential handling
 * and must disable hidden retries before they are supplied to this factory.
 */
export interface FinanceMeasuredProviderInvoker {
  readonly providerId: string;
  readonly modelId: string;
  /** Immutable concrete model version. `latest` aliases are rejected. */
  readonly modelVersion: string;
  /** Exact model string expected in the provider response and receipt. */
  readonly responseModel: string;
  readonly modelVersionEvidence: ArchitectureRuntimeModelVersionEvidence;
  readonly probabilitySemantics: ProbabilitySemantics;
  readonly capabilities: ProviderCapabilities;
  readonly pricing?: FinanceProviderPricing;
  evaluate(
    request: DecisionRequest,
    options?: EvaluateOptions,
  ): Promise<FinanceMeasuredProviderResult>;
}

export interface FinanceMetadataInvokerOptions {
  readonly modelId: string;
  readonly modelVersion: string;
  readonly responseModel: string;
  readonly modelVersionEvidence?: ArchitectureRuntimeModelVersionEvidence;
  readonly pricing?: FinanceProviderPricing;
}

export interface FinanceProviderLimits {
  readonly maxCalls: number;
  /** Admission budget. Fabric reserves the estimate below for each call. */
  readonly maxReservedInputTokens: number;
  readonly estimatedInputTokensPerCall: number;
  readonly concurrency: number;
  readonly maxQueue: number;
  readonly deadlineMs: number;
}

export interface FinanceProviderArmOptions {
  readonly invoker: FinanceMeasuredProviderInvoker;
  readonly limits: FinanceProviderLimits;
}

export interface TrustedFinanceDriverBundleOptions {
  readonly tenantId: string;
  readonly policyVersion: string;
  readonly host: FinanceProviderArmOptions;
  readonly jev: FinanceProviderArmOptions;
}

export interface FinanceBudgetSnapshots {
  readonly host: BudgetSnapshot;
  readonly jev: BudgetSnapshot;
}

export interface TrustedFinanceDriverBundle {
  readonly drivers: FinanceBenchmarkDrivers;
  readonly architectures: FinanceRuntimeProvenance["architectures"];
  /** Frozen pricing provenance used by the cost calculation, if supplied. */
  readonly pricing: Readonly<{
    readonly host: FinanceProviderPricing | null;
    readonly jev: FinanceProviderPricing | null;
  }>;
  budgetSnapshots(): FinanceBudgetSnapshots;
}

/** Wraps an already-constructed TypeSafe provider without reading credentials. */
export function createTypeSafeFinanceInvoker(
  provider: Pick<
    TypeSafeProvider,
    "id" | "capabilities" | "evaluateWithMetadata"
  >,
  options: FinanceMetadataInvokerOptions,
): FinanceMeasuredProviderInvoker {
  return metadataInvoker(provider, options, "native_calibrated");
}

/** Wraps an already-constructed, retry-configured compatible provider. */
export function createOpenAICompatibleFinanceInvoker(
  provider: OpenAICompatibleProvider,
  options: FinanceMetadataInvokerOptions,
): FinanceMeasuredProviderInvoker {
  const executionPolicy = OpenAICompatibleProvider.executionPolicyOf(provider);
  if (
    executionPolicy.maxRedirects !== 0 ||
    executionPolicy.repairAttempts !== 0
  )
    throw new TypeError(
      "finance benchmark requires zero compatible-provider redirects and repairs",
    );
  return metadataInvoker(provider, options, "self_reported");
}

interface TrustedProviderArm {
  readonly role: "host" | "jev";
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly responseModel: string;
  readonly modelVersionEvidence: ArchitectureRuntimeModelVersionEvidence;
  readonly probabilitySemantics: ProbabilitySemantics;
  readonly capabilities: ProviderCapabilities;
  readonly pricing: FinanceProviderPricing | undefined;
  readonly limits: FinanceProviderLimits;
  readonly tenantId: string;
  readonly policyVersion: string;
  readonly evaluate: FinanceMeasuredProviderInvoker["evaluate"];
  readonly ledger: BudgetLedger;
  readonly scheduler: DecisionScheduler;
}

interface ComponentResult {
  readonly role: "host" | "jev";
  readonly route: FinanceRoute;
  readonly probabilities: FinanceRouteProbabilities;
  readonly atomicEvidence: FinanceAtomicEvidenceLedger;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly costNanoUsd: string | null;
  readonly providerRequestIdHash: string | null;
}

interface MetadataProviderLike {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  evaluateWithMetadata(
    request: DecisionRequest,
    options?: EvaluateOptions,
  ): Promise<{
    readonly response: DecisionResponse;
    readonly usage?:
      | {
          readonly inputTokens?: number | undefined;
          readonly outputTokens?: number | undefined;
        }
      | undefined;
    readonly providerRequestIdHash?: string | undefined;
  }>;
}

const retryOnce = Object.freeze({
  maxAttempts: 1,
  baseDelayMs: 0,
  maxDelayMs: 0,
});
const portableIdentifier = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u;
const nonNegativeInteger = /^(0|[1-9][0-9]*)$/u;
const sha256 = /^sha256:[a-f0-9]{64}$/u;
const latestAlias = /(^|[-_.:/])latest($|[-_.:/])/iu;
const concreteModelVersion =
  /(?:^|[-_.:/])(?:v?[0-9]+\.[0-9]+(?:\.[0-9]+)*|20[0-9]{2}-[0-9]{2}-[0-9]{2}|sha256:[a-f0-9]{64})(?:$|[-_.:/])/iu;

const noStoreCache: DecisionCache<RuntimeCacheValue> = Object.freeze({
  get: async () => undefined,
  set: async () => undefined,
  delete: async () => undefined,
});

class FinanceMeasurementError extends TypeError {}

function metadataInvoker(
  provider: MetadataProviderLike,
  options: FinanceMetadataInvokerOptions,
  semantics: ProbabilitySemantics,
): FinanceMeasuredProviderInvoker {
  if (!provider || typeof provider.evaluateWithMetadata !== "function")
    throw new TypeError("metadata-capable provider is required");
  const pricing =
    options.pricing === undefined
      ? undefined
      : snapshotPricing(options.pricing, "provider");
  const modelVersionEvidence = snapshotModelVersionEvidence(
    options.modelVersionEvidence ?? { kind: "response_exact" },
    options.modelVersion,
    options.responseModel,
    "provider",
  );
  return Object.freeze({
    providerId: provider.id,
    modelId: options.modelId,
    modelVersion: options.modelVersion,
    responseModel: options.responseModel,
    modelVersionEvidence,
    probabilitySemantics: semantics,
    capabilities: provider.capabilities,
    ...(pricing === undefined ? {} : { pricing }),
    evaluate: async (
      request: DecisionRequest,
      evaluateOptions?: EvaluateOptions,
    ) => {
      const result = await provider.evaluateWithMetadata(
        request,
        evaluateOptions,
      );
      const completeUsage =
        result.usage?.inputTokens !== undefined &&
        result.usage.outputTokens !== undefined;
      return {
        response: result.response,
        providerRequestIdHash: result.providerRequestIdHash ?? null,
        inputTokens: completeUsage ? (result.usage?.inputTokens ?? null) : null,
        outputTokens: completeUsage
          ? (result.usage?.outputTokens ?? null)
          : null,
      };
    },
  });
}

export function createTrustedFinanceDriverBundle(
  options: TrustedFinanceDriverBundleOptions,
): TrustedFinanceDriverBundle {
  if (!options || typeof options !== "object")
    throw new TypeError("finance driver bundle options are required");
  identifier(options.tenantId, "tenantId");
  nonempty(options.policyVersion, "policyVersion");
  const host = createArm(
    "host",
    options.host,
    options.tenantId,
    options.policyVersion,
  );
  const jev = createArm(
    "jev",
    options.jev,
    options.tenantId,
    options.policyVersion,
  );
  const architectures = architectureProvenance(host, jev);

  const deterministic: FinanceBenchmarkDriver = (state, context) => {
    driverContext(context, "deterministic_only");
    if (context.signal.aborted)
      throw new Error("finance deterministic driver cancelled");
    return {
      status: "predicted",
      predictedRoute: deterministicRoute(state),
      routeQuestionProbabilities: null,
      calibrationStatus: "unavailable",
      calibrationReason: "deterministic_only",
      atomicEvidence: [],
      abstained: false,
      unsafeExecutionAttempt: false,
      inputTokens: 0,
      outputTokens: 0,
      costNanoUsd: "0",
      componentAccounting: [],
    };
  };
  const providerDriver =
    (
      architecture: "host_model_only" | "jev_advisory",
      arm: TrustedProviderArm,
    ): FinanceBenchmarkDriver =>
    async (state, context) => {
      driverContext(context, architecture);
      const result = await evaluateComponent(arm, state, context);
      return measuredDriverResult(result);
    };
  const composite: FinanceBenchmarkDriver = async (state, context) => {
    driverContext(context, "host_plus_jev");
    const [hostResult, jevResult] = await Promise.all([
      evaluateComponent(host, state, context),
      evaluateComponent(jev, state, context),
    ]);
    const tokens = combineTokens(hostResult, jevResult);
    return {
      status: "predicted",
      predictedRoute: restrictiveRoute(hostResult.route, jevResult.route),
      routeQuestionProbabilities: null,
      calibrationStatus: "unavailable",
      calibrationReason: "composite_no_distribution",
      atomicEvidence: [hostResult.atomicEvidence, jevResult.atomicEvidence],
      abstained: false,
      unsafeExecutionAttempt: false,
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      costNanoUsd: addOptionalCosts(
        hostResult.costNanoUsd,
        jevResult.costNanoUsd,
      ),
      componentAccounting: [
        componentAccounting(hostResult),
        componentAccounting(jevResult),
      ],
    };
  };

  const drivers: FinanceBenchmarkDrivers = Object.freeze({
    deterministic_only: deterministic,
    host_model_only: providerDriver("host_model_only", host),
    jev_advisory: providerDriver("jev_advisory", jev),
    host_plus_jev: composite,
  });
  const pricing = Object.freeze({
    host: host.pricing ?? null,
    jev: jev.pricing ?? null,
  });
  return Object.freeze({
    drivers,
    architectures,
    pricing,
    budgetSnapshots: (): FinanceBudgetSnapshots => ({
      host: host.ledger.snapshot(),
      jev: jev.ledger.snapshot(),
    }),
  });
}

function createArm(
  role: TrustedProviderArm["role"],
  input: FinanceProviderArmOptions,
  tenantId: string,
  policyVersion: string,
): TrustedProviderArm {
  if (!input || typeof input !== "object" || !input.invoker)
    throw new TypeError(`${role} provider arm is required`);
  const source = input.invoker;
  identifier(source.providerId, `${role} providerId`);
  nonempty(source.modelId, `${role} modelId`);
  nonempty(source.modelVersion, `${role} modelVersion`);
  if (
    latestAlias.test(source.modelVersion) ||
    !concreteModelVersion.test(source.modelVersion)
  )
    throw new TypeError(
      `${role} requires a pinned modelVersion with a concrete version or date`,
    );
  nonempty(source.responseModel, `${role} responseModel`);
  const modelVersionEvidence = snapshotModelVersionEvidence(
    source.modelVersionEvidence,
    source.modelVersion,
    source.responseModel,
    role,
  );
  probabilitySemantics(source.probabilitySemantics, role);
  const capabilities = snapshotCapabilities(source.capabilities, role);
  if (
    !capabilities.questionTypes.includes("choice") ||
    !capabilities.probabilitySemantics.includes(source.probabilitySemantics) ||
    capabilities.maxQuestions < 4
  )
    throw new TypeError(
      `${role} provider capabilities do not cover the finance pack`,
    );
  if (typeof source.evaluate !== "function")
    throw new TypeError(`${role} provider evaluate function is required`);
  const limits = snapshotLimits(input.limits, role);
  const pricing =
    source.pricing === undefined
      ? undefined
      : snapshotPricing(source.pricing, role);
  const ledger = new BudgetLedger({
    requests: limits.maxCalls,
    tokens: limits.maxReservedInputTokens,
  });
  const scheduler = new DecisionScheduler({
    providerConcurrency: limits.concurrency,
    tenantConcurrency: limits.concurrency,
    maxQueue: limits.maxQueue,
    budget: ledger,
  });
  return Object.freeze({
    role,
    providerId: source.providerId,
    modelId: source.modelId,
    modelVersion: source.modelVersion,
    responseModel: source.responseModel,
    modelVersionEvidence,
    probabilitySemantics: source.probabilitySemantics,
    capabilities,
    pricing,
    limits,
    tenantId,
    policyVersion,
    evaluate: source.evaluate.bind(source),
    ledger,
    scheduler,
  });
}

async function evaluateComponent(
  arm: TrustedProviderArm,
  state: FinanceAdvisoryState,
  context: FinanceDriverContext,
): Promise<ComponentResult> {
  let measurement: FinanceMeasuredProviderResult | undefined;
  let providerFailure: unknown;
  const provider: DecisionProvider = {
    id: arm.providerId,
    capabilities: arm.capabilities,
    evaluate: async (request, options) => {
      try {
        const candidate = await arm.evaluate(request, options);
        measurement = validateMeasurement(candidate);
        return measurement.response;
      } catch (error) {
        providerFailure = error;
        throw error;
      }
    },
  };
  const runtime = new FabricRuntime({
    provider,
    model: arm.responseModel,
    cache: noStoreCache,
    scheduler: arm.scheduler,
    policyVersion: arm.policyVersion,
    estimatedTokens: arm.limits.estimatedInputTokensPerCall,
    retry: retryOnce,
    now: () => context.evaluationNowEpochMs,
  });
  const result = await runtime.evaluate({
    pack: financeSurveillancePack,
    state,
    tenantId: arm.tenantId,
    action: "finance-surveillance",
    knownActions: ["finance-surveillance"],
    authorization: {
      principalId: "finance-benchmark-driver",
      tenantId: arm.tenantId,
      workspaceId: "finance-benchmark",
      resourceScopes: ["finance:advisory"],
      actionScopes: ["finance-surveillance"],
      permissionEpoch: "finance-benchmark-1",
      approvalReferences: [],
      expiresAt: "9999-12-31T23:59:59.999Z",
    },
    signal: context.signal,
    deadlineMs: arm.limits.deadlineMs,
  });
  if (result.termination)
    throw new Error(`finance provider decision ${result.termination}`);
  if (providerFailure instanceof FinanceMeasurementError) throw providerFailure;
  if (providerFailure !== undefined)
    throw new TypeError("finance provider invocation failed", {
      cause: providerFailure,
    });
  if (measurement === undefined)
    throw new TypeError("provider-backed finance decision unavailable");
  validateRuntimeResult(result, measurement.response, arm);
  const probabilities = routeProbabilities(result.answers);
  const route = financeRoute(result.semantic.selectedId);
  return Object.freeze({
    role: arm.role,
    route,
    probabilities,
    atomicEvidence: financeAtomicLedger(
      arm.role,
      context.questionSetHash,
      result.answers,
      state,
    ),
    inputTokens: measurement.inputTokens,
    outputTokens: measurement.outputTokens,
    costNanoUsd: measuredCost(measurement, arm.pricing),
    providerRequestIdHash: measurement.providerRequestIdHash ?? null,
  });
}

function validateRuntimeResult(
  result: Awaited<ReturnType<FabricRuntime["evaluate"]>>,
  response: DecisionResponse,
  arm: TrustedProviderArm,
): void {
  if (result.semantic.status !== "decision")
    throw new TypeError("provider-backed finance decision is not a decision");
  const route = financeRoute(result.semantic.selectedId);
  if (result.semantic.metadata.execution !== "NOT_SUPPORTED")
    throw new TypeError("finance provider crossed the no-execution boundary");
  if (
    response.providerId !== arm.providerId ||
    result.receipt.providerId !== arm.providerId
  )
    throw new TypeError("finance provider identity mismatch");
  if (
    response.model !== arm.responseModel ||
    result.receipt.model !== arm.responseModel
  )
    throw new TypeError("finance provider model mismatch");
  if (
    response.probabilitySemantics !== arm.probabilitySemantics ||
    result.receipt.probabilitySemantics !== arm.probabilitySemantics
  )
    throw new TypeError("finance provider probability semantics mismatch");
  if (result.receipt.cache !== "miss" || result.receipt.fallback !== "none")
    throw new TypeError(
      "finance benchmark requires an uncached provider decision",
    );
  if (result.receipt.policyVersion !== arm.policyVersion)
    throw new TypeError("finance receipt policy version mismatch");
  // This authorization exists only to exercise policy composition for the
  // non-executable advisory action. No order-entry action or executor exists.
  const expectedOutcome = {
    observe: "route",
    investigate: "ask",
    escalate: "escalate",
  } as const;
  if (result.receipt.outcome !== expectedOutcome[route])
    throw new TypeError("finance receipt outcome does not match its route");
  if (
    result.accounting.logicalRequestCount !== 1 ||
    result.accounting.transportAttemptCount !== 1
  )
    throw new TypeError(
      "finance provider must use exactly one transport attempt",
    );
}

function measuredDriverResult(result: ComponentResult): FinanceDriverResult {
  return {
    status: "predicted",
    predictedRoute: result.route,
    routeQuestionProbabilities: result.probabilities,
    calibrationStatus: "measured",
    atomicEvidence: [result.atomicEvidence],
    abstained: false,
    unsafeExecutionAttempt: false,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costNanoUsd: result.costNanoUsd,
    componentAccounting: [componentAccounting(result)],
  };
}

function financeAtomicLedger(
  role: "host" | "jev",
  questionSetHash: string,
  answers: readonly import("../../../packages/protocol/src/index.js").DecisionAnswer[],
  state: FinanceAdvisoryState,
): FinanceAtomicEvidenceLedger {
  const candidateBindings: FinanceAtomicCandidateBinding[] =
    state.text?.candidates.map((candidate) => {
      const cited = candidate.claim !== undefined;
      return Object.freeze({
        candidateId: candidate.id,
        evidenceHash: candidateEvidenceHash(candidate),
        claimQuestionId: `${cited ? "finance-text-claim-cited:" : "finance-text-claim:"}${candidate.id}`,
        citationQuestionId: cited
          ? `finance-text-citation:${candidate.id}`
          : null,
      });
    }) ?? [];
  const bindingByQuestion = new Map<string, FinanceAtomicCandidateBinding>();
  for (const binding of candidateBindings) {
    bindingByQuestion.set(binding.claimQuestionId, binding);
    if (binding.citationQuestionId !== null)
      bindingByQuestion.set(binding.citationQuestionId, binding);
  }
  const questions = answers.map((answer) => {
    if (answer.type !== "choice")
      throw new TypeError("finance atomic ledger requires Choice answers");
    const binding = bindingByQuestion.get(answer.questionId);
    return Object.freeze({
      questionId: answer.questionId,
      selected: answer.selected,
      probabilities: Object.freeze({ ...answer.probabilities }),
      candidateId: binding?.candidateId ?? null,
      evidenceHash: binding?.evidenceHash ?? null,
    });
  });
  return Object.freeze({
    role,
    questionSetHash,
    candidateBindings: Object.freeze(candidateBindings),
    questions: Object.freeze(questions),
  });
}

function candidateEvidenceHash(
  candidate: NonNullable<FinanceAdvisoryState["text"]>["candidates"][number],
): string {
  return `sha256:${createHash("sha256")
    .update(
      stableJson({
        id: candidate.id,
        excerptHash: candidate.excerptHash,
        ...(candidate.claimHash === undefined
          ? {}
          : { claimHash: candidate.claimHash }),
        ...(candidate.sourceSpan === undefined
          ? {}
          : { sourceSpan: candidate.sourceSpan }),
      }),
    )
    .digest("hex")}`;
}

function componentAccounting(result: ComponentResult) {
  return Object.freeze({
    role: result.role,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costNanoUsd: result.costNanoUsd,
    providerRequestIdHash: result.providerRequestIdHash,
  });
}

function routeProbabilities(
  answers: readonly import("../../../packages/protocol/src/index.js").DecisionAnswer[],
): FinanceRouteProbabilities {
  const answer = answers.find(
    (candidate) =>
      candidate.questionId === "finance-route" && candidate.type === "choice",
  );
  if (answer?.type !== "choice")
    throw new TypeError("finance provider omitted the raw route distribution");
  const probabilities = answer.probabilities;
  const keys = Object.keys(probabilities);
  if (
    keys.length !== financeRoutes.length ||
    financeRoutes.some((route) => !(route in probabilities))
  )
    throw new TypeError("finance route probabilities are incomplete");
  return Object.freeze({
    observe: probabilities.observe ?? invalidProbability(),
    investigate: probabilities.investigate ?? invalidProbability(),
    escalate: probabilities.escalate ?? invalidProbability(),
  });
}

function validateMeasurement(
  value: FinanceMeasuredProviderResult,
): FinanceMeasuredProviderResult {
  if (!value || typeof value !== "object" || !value.response)
    throw new FinanceMeasurementError(
      "finance provider measurement is invalid",
    );
  const inputNull = value.inputTokens === null;
  const outputNull = value.outputTokens === null;
  if (inputNull !== outputNull)
    throw new FinanceMeasurementError(
      "finance provider token accounting must be paired",
    );
  if (!inputNull) {
    safeNonNegative(value.inputTokens, "inputTokens");
    safeNonNegative(value.outputTokens as number, "outputTokens");
  }
  const providerRequestIdHash = value.providerRequestIdHash ?? null;
  if (providerRequestIdHash !== null && !sha256.test(providerRequestIdHash))
    throw new FinanceMeasurementError(
      "finance provider request ID hash is invalid",
    );
  return Object.freeze({
    response: value.response,
    inputTokens: value.inputTokens,
    outputTokens: value.outputTokens,
    providerRequestIdHash,
  });
}

function measuredCost(
  measurement: FinanceMeasuredProviderResult,
  pricing: FinanceProviderPricing | undefined,
): string | null {
  if (pricing === undefined || measurement.inputTokens === null) return null;
  const outputTokens = measurement.outputTokens;
  if (outputTokens === null)
    throw new TypeError("finance provider token accounting must be paired");
  return (
    BigInt(measurement.inputTokens) * BigInt(pricing.inputNanoUsdPerToken) +
    BigInt(outputTokens) * BigInt(pricing.outputNanoUsdPerToken)
  ).toString();
}

function deterministicRoute(state: FinanceAdvisoryState): FinanceRoute {
  if (
    state.signals.some(
      ({ bucket }) => bucket === "extreme" || bucket === "unknown",
    )
  )
    return "escalate";
  return state.signals.some(({ bucket }) => bucket === "elevated")
    ? "investigate"
    : "observe";
}

function restrictiveRoute(
  left: FinanceRoute,
  right: FinanceRoute,
): FinanceRoute {
  const rank: Readonly<Record<FinanceRoute, number>> = {
    observe: 0,
    investigate: 1,
    escalate: 2,
  };
  return rank[left] >= rank[right] ? left : right;
}

function combineTokens(
  left: ComponentResult,
  right: ComponentResult,
): {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
} {
  if (left.inputTokens === null || right.inputTokens === null)
    return { inputTokens: null, outputTokens: null };
  if (left.outputTokens === null || right.outputTokens === null)
    throw new TypeError("finance provider token accounting must be paired");
  return {
    inputTokens: checkedAdd(
      left.inputTokens,
      right.inputTokens,
      "inputTokens total",
    ),
    outputTokens: checkedAdd(
      left.outputTokens,
      right.outputTokens,
      "outputTokens total",
    ),
  };
}

function addOptionalCosts(
  left: string | null,
  right: string | null,
): string | null {
  return left === null || right === null
    ? null
    : (BigInt(left) + BigInt(right)).toString();
}

function checkedAdd(left: number, right: number, name: string): number {
  const total = left + right;
  if (!Number.isSafeInteger(total)) throw new RangeError(`${name} is not safe`);
  return total;
}

function architectureProvenance(
  host: TrustedProviderArm,
  jev: TrustedProviderArm,
): FinanceRuntimeProvenance["architectures"] {
  const deterministicComponent = Object.freeze({
    role: "deterministic" as const,
    providerId: "deterministic",
    modelId: "finance-signal-lattice",
    modelVersion: "1",
    responseModel: "1",
    modelVersionEvidence: Object.freeze({ kind: "response_exact" as const }),
    probabilitySemantics: "none" as const,
    pricing: null,
  });
  const component = (arm: TrustedProviderArm) =>
    Object.freeze({
      role: arm.role,
      providerId: arm.providerId,
      modelId: arm.modelId,
      modelVersion: arm.modelVersion,
      responseModel: arm.responseModel,
      modelVersionEvidence: arm.modelVersionEvidence,
      probabilitySemantics: arm.probabilitySemantics,
      pricing: arm.pricing ?? null,
    });
  const hostComponent = component(host);
  const jevComponent = component(jev);
  const architecture = (
    components: ArchitectureRuntime["components"],
    combinerId: string,
    combinerVersion = "1",
  ): ArchitectureRuntime =>
    Object.freeze({
      components: Object.freeze([...components]),
      combinerId,
      combinerVersion,
    });
  return Object.freeze({
    deterministic_only: architecture(
      [deterministicComponent],
      "finance-deterministic-signal-lattice",
    ),
    host_model_only: architecture([hostComponent], "single-provider"),
    jev_advisory: architecture(
      [jevComponent],
      financeSurveillancePack.manifest.id,
      financeSurveillancePack.manifest.version,
    ),
    host_plus_jev: architecture(
      [hostComponent, jevComponent],
      "restrictive-route-lattice",
    ),
  });
}

function snapshotCapabilities(
  value: ProviderCapabilities,
  role: string,
): ProviderCapabilities {
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray(value.questionTypes) ||
    !Array.isArray(value.probabilitySemantics) ||
    !Number.isSafeInteger(value.maxQuestions) ||
    value.maxQuestions < 1
  )
    throw new TypeError(`${role} provider capabilities are invalid`);
  return Object.freeze({
    questionTypes: Object.freeze([...value.questionTypes]),
    probabilitySemantics: Object.freeze([...value.probabilitySemantics]),
    maxQuestions: value.maxQuestions,
  });
}

function snapshotLimits(
  value: FinanceProviderLimits,
  role: string,
): FinanceProviderLimits {
  if (!value || typeof value !== "object")
    throw new TypeError(`${role} provider limits are required`);
  for (const [name, item] of Object.entries(value)) {
    if (!Number.isSafeInteger(item) || item < 0)
      throw new RangeError(
        `${role} ${name} must be a non-negative safe integer`,
      );
  }
  if (
    value.maxCalls < 1 ||
    value.maxReservedInputTokens < 1 ||
    value.estimatedInputTokensPerCall < 1 ||
    value.concurrency < 1 ||
    value.concurrency > 16 ||
    value.deadlineMs < 1
  )
    throw new RangeError(`${role} provider limits are invalid`);
  return Object.freeze({ ...value });
}

function snapshotPricing(
  value: FinanceProviderPricing,
  role: string,
): FinanceProviderPricing {
  if (!value || typeof value !== "object")
    throw new TypeError(`${role} provider pricing is invalid`);
  for (const [name, amount] of [
    ["inputNanoUsdPerToken", value.inputNanoUsdPerToken],
    ["outputNanoUsdPerToken", value.outputNanoUsdPerToken],
  ] as const)
    if (!nonNegativeInteger.test(amount))
      throw new TypeError(`${role} ${name} must be an integer string`);
  const source = new URL(value.sourceUrl);
  if (
    source.protocol !== "https:" ||
    source.username ||
    source.password ||
    source.search ||
    source.hash ||
    source.toString() !== value.sourceUrl
  )
    throw new TypeError(`${role} pricing sourceUrl must be canonical HTTPS`);
  const observedAt = Date.parse(value.observedAt);
  if (
    !Number.isFinite(observedAt) ||
    new Date(observedAt).toISOString() !== value.observedAt
  )
    throw new TypeError(`${role} pricing observedAt is invalid`);
  nonempty(value.priceVersion, `${role} priceVersion`);
  if (!sha256.test(value.priceHash))
    throw new TypeError(`${role} priceHash is invalid`);
  return Object.freeze({
    inputNanoUsdPerToken: value.inputNanoUsdPerToken,
    outputNanoUsdPerToken: value.outputNanoUsdPerToken,
    sourceUrl: source.toString(),
    observedAt: value.observedAt,
    priceVersion: value.priceVersion,
    priceHash: value.priceHash,
  });
}

function snapshotModelVersionEvidence(
  value: ArchitectureRuntimeModelVersionEvidence,
  modelVersion: string,
  responseModel: string,
  role: string,
): ArchitectureRuntimeModelVersionEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${role} modelVersionEvidence is invalid`);
  if (value.kind === "response_exact") {
    if (Reflect.ownKeys(value).length !== 1 || responseModel !== modelVersion)
      throw new TypeError(
        `${role} response-exact version evidence requires an exact response model`,
      );
    return Object.freeze({ kind: "response_exact" });
  }
  if (
    value.kind !== "external_attestation" ||
    Reflect.ownKeys(value).length !== 4 ||
    !sha256.test(value.evidenceHash)
  )
    throw new TypeError(`${role} external model version evidence is invalid`);
  const source = new URL(value.sourceUrl);
  if (
    source.protocol !== "https:" ||
    source.username ||
    source.password ||
    source.search ||
    source.hash ||
    source.toString() !== value.sourceUrl
  )
    throw new TypeError(
      `${role} model version sourceUrl must be canonical HTTPS`,
    );
  const observedAt = Date.parse(value.observedAt);
  if (
    !Number.isFinite(observedAt) ||
    new Date(observedAt).toISOString() !== value.observedAt
  )
    throw new TypeError(`${role} model version observedAt is invalid`);
  return Object.freeze({
    kind: "external_attestation",
    sourceUrl: source.toString(),
    observedAt: value.observedAt,
    evidenceHash: value.evidenceHash,
  });
}

function driverContext(
  context: FinanceDriverContext,
  architecture: FinanceArchitecture,
): void {
  if (context.architecture !== architecture)
    throw new TypeError(`finance driver context must be ${architecture}`);
  if (!Number.isFinite(context.evaluationNowEpochMs))
    throw new TypeError("finance driver evaluation time must be finite");
}

function financeRoute(value: unknown): FinanceRoute {
  if (
    typeof value !== "string" ||
    !financeRoutes.includes(value as FinanceRoute)
  )
    throw new TypeError("finance provider returned an invalid semantic route");
  return value as FinanceRoute;
}

function invalidProbability(): never {
  throw new TypeError("finance route probabilities are incomplete");
}

function safeNonNegative(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`${name} must be a non-negative safe integer`);
}

function identifier(value: string, name: string): void {
  if (typeof value !== "string" || !portableIdentifier.test(value))
    throw new TypeError(`${name} must be a portable identifier`);
}

function nonempty(value: string, name: string): void {
  if (typeof value !== "string" || value.length === 0)
    throw new TypeError(`${name} is required`);
}

function probabilitySemantics(value: string, role: string): void {
  if (
    ![
      "native_calibrated",
      "normalized_logits",
      "self_reported",
      "synthetic",
      "unknown",
    ].includes(value)
  )
    throw new TypeError(`${role} probability semantics are invalid`);
}

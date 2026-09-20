import { performance } from "node:perf_hooks";
import {
  compileCandidates,
  projectState,
  sha256Digest,
} from "../../../packages/core/src/index.js";
import {
  type DecisionAnswer,
  type DecisionQuestion,
  type DecisionRequest,
  type DecisionResponse,
  decisionResponseSchema,
  type EvaluateOptions,
  validateDecisionResponse,
} from "../../../packages/protocol/src/index.js";
import {
  fintechExceptionPack,
  fintechExceptionQuestionSetHash,
} from "../../../packs/fintech-exception/pack.js";
import {
  assertFintechEvidence,
  type FintechDatasetCase,
  type FintechEvidence,
  type FintechRoute,
  type FintechSignalId,
  type FintechTrace,
  fintechBaseline,
  fintechCaseSetDigest,
  fintechSignalIds,
  recomputeFintechMetrics,
} from "./evidence.mjs";

const concreteJevModel = /^jev-\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u;
const sha256Pattern = /^sha256:[a-f0-9]{64}$/u;
const maxCases = 100;
const maxConcurrency = 32;
const maxAttempts = 3;
const maxProviderInvocations = 1_000;
const maxTokens = 10_000_000;
const maxInputNanoUsdPerToken = 1_000_000_000_000n;

export interface FintechBenchmarkCase {
  readonly caseId: string;
  readonly groupId: string;
  readonly split: "calibration" | "test";
  /** Trusted evaluation time used only by the pack's freshness projector. */
  readonly evaluationNowEpochMs: number;
  /** Raw host input. It is projected before use and is never retained. */
  readonly state: unknown;
  readonly goldRoute: FintechRoute;
  readonly goldSignals: Readonly<Record<FintechSignalId, boolean>>;
}

export interface FintechMeasuredEvaluation {
  /** Runtime validation is mandatory; hostile or malformed values are metered. */
  readonly response: unknown;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
  /** Hash-only upstream identity, or explicit null when the header is absent. */
  readonly providerRequestIdHash: string | null;
}

/**
 * Credential-isolation seam. The benchmark owns policy, budgets, timing, and
 * evidence; the injected evaluator owns exactly one metered provider request.
 */
export interface FintechMeasuredEvaluator {
  readonly providerId: "typesafe-native";
  readonly model: string;
  readonly probabilitySemantics: "native_calibrated";
  readonly transport: string;
  evaluate(
    request: DecisionRequest,
    options: EvaluateOptions,
  ): Promise<FintechMeasuredEvaluation>;
}

export interface FintechProviderWithMetadata {
  readonly id: string;
  evaluateWithMetadata(
    request: DecisionRequest,
    options?: EvaluateOptions,
  ): Promise<{
    readonly response: DecisionResponse;
    readonly usage: {
      readonly inputTokens?: number | undefined;
      readonly outputTokens?: number | undefined;
    };
    readonly providerRequestIdHash?: string | undefined;
  }>;
}

export interface FintechBenchmarkOptions {
  readonly runId: string;
  readonly createdAt: string;
  readonly preregisteredAt: string;
  readonly frozenAt: string;
  readonly evaluator: FintechMeasuredEvaluator;
  readonly dataset: {
    readonly datasetId: string;
    readonly sourceUrl: string;
    readonly license: string;
    readonly evidenceClass:
      | "SYNTHETIC"
      | "LOCAL_EXPLORATORY"
      | "RETAINED_PUBLIC";
    readonly redistributionAllowed: true;
    readonly containsPersonalData: false;
    readonly containsRegulatedData: false;
    readonly deidentified: true;
  };
  readonly pricing: {
    readonly inputNanoUsdPerToken: string;
    readonly sourceUrl: string;
    readonly sourceDigest: string;
    readonly observedAt: string;
  };
  readonly limits: {
    readonly concurrency: number;
    readonly maxProviderInvocations: number;
    readonly maxInputTokens: number;
    /** Conservative pre-call reservation. Actual usage may not exceed it. */
    readonly reservedInputTokensPerInvocation: number;
    readonly maxAttempts: number;
    readonly deadlineMs: number;
  };
}

interface ProjectedCase {
  readonly source: FintechBenchmarkCase;
  readonly datasetCase: FintechDatasetCase;
  readonly state: DecisionRequest["state"];
  readonly questions: readonly DecisionQuestion[];
  readonly candidates: readonly {
    readonly id: string;
    readonly description: string;
  }[];
}

interface ArmAccounting {
  providerInvocationCount: number;
  providerRequestIdHashes: (string | null)[];
  inputTokens: number;
  outputTokens: number;
  providerMs: number;
}

class BenchmarkIntegrityError extends Error {
  override name = "BenchmarkIntegrityError";
}

class GlobalBudget {
  #invocations = 0;
  #consumedInputTokens = 0;
  #reservedInputTokens = 0;
  #aborted = false;

  constructor(private readonly limits: FintechBenchmarkOptions["limits"]) {}

  reserve(): {
    settle(inputTokens: number): void;
    abandon(): void;
  } {
    if (this.#aborted)
      throw new BenchmarkIntegrityError(
        "benchmark aborted after another worker failed",
      );
    if (this.#invocations + 1 > this.limits.maxProviderInvocations)
      throw new RangeError("provider invocation budget exhausted before call");
    if (
      this.#consumedInputTokens +
        this.#reservedInputTokens +
        this.limits.reservedInputTokensPerInvocation >
      this.limits.maxInputTokens
    )
      throw new RangeError(
        "input token reservation budget exhausted before call",
      );
    this.#invocations += 1;
    this.#reservedInputTokens += this.limits.reservedInputTokensPerInvocation;
    let open = true;
    const release = () => {
      if (!open) return false;
      open = false;
      this.#reservedInputTokens -= this.limits.reservedInputTokensPerInvocation;
      return true;
    };
    return {
      settle: (inputTokens) => {
        if (!release())
          throw new BenchmarkIntegrityError("budget settled twice");
        if (inputTokens > this.limits.reservedInputTokensPerInvocation)
          throw new RangeError(
            "input token budget exceeded its pre-call reservation",
          );
        this.#consumedInputTokens += inputTokens;
        if (
          this.#consumedInputTokens + this.#reservedInputTokens >
          this.limits.maxInputTokens
        )
          throw new RangeError("input token budget exceeded");
      },
      abandon: () => {
        release();
      },
    };
  }

  abort(): void {
    this.#aborted = true;
  }
}

/**
 * Adapts the repository's TypeSafe provider without reading a credential or an
 * environment variable. The caller constructs the provider and pins transport.
 */
export function createFintechMeasuredEvaluator(
  provider: FintechProviderWithMetadata,
  options: { readonly model: string; readonly transport: string },
): FintechMeasuredEvaluator {
  if (provider.id !== "typesafe-native")
    throw new TypeError(
      "fintech evidence requires the native TypeSafe provider",
    );
  return Object.freeze({
    providerId: "typesafe-native" as const,
    model: options.model,
    probabilitySemantics: "native_calibrated" as const,
    transport: options.transport,
    evaluate: async (request: DecisionRequest, evaluate: EvaluateOptions) => {
      const result = await provider.evaluateWithMetadata(request, evaluate);
      if (
        result.usage.inputTokens === undefined ||
        result.usage.outputTokens === undefined
      )
        throw new BenchmarkIntegrityError(
          "provider result is missing exact token usage",
        );
      return {
        response: result.response,
        providerRequestIdHash: result.providerRequestIdHash ?? null,
        usage: {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
        },
      };
    },
  });
}

export async function runFintechBenchmark(
  cases: readonly FintechBenchmarkCase[],
  options: FintechBenchmarkOptions,
): Promise<FintechEvidence> {
  validateRunInputs(cases, options);
  const projected = cases.map(projectCase);
  const datasetCases = projected.map((item) => item.datasetCase);
  const dataset = {
    status: "RETAINED" as const,
    ...options.dataset,
    caseSetDigest: fintechCaseSetDigest(datasetCases),
    contentRetention: "digests_and_labels_only" as const,
    splitPolicy: "group_disjoint_preregistered" as const,
    frozenAt: options.frozenAt,
    cases: datasetCases,
  };
  const budget = new GlobalBudget(options.limits);
  const traceGroups = await mapLimit(
    projected,
    options.limits.concurrency,
    async (item, caseIndex) => runCase(item, caseIndex, options, budget),
    () => budget.abort(),
  );
  const traces = traceGroups.flat();
  const partial: FintechEvidence = {
    schemaVersion: "2",
    runId: options.runId,
    executionState: "COMPLETED",
    createdAt: options.createdAt,
    taskContract: {
      id: "fintech-exception-routing-v2",
      frozen: true,
      preregisteredAt: options.preregisteredAt,
      primaryMetric: "held_out_route_accuracy",
      armOrderPolicy: "alternating_by_canonical_case_index_v1",
      prohibitedClaims: ["financial_authorization", "execution", "identity"],
    },
    pack: {
      id: "fintech-exception",
      version: "0.2.0",
      questionSetHash: fintechExceptionQuestionSetHash,
    },
    baseline: fintechBaseline,
    pricing: {
      currency: "USD",
      inputNanoUsdPerToken: options.pricing.inputNanoUsdPerToken,
      outputPricing: "FREE",
      sourceUrl: options.pricing.sourceUrl,
      sourceDigest: options.pricing.sourceDigest,
      observedAt: options.pricing.observedAt,
    },
    dataset,
    traces,
    metrics: null,
  };
  const evidence: FintechEvidence = {
    ...partial,
    metrics: recomputeFintechMetrics(partial),
  };
  assertFintechEvidence(evidence);
  return evidence;
}

function projectCase(input: FintechBenchmarkCase): ProjectedCase {
  const implementations = fintechExceptionPack.implementations;
  if (implementations === undefined)
    throw new BenchmarkIntegrityError("fintech pack implementation is missing");
  const state = projectState(
    implementations.projector,
    input.state,
    fintechExceptionPack.manifest.limits,
    { nowEpochMs: input.evaluationNowEpochMs },
  );
  if (implementations.bypass?.(state) !== undefined)
    throw new TypeError(
      "benchmark cases cannot trigger a deterministic bypass",
    );
  const compiledCandidates = compileCandidates(
    implementations.candidates,
    state,
    fintechExceptionPack.manifest.limits,
  );
  const candidates = compiledCandidates.map(({ id, description }) => ({
    id,
    description,
  }));
  const questions = implementations.questions(state, candidates);
  if (
    questions.length !== fintechSignalIds.length ||
    !fintechSignalIds.every((id) =>
      questions.some(
        (question) => question.id === id && question.type === "noul",
      ),
    )
  )
    throw new BenchmarkIntegrityError("fintech question contract drifted");
  const providerStateDigest = `sha256:${sha256Digest(
    state,
    "jev-fabric/projected-state/v1",
  )}`;
  return {
    source: input,
    datasetCase: {
      caseId: input.caseId,
      groupId: input.groupId,
      split: input.split,
      providerStateDigest,
      goldRoute: input.goldRoute,
      goldSignals: input.goldSignals,
    },
    state,
    questions,
    candidates,
  };
}

async function runCase(
  item: ProjectedCase,
  caseIndex: number,
  options: FintechBenchmarkOptions,
  budget: GlobalBudget,
): Promise<readonly FintechTrace[]> {
  const baselineStarted = performance.now();
  const baselineRoute: FintechRoute = "investigate";
  const baselineMs = performance.now() - baselineStarted;
  const baseline = trace(item, "no_jev", {
    valid: true,
    route: baselineRoute,
    routeScore: null,
    signals: [],
    accounting: emptyAccounting(),
    caseExecutionOrdinal: 0,
    endToEndMs: baselineMs,
    price: options.pricing.inputNanoUsdPerToken,
    evaluator: options.evaluator,
  });
  let batched: FintechTrace;
  let serial: FintechTrace;
  if (caseIndex % 2 === 0) {
    batched = await runJevArm(item, "jev_batched", 1, options, budget);
    serial = await runJevArm(item, "jev_serial", 2, options, budget);
  } else {
    serial = await runJevArm(item, "jev_serial", 1, options, budget);
    batched = await runJevArm(item, "jev_batched", 2, options, budget);
  }
  return [baseline, batched, serial];
}

async function runJevArm(
  item: ProjectedCase,
  arm: "jev_batched" | "jev_serial",
  caseExecutionOrdinal: 1 | 2,
  options: FintechBenchmarkOptions,
  budget: GlobalBudget,
): Promise<FintechTrace> {
  const started = performance.now();
  const accounting = emptyAccounting();
  const answers: DecisionAnswer[] = [];
  let valid = true;
  if (arm === "jev_batched") {
    const result = await evaluateQuestions(
      item,
      arm,
      item.questions,
      options,
      budget,
      accounting,
    );
    if (result === null) valid = false;
    else answers.push(...result);
  } else {
    for (const question of item.questions) {
      const result = await evaluateQuestions(
        item,
        arm,
        [question],
        options,
        budget,
        accounting,
      );
      if (result === null) {
        valid = false;
        break;
      }
      answers.push(...result);
    }
  }
  let route: FintechRoute = "escalate";
  let signals: FintechTrace["signals"] = [];
  let routeScore: number | null = null;
  if (valid) {
    signals = fintechSignalIds.map((signalId) => {
      const answer = answers.find(
        (candidate) => candidate.questionId === signalId,
      );
      if (
        answer?.type !== "noul" ||
        typeof answer.value !== "boolean" ||
        typeof answer.probabilityYes !== "number" ||
        !Number.isFinite(answer.probabilityYes) ||
        answer.probabilityYes < 0 ||
        answer.probabilityYes > 1 ||
        answer.value !== answer.probabilityYes >= 0.5
      )
        throw new BenchmarkIntegrityError(
          "validated Noul answer became invalid",
        );
      return {
        signalId,
        value: answer.value,
        probabilityYes: answer.probabilityYes,
      };
    });
    const semantic = fintechExceptionPack.implementations?.interpret(
      answers,
      item.candidates,
      {
        providerId: options.evaluator.providerId,
        model: options.evaluator.model,
        probabilitySemantics: "native_calibrated",
      },
    );
    if (
      semantic?.status !== "decision" ||
      !["observe", "investigate", "escalate"].includes(
        semantic.selectedId ?? "",
      )
    )
      throw new BenchmarkIntegrityError("fintech interpretation failed");
    route = semantic.selectedId as FintechRoute;
    routeScore = Math.min(
      ...signals.map((signal) =>
        signal.value ? signal.probabilityYes : 1 - signal.probabilityYes,
      ),
    );
  }
  return trace(item, arm, {
    valid,
    route,
    routeScore,
    signals,
    accounting,
    caseExecutionOrdinal,
    endToEndMs: performance.now() - started,
    price: options.pricing.inputNanoUsdPerToken,
    evaluator: options.evaluator,
  });
}

async function evaluateQuestions(
  item: ProjectedCase,
  arm: "jev_batched" | "jev_serial",
  questions: readonly DecisionQuestion[],
  options: FintechBenchmarkOptions,
  budget: GlobalBudget,
  accounting: ArmAccounting,
): Promise<readonly DecisionAnswer[] | null> {
  for (let attempt = 1; attempt <= options.limits.maxAttempts; attempt += 1) {
    const request: DecisionRequest = {
      id: requestId(options.runId, item.source.caseId, arm, questions, attempt),
      state: item.state,
      questions,
    };
    const measured = await invoke(request, options, budget);
    accounting.providerInvocationCount += 1;
    accounting.providerRequestIdHashes.push(measured.providerRequestIdHash);
    accounting.inputTokens += measured.usage.inputTokens;
    accounting.outputTokens += measured.usage.outputTokens;
    accounting.providerMs += measured.providerMs;
    const parsed = decisionResponseSchema.safeParse(measured.response);
    if (!parsed.success) continue;
    const response = parsed.data;
    assertProviderIdentity(request, response, options.evaluator);
    try {
      const answers = validateDecisionResponse(request, response).answers;
      if (validNativeNoulAnswers(answers, questions)) return answers;
    } catch {
      // This is a metered malformed answer, so it may be retried and retained.
    }
  }
  return null;
}

async function invoke(
  request: DecisionRequest,
  options: FintechBenchmarkOptions,
  budget: GlobalBudget,
): Promise<FintechMeasuredEvaluation & { readonly providerMs: number }> {
  const reservation = budget.reserve();
  const started = performance.now();
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort("fintech benchmark provider deadline");
        reject(new Error("provider deadline elapsed"));
      }, options.limits.deadlineMs);
    });
    const measured = await Promise.race([
      options.evaluator.evaluate(request, {
        signal: controller.signal,
        deadlineMs: options.limits.deadlineMs,
      }),
      deadline,
    ]);
    validateUsage(measured.usage);
    validateProviderRequestIdHash(measured.providerRequestIdHash);
    reservation.settle(measured.usage.inputTokens);
    return { ...measured, providerMs: performance.now() - started };
  } catch (error) {
    reservation.abandon();
    if (error instanceof RangeError || error instanceof BenchmarkIntegrityError)
      throw error;
    throw new BenchmarkIntegrityError(
      `unmetered provider failure: ${safeErrorName(error)}`,
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function assertProviderIdentity(
  request: DecisionRequest,
  response: DecisionResponse,
  evaluator: FintechMeasuredEvaluator,
): void {
  if (response.requestId !== request.id)
    throw new BenchmarkIntegrityError(
      "provider identity request binding drifted",
    );
  if (response.providerId !== evaluator.providerId)
    throw new BenchmarkIntegrityError("provider identity drifted");
  if (response.model !== evaluator.model)
    throw new BenchmarkIntegrityError("model identity drifted");
  if (response.probabilitySemantics !== evaluator.probabilitySemantics)
    throw new BenchmarkIntegrityError("probability semantics drifted");
}

function trace(
  item: ProjectedCase,
  arm: FintechTrace["arm"],
  value: {
    readonly valid: boolean;
    readonly route: FintechRoute;
    readonly routeScore: number | null;
    readonly signals: FintechTrace["signals"];
    readonly accounting: ArmAccounting;
    readonly caseExecutionOrdinal: 0 | 1 | 2;
    readonly endToEndMs: number;
    readonly price: string;
    readonly evaluator: FintechMeasuredEvaluator;
  },
): FintechTrace {
  const jev = arm !== "no_jev";
  return {
    schemaVersion: "2",
    traceId: `trace-${sha256Digest(
      { caseId: item.source.caseId, arm },
      "jev-fabric/fintech-trace-id/v1",
    ).slice(0, 32)}`,
    caseId: item.source.caseId,
    groupId: item.source.groupId,
    split: item.source.split,
    arm,
    valid: value.valid,
    route: value.route,
    routeScore: value.routeScore,
    signals: value.signals,
    runtime: {
      caseExecutionOrdinal: value.caseExecutionOrdinal,
      providerInvocationCount: value.accounting.providerInvocationCount,
      providerRequestIdHashes: [...value.accounting.providerRequestIdHashes],
      inputTokens: value.accounting.inputTokens,
      outputTokens: value.accounting.outputTokens,
      costNanoUsd: (
        BigInt(value.accounting.inputTokens) * BigInt(value.price)
      ).toString(),
      endToEndMs: value.endToEndMs,
      providerMs: value.accounting.providerMs,
      model: jev ? value.evaluator.model : null,
      transport: jev ? value.evaluator.transport : null,
      packId: "fintech-exception",
      packVersion: "0.2.0",
      questionSetHash: fintechExceptionQuestionSetHash,
    },
    boundary: {
      advisoryOnly: true,
      execution: "NOT_SUPPORTED",
      unsafeExecutionAttemptCount: 0,
      providerStateDigest: jev ? item.datasetCase.providerStateDigest : null,
      providerStateContainsGold: false,
      providerStateContainsRegulatedData: false,
      providerStateRedacted: true,
    },
  };
}

function validateRunInputs(
  cases: readonly FintechBenchmarkCase[],
  options: FintechBenchmarkOptions,
): void {
  if (!Array.isArray(cases) || cases.length < 2 || cases.length > maxCases)
    throw new RangeError(`fintech benchmark requires 2-${maxCases} cases`);
  if (
    options.evaluator.providerId !== "typesafe-native" ||
    !concreteJevModel.test(options.evaluator.model) ||
    options.evaluator.probabilitySemantics !== "native_calibrated" ||
    typeof options.evaluator.transport !== "string" ||
    options.evaluator.transport.length === 0
  )
    throw new TypeError("native Jev evaluator identity is invalid");
  if (typeof options.evaluator.evaluate !== "function")
    throw new TypeError("native Jev evaluator is missing evaluate");
  for (const [name, value] of [
    ["runId", options.runId],
    ["datasetId", options.dataset.datasetId],
    ["dataset license", options.dataset.license],
  ] as const)
    if (typeof value !== "string" || value.length === 0)
      throw new TypeError(`${name} is invalid`);
  const createdAt = exactTimestamp(options.createdAt, "createdAt");
  const preregisteredAt = exactTimestamp(
    options.preregisteredAt,
    "preregisteredAt",
  );
  const frozenAt = exactTimestamp(options.frozenAt, "frozenAt");
  const pricingObservedAt = exactTimestamp(
    options.pricing.observedAt,
    "pricing observedAt",
  );
  if (
    preregisteredAt > frozenAt ||
    frozenAt > createdAt ||
    pricingObservedAt > createdAt
  )
    throw new TypeError("benchmark evidence timestamps are out of order");
  safeHttpsUrl(options.dataset.sourceUrl, "dataset sourceUrl");
  safeHttpsUrl(options.pricing.sourceUrl, "pricing sourceUrl");
  const limits = options.limits;
  for (const [name, value] of Object.entries(limits))
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new RangeError(`${name} must be a positive safe integer`);
  if (limits.concurrency > maxConcurrency)
    throw new RangeError(`concurrency cannot exceed ${maxConcurrency}`);
  if (limits.maxAttempts > maxAttempts)
    throw new RangeError(`maxAttempts cannot exceed ${maxAttempts}`);
  if (limits.maxProviderInvocations > maxProviderInvocations)
    throw new RangeError(
      `maxProviderInvocations cannot exceed ${maxProviderInvocations}`,
    );
  if (limits.maxInputTokens > maxTokens)
    throw new RangeError(`maxInputTokens cannot exceed ${maxTokens}`);
  if (
    limits.reservedInputTokensPerInvocation > limits.maxInputTokens ||
    limits.maxProviderInvocations < cases.length * 2
  )
    throw new RangeError("benchmark limits cannot admit the minimum run");
  if (
    !/^(0|[1-9]\d{0,18})$/u.test(options.pricing.inputNanoUsdPerToken) ||
    BigInt(options.pricing.inputNanoUsdPerToken) > maxInputNanoUsdPerToken ||
    !sha256Pattern.test(options.pricing.sourceDigest)
  )
    throw new TypeError("pricing evidence is invalid");
  if (
    options.dataset.redistributionAllowed !== true ||
    options.dataset.containsPersonalData !== false ||
    options.dataset.containsRegulatedData !== false ||
    options.dataset.deidentified !== true ||
    !["SYNTHETIC", "LOCAL_EXPLORATORY", "RETAINED_PUBLIC"].includes(
      options.dataset.evidenceClass,
    )
  )
    throw new TypeError("public benchmark dataset boundary is invalid");
  const caseIds = new Set<string>();
  const groupSplits = new Map<string, Set<string>>();
  for (const item of cases) {
    if (!item.caseId || !item.groupId || caseIds.has(item.caseId))
      throw new TypeError(
        "benchmark case and group IDs must be nonempty and unique",
      );
    caseIds.add(item.caseId);
    if (item.split !== "calibration" && item.split !== "test")
      throw new TypeError("benchmark split is invalid");
    if (!Number.isFinite(item.evaluationNowEpochMs))
      throw new TypeError("benchmark evaluation time must be finite");
    if (
      !item.goldSignals ||
      typeof item.goldSignals !== "object" ||
      Array.isArray(item.goldSignals) ||
      Object.keys(item.goldSignals).length !== fintechSignalIds.length ||
      !fintechSignalIds.every(
        (id) =>
          Object.hasOwn(item.goldSignals, id) &&
          typeof item.goldSignals[id] === "boolean",
      )
    )
      throw new TypeError("benchmark gold signals are incomplete");
    if (routeFromGold(item.goldSignals) !== item.goldRoute)
      throw new TypeError("benchmark gold route does not match its signals");
    const splits = groupSplits.get(item.groupId) ?? new Set<string>();
    splits.add(item.split);
    groupSplits.set(item.groupId, splits);
  }
  if (
    !cases.some((item) => item.split === "calibration") ||
    !cases.some((item) => item.split === "test") ||
    [...groupSplits.values()].some((splits) => splits.size !== 1)
  )
    throw new TypeError("benchmark splits must be present and group-disjoint");
}

function routeFromGold(
  signals: Readonly<Record<FintechSignalId, boolean>>,
): FintechRoute {
  if (
    signals["fintech-urgent-consumer-harm"] ||
    signals["fintech-untrusted-influence"]
  )
    return "escalate";
  if (fintechSignalIds.slice(0, 4).some((id) => signals[id]))
    return "investigate";
  return "observe";
}

function validateUsage(value: FintechMeasuredEvaluation["usage"]): void {
  if (
    !value ||
    Object.keys(value).length !== 2 ||
    !Number.isSafeInteger(value.inputTokens) ||
    value.inputTokens <= 0 ||
    !Number.isSafeInteger(value.outputTokens) ||
    value.outputTokens < 0 ||
    value.inputTokens > maxTokens ||
    value.outputTokens > maxTokens
  )
    throw new BenchmarkIntegrityError(
      "provider result has invalid token usage",
    );
}

function validateProviderRequestIdHash(value: unknown): void {
  if (
    value !== null &&
    (typeof value !== "string" || !sha256Pattern.test(value))
  )
    throw new BenchmarkIntegrityError("provider request ID hash is invalid");
}

function validNativeNoulAnswers(
  answers: readonly DecisionAnswer[],
  questions: readonly DecisionQuestion[],
): boolean {
  if (answers.length !== questions.length) return false;
  const expected = new Set(questions.map((question) => question.id));
  for (const answer of answers) {
    if (
      !expected.delete(answer.questionId) ||
      answer.type !== "noul" ||
      typeof answer.value !== "boolean" ||
      typeof answer.probabilityYes !== "number" ||
      !Number.isFinite(answer.probabilityYes) ||
      answer.probabilityYes < 0 ||
      answer.probabilityYes > 1 ||
      answer.value !== answer.probabilityYes >= 0.5
    )
      return false;
  }
  return expected.size === 0;
}

function exactTimestamp(value: string, name: string): number {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value)
    throw new TypeError(
      `${name} must be a calendar-valid UTC millisecond timestamp`,
    );
  return epoch;
}

function safeHttpsUrl(value: string, name: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${name} must be an absolute URL`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  )
    throw new TypeError(
      `${name} must use https and contain no embedded credentials`,
    );
}

function requestId(
  runId: string,
  caseId: string,
  arm: string,
  questions: readonly DecisionQuestion[],
  attempt: number,
): string {
  return `fintech-${sha256Digest(
    {
      runId,
      caseId,
      arm,
      questionIds: questions.map((item) => item.id),
      attempt,
    },
    "jev-fabric/fintech-request-id/v1",
  ).slice(0, 40)}`;
}

function emptyAccounting(): ArmAccounting {
  return {
    providerInvocationCount: 0,
    providerRequestIdHashes: [],
    inputTokens: 0,
    outputTokens: 0,
    providerMs: 0,
  };
}

async function mapLimit<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
  onError: () => void,
): Promise<R[]> {
  const result = new Array<R>(values.length);
  let next = 0;
  let firstError: unknown;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (firstError === undefined) {
        const index = next;
        next += 1;
        if (index >= values.length) return;
        const value = values[index];
        if (value === undefined)
          throw new BenchmarkIntegrityError("benchmark work item disappeared");
        try {
          result[index] = await mapper(value, index);
        } catch (error) {
          if (firstError === undefined) {
            firstError = error;
            onError();
          }
          return;
        }
      }
    },
  );
  await Promise.all(workers);
  if (firstError !== undefined) throw firstError;
  return result;
}

function safeErrorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "UnknownError";
}

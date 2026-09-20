import { createHash } from "node:crypto";
import {
  binaryBrier,
  nll,
  noulReliability,
  pairedCategoricalRobustness,
  quantile,
  type PairedCategoricalRobustness,
} from "../../../packages/evals/src/index.js";
import { fintechExceptionQuestionSetHash } from "../../../packs/fintech-exception/pack.js";

export const fintechSignalIds = [
  "fintech-duplicate-or-reprocessed",
  "fintech-entity-mismatch",
  "fintech-missing-or-conflicting-evidence",
  "fintech-claimed-approval-or-override",
  "fintech-urgent-consumer-harm",
  "fintech-untrusted-influence",
] as const;

const arms = ["no_jev", "jev_batched", "jev_serial"] as const;
const routes = ["observe", "investigate", "escalate"] as const;
const sha256Pattern = /^sha256:[a-f0-9]{64}$/u;
const concreteJevModel = /^jev-\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u;
const maxCanonicalDepth = 64;
const maxCanonicalNodes = 100_000;
const maxInputNanoUsdPerToken = 1_000_000_000_000n;
const maxCostNanoUsd = 10_000_000_000_000_000_000n;
const maxProviderInvocationCount = 1_000;
const maxTokensPerTrace = 10_000_000;
const maxDatasetCases = 100_000;
const maxTraces = maxDatasetCases * arms.length;

export type FintechArm = (typeof arms)[number];
export type FintechRoute = (typeof routes)[number];
export type FintechSignalId = (typeof fintechSignalIds)[number];

export interface FintechDatasetCase {
  readonly caseId: string;
  readonly groupId: string;
  readonly split: "calibration" | "test";
  readonly providerStateDigest: string;
  readonly goldRoute: FintechRoute;
  readonly goldSignals: Readonly<Record<FintechSignalId, boolean>>;
}

export interface FintechTrace {
  readonly schemaVersion: "1";
  readonly traceId: string;
  readonly caseId: string;
  readonly groupId: string;
  readonly split: "calibration" | "test";
  readonly arm: FintechArm;
  readonly valid: boolean;
  readonly route: FintechRoute;
  readonly routeScore: number | null;
  readonly signals: readonly {
    readonly signalId: FintechSignalId;
    readonly value: boolean;
    readonly probabilityYes: number;
  }[];
  readonly runtime: {
    readonly caseExecutionOrdinal: 0 | 1 | 2;
    readonly providerInvocationCount: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly costNanoUsd: string;
    readonly endToEndMs: number;
    readonly providerMs: number;
    readonly model: string | null;
    readonly transport: string | null;
    readonly packId: string;
    readonly packVersion: string;
    readonly questionSetHash: string;
  };
  readonly boundary: {
    readonly advisoryOnly: true;
    readonly execution: "NOT_SUPPORTED";
    readonly unsafeExecutionAttemptCount: 0;
    readonly providerStateDigest: string | null;
    readonly providerStateContainsGold: false;
    readonly providerStateContainsRegulatedData: false;
    readonly providerStateRedacted: true;
  };
}

export interface FintechEvidence {
  readonly schemaVersion: "1";
  readonly runId: string;
  readonly executionState: "NOT_RUN" | "COMPLETED";
  readonly createdAt: string;
  readonly taskContract: {
    readonly id: "fintech-exception-routing-v2";
    readonly frozen: true;
    readonly preregisteredAt: string;
    readonly primaryMetric: "held_out_route_accuracy";
    readonly armOrderPolicy: "alternating_by_canonical_case_index_v1";
    readonly prohibitedClaims: readonly string[];
  };
  readonly pack: {
    readonly id: "fintech-exception";
    readonly version: "0.1.0";
    readonly questionSetHash: string;
  };
  readonly baseline: {
    readonly id: string;
    readonly version: string;
    readonly sourceDigest: string;
  };
  readonly pricing: {
    readonly currency: "USD";
    readonly inputNanoUsdPerToken: string;
    readonly outputPricing: "FREE";
    readonly sourceUrl: string;
    readonly sourceDigest: string;
    readonly observedAt: string;
  };
  readonly dataset: {
    readonly status: "NOT_SELECTED" | "RETAINED";
    readonly datasetId: string | null;
    readonly caseSetDigest: string | null;
    readonly sourceUrl: string | null;
    readonly license: string | null;
    readonly redistributionAllowed: boolean | null;
    readonly evidenceClass:
      | "SYNTHETIC"
      | "LOCAL_EXPLORATORY"
      | "RETAINED_PUBLIC"
      | null;
    readonly containsPersonalData: boolean | null;
    readonly containsRegulatedData: boolean | null;
    readonly deidentified: boolean | null;
    readonly contentRetention: "digests_and_labels_only";
    readonly splitPolicy: "group_disjoint_preregistered";
    readonly frozenAt: string | null;
    readonly cases: readonly FintechDatasetCase[];
  };
  readonly traces: readonly FintechTrace[];
  readonly metrics: FintechMetrics | null;
}

interface SignalCalibrationMetric {
  readonly signalId: FintechSignalId;
  readonly sampleCount: number;
  readonly brier: number | null;
  readonly nll: number | null;
  readonly nllClippedCount: number;
  readonly reliability: ReturnType<typeof noulReliability>;
}

interface ArmMetrics {
  readonly calibrationSampleCount: number;
  readonly testSampleCount: number;
  readonly testRouteAccuracy: number | null;
  readonly urgentHarmFalseNegativeRate: number | null;
  readonly influenceFalseNegativeRate: number | null;
  readonly safeEscalationRate: number | null;
  readonly invalidRate: number | null;
  readonly selectiveObserveCoverage: number | null;
  readonly selectiveObserveRisk: number | null;
  readonly providerInvocationCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costNanoUsd: string;
  readonly endToEndLatencyMs: Readonly<{
    p50: number | null;
    p95: number | null;
    p99: number | null;
  }>;
  readonly providerLatencyMs: Readonly<{
    p50: number | null;
    p95: number | null;
    p99: number | null;
  }>;
  readonly signalCalibration: readonly SignalCalibrationMetric[];
}

export interface FintechMetrics {
  readonly semantics: Readonly<{
    primaryMetric: "held_out_route_accuracy";
    calibrationSplitUsedForAccuracy: false;
    costsIncludeFailedAttempts: true;
    latencyScope: "all_retained_attempts";
    selectiveOutcome: "observe";
  }>;
  readonly byArm: Readonly<Record<FintechArm, ArmMetrics>>;
  readonly batching: Readonly<{
    requestReductionRatio: number | null;
    p50LatencySpeedup: number | null;
    costRatioBatchedToSerial: number | null;
    testAnswerAgreement: number | null;
    testSignalPairCoverage: number | null;
    testSignalRobustness: PairedCategoricalRobustness;
  }>;
  readonly ablation: Readonly<{
    heldOutAccuracyDelta: number | null;
    jevAddsMeasuredAccuracyValue: boolean | null;
  }>;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TypeError(message);
}

function record(value: unknown, name: string): Record<string, unknown> {
  invariant(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${name} must be an object`,
  );
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  name: string,
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
  invariant(
    unknown.length === 0,
    `unknown ${name} field: ${unknown.join(", ")}`,
  );
  const missing = allowed.filter((key) => !Object.hasOwn(value, key));
  invariant(
    missing.length === 0,
    `missing ${name} field: ${missing.join(", ")}`,
  );
}

function nonEmptyString(value: unknown, name: string): asserts value is string {
  invariant(
    typeof value === "string" && value.length > 0,
    `${name} is invalid`,
  );
}

function finiteNonNegative(
  value: unknown,
  name: string,
): asserts value is number {
  invariant(
    typeof value === "number" && Number.isFinite(value) && value >= 0,
    `${name} must be finite and non-negative`,
  );
}

function nonNegativeInteger(
  value: unknown,
  name: string,
): asserts value is number {
  invariant(
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
    `${name} must be a non-negative safe integer`,
  );
}

function exactTimestamp(value: unknown, name: string): asserts value is string {
  invariant(typeof value === "string", `${name} must be a timestamp`);
  const epoch = Date.parse(value);
  invariant(
    Number.isFinite(epoch) && new Date(epoch).toISOString() === value,
    `${name} must be a calendar-valid UTC millisecond timestamp`,
  );
}

function url(value: unknown, name: string): asserts value is string {
  nonEmptyString(value, name);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${name} must be an absolute URL`);
  }
  invariant(
    parsed.protocol === "https:",
    `${name} must use an https source URL`,
  );
  invariant(
    parsed.username.length === 0 && parsed.password.length === 0,
    `${name} must not contain embedded credentials`,
  );
}

function probability(value: unknown, name: string): asserts value is number {
  invariant(
    typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 1,
    `${name} must be finite in [0, 1]`,
  );
}

function stableJson(
  value: unknown,
  depth = 0,
  budget = { remaining: maxCanonicalNodes },
): string {
  invariant(
    depth <= maxCanonicalDepth,
    "canonical value exceeds the maximum depth",
  );
  budget.remaining -= 1;
  invariant(
    budget.remaining >= 0,
    "canonical value exceeds the maximum complexity",
  );
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    invariant(Number.isFinite(value), "canonical numbers must be finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value
      .map((item) => stableJson(item, depth + 1, budget))
      .join(",")}]`;
  const object = record(value, "canonical value");
  return `{${Object.keys(object)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableJson(object[key], depth + 1, budget)}`,
    )
    .join(",")}}`;
}

function boundedDecimal(
  value: unknown,
  maximum: bigint,
  name: string,
  positive: boolean,
): bigint {
  const pattern = positive ? /^[1-9]\d*$/u : /^(?:0|[1-9]\d*)$/u;
  invariant(
    typeof value === "string" &&
      value.length <= maximum.toString().length &&
      pattern.test(value),
    `${name} must be a bounded canonical nano-USD integer`,
  );
  const parsed = BigInt(value);
  invariant(parsed <= maximum, `${name} exceeds its bounded maximum`);
  return parsed;
}

function boundedNonNegativeInteger(
  value: unknown,
  maximum: number,
  name: string,
): asserts value is number {
  nonNegativeInteger(value, name);
  invariant(value <= maximum, `${name} exceeds its bounded maximum`);
}

function bigintRatio(numerator: bigint, denominator: bigint): number | null {
  if (denominator === 0n) return null;
  const scale = 1_000_000_000_000n;
  const rounded = (numerator * scale + denominator / 2n) / denominator;
  return Number(rounded) / Number(scale);
}

function assertBoundedMetricsEqual(actual: unknown, expected: unknown): void {
  const mismatch =
    "retained fintech metrics do not match recomputed trace metrics";
  const stack: { actual: unknown; expected: unknown; depth: number }[] = [
    { actual, expected, depth: 0 },
  ];
  let visited = 0;
  const seen = new WeakSet<object>();
  while (stack.length > 0) {
    const pair = stack.pop();
    invariant(pair !== undefined, mismatch);
    if (Object.is(pair.actual, pair.expected)) continue;
    visited += 1;
    invariant(
      pair.depth <= maxCanonicalDepth && visited <= maxCanonicalNodes,
      "retained fintech metrics shape exceeds the bounded complexity limit",
    );
    invariant(
      typeof pair.actual === "object" &&
        pair.actual !== null &&
        typeof pair.expected === "object" &&
        pair.expected !== null,
      mismatch,
    );
    invariant(
      !seen.has(pair.actual),
      "retained fintech metrics shape is cyclic",
    );
    seen.add(pair.actual);
    const actualArray = Array.isArray(pair.actual);
    const expectedArray = Array.isArray(pair.expected);
    invariant(actualArray === expectedArray, mismatch);
    const actualRecord = pair.actual as Record<string, unknown>;
    const expectedRecord = pair.expected as Record<string, unknown>;
    const actualKeys = Object.keys(actualRecord).sort();
    const expectedKeys = Object.keys(expectedRecord).sort();
    invariant(
      actualKeys.length === expectedKeys.length &&
        actualKeys.every((key, index) => key === expectedKeys[index]),
      mismatch,
    );
    for (const key of actualKeys)
      stack.push({
        actual: actualRecord[key],
        expected: expectedRecord[key],
        depth: pair.depth + 1,
      });
  }
}

function boundedMetricInput(value: unknown): FintechEvidence {
  const evidence = record(value, "fintech metric input");
  const dataset = record(evidence.dataset, "fintech metric dataset");
  invariant(
    Array.isArray(dataset.cases) && dataset.cases.length <= maxDatasetCases,
    "fintech metric dataset cases exceed the bounded maximum",
  );
  invariant(
    Array.isArray(evidence.traces) && evidence.traces.length <= maxTraces,
    "fintech metric traces exceed the bounded maximum",
  );
  for (const valueTrace of evidence.traces) {
    const trace = record(valueTrace, "fintech metric trace");
    const runtime = record(trace.runtime, "fintech metric trace runtime");
    boundedNonNegativeInteger(
      runtime.providerInvocationCount,
      maxProviderInvocationCount,
      "provider invocation count",
    );
    boundedNonNegativeInteger(
      runtime.inputTokens,
      maxTokensPerTrace,
      "inputTokens",
    );
    boundedNonNegativeInteger(
      runtime.outputTokens,
      maxTokensPerTrace,
      "outputTokens",
    );
    boundedDecimal(runtime.costNanoUsd, maxCostNanoUsd, "trace cost", false);
    finiteNonNegative(runtime.endToEndMs, "end-to-end latency");
    finiteNonNegative(runtime.providerMs, "provider latency");
    invariant(
      Array.isArray(trace.signals) &&
        trace.signals.length <= fintechSignalIds.length,
      "fintech metric trace signals exceed the bounded maximum",
    );
  }
  return evidence as unknown as FintechEvidence;
}

export function fintechCaseSetDigest(cases: readonly unknown[]): string {
  return `sha256:${createHash("sha256")
    .update("jev-fabric/fintech-case-set/v1\0", "utf8")
    .update(stableJson(cases), "utf8")
    .digest("hex")}`;
}

const baselineDefinition = {
  id: "always-investigate",
  version: "1",
  route: "investigate",
  semantics:
    "Route every retained exception to bounded human investigation; never observe, authorize, or execute.",
} as const;

export const fintechBaseline = Object.freeze({
  id: baselineDefinition.id,
  version: baselineDefinition.version,
  sourceDigest: `sha256:${createHash("sha256")
    .update("jev-fabric/fintech-no-jev-baseline/v1\0", "utf8")
    .update(stableJson(baselineDefinition), "utf8")
    .digest("hex")}`,
});

function routeFromSignals(
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

function traceSignalMap(
  trace: FintechTrace,
): Readonly<Record<FintechSignalId, boolean>> {
  return Object.fromEntries(
    trace.signals.map((signal) => [signal.signalId, signal.value]),
  ) as Readonly<Record<FintechSignalId, boolean>>;
}

function routeScore(trace: FintechTrace): number | null {
  if (!trace.valid || trace.arm === "no_jev") return null;
  return Math.min(
    ...trace.signals.map((signal) =>
      signal.value ? signal.probabilityYes : 1 - signal.probabilityYes,
    ),
  );
}

function mean(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function latency(values: readonly number[]) {
  return {
    p50: quantile(values, 0.5),
    p95: quantile(values, 0.95),
    p99: quantile(values, 0.99),
  };
}

function calibrationForSignal(
  signalId: FintechSignalId,
  cases: readonly FintechDatasetCase[],
  traces: readonly FintechTrace[],
): SignalCalibrationMetric {
  const caseById = new Map(cases.map((item) => [item.caseId, item]));
  const observations = traces.flatMap((trace) => {
    const datasetCase = caseById.get(trace.caseId);
    if (!datasetCase || !trace.valid) return [];
    const signal = trace.signals.find((item) => item.signalId === signalId);
    return signal
      ? [
          {
            probabilityYes: signal.probabilityYes,
            gold: datasetCase.goldSignals[signalId],
          },
        ]
      : [];
  });
  const brier = binaryBrier(observations);
  const logLoss = nll(observations, 1e-15);
  return {
    signalId,
    sampleCount: observations.length,
    brier: brier.value,
    nll: logLoss.value,
    nllClippedCount: logLoss.clippedCount,
    reliability: noulReliability(observations),
  };
}

function metricsForArm(
  arm: FintechArm,
  datasetCases: readonly FintechDatasetCase[],
  traces: readonly FintechTrace[],
): ArmMetrics {
  const armTraces = traces.filter((trace) => trace.arm === arm);
  const caseById = new Map(datasetCases.map((item) => [item.caseId, item]));
  const calibrationTraces = armTraces.filter(
    (trace) => trace.split === "calibration",
  );
  const testTraces = armTraces.filter((trace) => trace.split === "test");
  const correctness = testTraces.map((trace) =>
    Number(trace.route === caseById.get(trace.caseId)?.goldRoute),
  );
  const falseNegativeRate = (signalId: FintechSignalId) => {
    const eligible = testTraces.filter(
      (trace) => caseById.get(trace.caseId)?.goldSignals[signalId] === true,
    );
    return mean(eligible.map((trace) => Number(trace.route !== "escalate")));
  };
  const escalationCases = testTraces.filter(
    (trace) => caseById.get(trace.caseId)?.goldRoute === "escalate",
  );
  const valid = testTraces.filter((trace) => trace.valid);
  const observed = valid.filter((trace) => trace.route === "observe");
  const totalCost = armTraces.reduce(
    (sum, trace) => sum + BigInt(trace.runtime.costNanoUsd),
    0n,
  );
  return {
    calibrationSampleCount: calibrationTraces.length,
    testSampleCount: testTraces.length,
    testRouteAccuracy: mean(correctness),
    urgentHarmFalseNegativeRate: falseNegativeRate(
      "fintech-urgent-consumer-harm",
    ),
    influenceFalseNegativeRate: falseNegativeRate(
      "fintech-untrusted-influence",
    ),
    safeEscalationRate: mean(
      escalationCases.map((trace) => Number(trace.route === "escalate")),
    ),
    invalidRate: mean(testTraces.map((trace) => Number(!trace.valid))),
    selectiveObserveCoverage: ratio(observed.length, valid.length),
    selectiveObserveRisk: mean(
      observed.map((trace) =>
        Number(trace.route !== caseById.get(trace.caseId)?.goldRoute),
      ),
    ),
    providerInvocationCount: armTraces.reduce(
      (sum, trace) => sum + trace.runtime.providerInvocationCount,
      0,
    ),
    inputTokens: armTraces.reduce(
      (sum, trace) => sum + trace.runtime.inputTokens,
      0,
    ),
    outputTokens: armTraces.reduce(
      (sum, trace) => sum + trace.runtime.outputTokens,
      0,
    ),
    costNanoUsd: totalCost.toString(),
    endToEndLatencyMs: latency(
      armTraces.map((trace) => trace.runtime.endToEndMs),
    ),
    providerLatencyMs: latency(
      armTraces.map((trace) => trace.runtime.providerMs),
    ),
    signalCalibration:
      arm === "no_jev"
        ? []
        : fintechSignalIds.map((signalId) =>
            calibrationForSignal(signalId, datasetCases, calibrationTraces),
          ),
  };
}

export function recomputeFintechMetrics(value: unknown): FintechMetrics {
  const evidence = boundedMetricInput(value);
  const traceByCaseArm = new Map<string, FintechTrace>();
  for (const trace of evidence.traces)
    traceByCaseArm.set(`${trace.caseId}\0${trace.arm}`, trace);
  const byArm = Object.fromEntries(
    arms.map((arm) => [
      arm,
      metricsForArm(arm, evidence.dataset.cases, evidence.traces),
    ]),
  ) as unknown as Record<FintechArm, ArmMetrics>;
  const testCases = evidence.dataset.cases.filter(
    (datasetCase) => datasetCase.split === "test",
  );
  const answersAgree = testCases.map((datasetCase) => {
    const batched = traceByCaseArm.get(`${datasetCase.caseId}\0jev_batched`);
    const serial = traceByCaseArm.get(`${datasetCase.caseId}\0jev_serial`);
    if (!batched?.valid || !serial?.valid) return 0;
    return Number(
      fintechSignalIds.every(
        (signalId) =>
          batched.signals.find((item) => item.signalId === signalId)?.value ===
          serial.signals.find((item) => item.signalId === signalId)?.value,
      ),
    );
  });
  const signalPairs = testCases.flatMap((datasetCase, caseIndex) => {
    const batched = traceByCaseArm.get(`${datasetCase.caseId}\0jev_batched`);
    const serial = traceByCaseArm.get(`${datasetCase.caseId}\0jev_serial`);
    if (!batched?.valid || !serial?.valid) return [];
    const batchedSignals = new Map(
      batched.signals.map((signal) => [signal.signalId, signal]),
    );
    const serialSignals = new Map(
      serial.signals.map((signal) => [signal.signalId, signal]),
    );
    return fintechSignalIds.map((signalId, signalIndex) => {
      const batchedSignal = batchedSignals.get(signalId);
      const serialSignal = serialSignals.get(signalId);
      invariant(
        batchedSignal !== undefined && serialSignal !== undefined,
        "valid batching pair is missing a fintech signal",
      );
      const decision = (signal: typeof batchedSignal) => ({
        probabilities: {
          yes: signal.probabilityYes,
          no: 1 - signal.probabilityYes,
        },
        selected: signal.value ? "yes" : "no",
      });
      return {
        pairId: `p${caseIndex}:${signalIndex}:${signalId}`,
        family: "batching" as const,
        reference: decision(batchedSignal),
        variant: decision(serialSignal),
        gold: datasetCase.goldSignals[signalId] ? "yes" : "no",
      };
    });
  });
  const expectedSignalPairCount = testCases.length * fintechSignalIds.length;
  const accuracyDelta =
    byArm.jev_batched.testRouteAccuracy === null ||
    byArm.no_jev.testRouteAccuracy === null
      ? null
      : byArm.jev_batched.testRouteAccuracy - byArm.no_jev.testRouteAccuracy;
  const batchP50 = byArm.jev_batched.endToEndLatencyMs.p50;
  const serialP50 = byArm.jev_serial.endToEndLatencyMs.p50;
  return {
    semantics: {
      primaryMetric: "held_out_route_accuracy",
      calibrationSplitUsedForAccuracy: false,
      costsIncludeFailedAttempts: true,
      latencyScope: "all_retained_attempts",
      selectiveOutcome: "observe",
    },
    byArm,
    batching: {
      requestReductionRatio: ratio(
        byArm.jev_serial.providerInvocationCount,
        byArm.jev_batched.providerInvocationCount,
      ),
      p50LatencySpeedup:
        batchP50 === null || serialP50 === null
          ? null
          : ratio(serialP50, batchP50),
      costRatioBatchedToSerial: bigintRatio(
        BigInt(byArm.jev_batched.costNanoUsd),
        BigInt(byArm.jev_serial.costNanoUsd),
      ),
      testAnswerAgreement: mean(answersAgree),
      testSignalPairCoverage: ratio(
        signalPairs.length,
        expectedSignalPairCount,
      ),
      testSignalRobustness: pairedCategoricalRobustness(signalPairs),
    },
    ablation: {
      heldOutAccuracyDelta: accuracyDelta,
      jevAddsMeasuredAccuracyValue:
        accuracyDelta === null ? null : accuracyDelta > 0,
    },
  };
}

function validateTaskContract(value: unknown): void {
  const task = record(value, "task contract");
  exactKeys(
    task,
    [
      "id",
      "frozen",
      "preregisteredAt",
      "primaryMetric",
      "armOrderPolicy",
      "prohibitedClaims",
    ],
    "task contract",
  );
  invariant(task.id === "fintech-exception-routing-v2", "task id is invalid");
  invariant(task.frozen === true, "task contract must be frozen");
  exactTimestamp(task.preregisteredAt, "task preregistration");
  invariant(
    task.primaryMetric === "held_out_route_accuracy",
    "primary metric is invalid",
  );
  invariant(
    task.armOrderPolicy === "alternating_by_canonical_case_index_v1",
    "arm order policy is invalid",
  );
  invariant(
    Array.isArray(task.prohibitedClaims),
    "prohibited claims are invalid",
  );
  for (const required of ["financial_authorization", "execution", "identity"])
    invariant(
      task.prohibitedClaims.includes(required),
      `prohibited claim ${required} is missing`,
    );
}

function validatePack(value: unknown): void {
  const pack = record(value, "pack");
  exactKeys(pack, ["id", "version", "questionSetHash"], "pack");
  invariant(pack.id === "fintech-exception", "pack id is invalid");
  invariant(pack.version === "0.1.0", "pack version is invalid");
  invariant(
    pack.questionSetHash === fintechExceptionQuestionSetHash,
    "pack question set does not match the current contract",
  );
}

function validateBaseline(value: unknown): void {
  const baseline = record(value, "baseline");
  exactKeys(baseline, ["id", "version", "sourceDigest"], "baseline");
  invariant(
    baseline.id === fintechBaseline.id &&
      baseline.version === fintechBaseline.version &&
      baseline.sourceDigest === fintechBaseline.sourceDigest,
    "baseline does not match the pinned executable contract",
  );
}

function validatePricing(value: unknown): bigint {
  const pricing = record(value, "pricing");
  exactKeys(
    pricing,
    [
      "currency",
      "inputNanoUsdPerToken",
      "outputPricing",
      "sourceUrl",
      "sourceDigest",
      "observedAt",
    ],
    "pricing",
  );
  invariant(pricing.currency === "USD", "pricing currency must be USD");
  const inputPrice = boundedDecimal(
    pricing.inputNanoUsdPerToken,
    maxInputNanoUsdPerToken,
    "input token price",
    true,
  );
  invariant(pricing.outputPricing === "FREE", "output pricing is invalid");
  url(pricing.sourceUrl, "pricing source");
  invariant(
    typeof pricing.sourceDigest === "string" &&
      sha256Pattern.test(pricing.sourceDigest),
    "pricing source digest is invalid",
  );
  exactTimestamp(pricing.observedAt, "pricing observation");
  return inputPrice;
}

function validateGoldSignals(value: unknown): Record<FintechSignalId, boolean> {
  const signals = record(value, "gold signals");
  exactKeys(signals, fintechSignalIds, "gold signal");
  for (const signalId of fintechSignalIds)
    invariant(
      typeof signals[signalId] === "boolean",
      `gold signal ${signalId} must be boolean`,
    );
  return signals as unknown as Record<FintechSignalId, boolean>;
}

function validateDataset(
  value: unknown,
  executionState: string,
): FintechDatasetCase[] {
  const dataset = record(value, "dataset");
  exactKeys(
    dataset,
    [
      "status",
      "datasetId",
      "caseSetDigest",
      "sourceUrl",
      "license",
      "redistributionAllowed",
      "evidenceClass",
      "containsPersonalData",
      "containsRegulatedData",
      "deidentified",
      "contentRetention",
      "splitPolicy",
      "frozenAt",
      "cases",
    ],
    "dataset",
  );
  invariant(
    dataset.contentRetention === "digests_and_labels_only",
    "dataset may retain only digests and labels",
  );
  invariant(
    dataset.splitPolicy === "group_disjoint_preregistered",
    "dataset split policy is invalid",
  );
  invariant(Array.isArray(dataset.cases), "dataset cases must be an array");
  invariant(
    dataset.cases.length <= maxDatasetCases,
    "dataset cases exceed the bounded maximum",
  );
  if (executionState === "NOT_RUN") {
    invariant(dataset.status === "NOT_SELECTED", "NOT_RUN dataset is selected");
    for (const field of [
      "datasetId",
      "caseSetDigest",
      "sourceUrl",
      "license",
      "redistributionAllowed",
      "evidenceClass",
      "containsPersonalData",
      "containsRegulatedData",
      "deidentified",
      "frozenAt",
    ])
      invariant(
        dataset[field] === null,
        `NOT_RUN dataset ${field} must be null`,
      );
    invariant(
      dataset.cases.length === 0,
      "NOT_RUN dataset cases must be empty",
    );
    return [];
  }
  invariant(dataset.status === "RETAINED", "completed dataset is not retained");
  nonEmptyString(dataset.datasetId, "dataset id");
  invariant(
    typeof dataset.caseSetDigest === "string" &&
      sha256Pattern.test(dataset.caseSetDigest),
    "dataset case-set digest is invalid",
  );
  url(dataset.sourceUrl, "dataset source");
  nonEmptyString(dataset.license, "dataset license");
  invariant(
    dataset.redistributionAllowed === true,
    "completed public evidence requires redistribution rights",
  );
  invariant(
    ["SYNTHETIC", "LOCAL_EXPLORATORY", "RETAINED_PUBLIC"].includes(
      dataset.evidenceClass as string,
    ),
    "dataset evidence class is invalid",
  );
  invariant(
    dataset.containsPersonalData === false &&
      dataset.containsRegulatedData === false &&
      dataset.deidentified === true,
    "retained benchmark dataset must be deidentified and contain no personal or regulated data",
  );
  exactTimestamp(dataset.frozenAt, "dataset freeze time");
  invariant(dataset.cases.length > 0, "completed dataset must contain cases");
  const seenCases = new Set<string>();
  const groupSplits = new Map<string, Set<string>>();
  for (const item of dataset.cases) {
    const datasetCase = record(item, "dataset case");
    exactKeys(
      datasetCase,
      [
        "caseId",
        "groupId",
        "split",
        "providerStateDigest",
        "goldRoute",
        "goldSignals",
      ],
      "dataset case",
    );
    nonEmptyString(datasetCase.caseId, "case id");
    nonEmptyString(datasetCase.groupId, "case group id");
    invariant(
      !seenCases.has(datasetCase.caseId),
      "dataset case ids must be unique",
    );
    seenCases.add(datasetCase.caseId);
    invariant(
      datasetCase.split === "calibration" || datasetCase.split === "test",
      "dataset case split is invalid",
    );
    invariant(
      typeof datasetCase.providerStateDigest === "string" &&
        sha256Pattern.test(datasetCase.providerStateDigest),
      "dataset provider state digest is invalid",
    );
    invariant(
      routes.includes(datasetCase.goldRoute as FintechRoute),
      "gold route is invalid",
    );
    const signals = validateGoldSignals(datasetCase.goldSignals);
    invariant(
      routeFromSignals(signals) === datasetCase.goldRoute,
      "gold route does not match gold signals",
    );
    const splits = groupSplits.get(datasetCase.groupId) ?? new Set<string>();
    splits.add(datasetCase.split);
    groupSplits.set(datasetCase.groupId, splits);
  }
  invariant(
    dataset.cases.some((item) => item.split === "calibration") &&
      dataset.cases.some((item) => item.split === "test"),
    "dataset requires calibration and test cases",
  );
  invariant(
    [...groupSplits.values()].every((splits) => splits.size === 1),
    "a group appears in both calibration and test split",
  );
  invariant(
    fintechCaseSetDigest(dataset.cases) === dataset.caseSetDigest,
    "dataset case-set digest does not match cases",
  );
  return dataset.cases as unknown as FintechDatasetCase[];
}

function validateSignalArray(value: unknown): FintechTrace["signals"] {
  invariant(Array.isArray(value), "trace signals must be an array");
  invariant(value.length === 6, "valid Jev trace requires exactly six signals");
  const seen = new Set<string>();
  for (const item of value) {
    const signal = record(item, "trace signal");
    exactKeys(signal, ["signalId", "value", "probabilityYes"], "trace signal");
    invariant(
      fintechSignalIds.includes(signal.signalId as FintechSignalId),
      "trace signal id is invalid",
    );
    invariant(
      !seen.has(signal.signalId as string),
      "trace signal ids must be unique",
    );
    seen.add(signal.signalId as string);
    invariant(
      typeof signal.value === "boolean",
      "trace signal value must be boolean",
    );
    probability(signal.probabilityYes, "trace signal probabilityYes");
    invariant(
      signal.value === signal.probabilityYes >= 0.5,
      "trace signal value must equal probabilityYes >= 0.5",
    );
  }
  invariant(
    fintechSignalIds.every((signalId) => seen.has(signalId)),
    "valid Jev trace must cover all six signals",
  );
  return value as unknown as FintechTrace["signals"];
}

function validateRuntime(
  value: unknown,
  arm: FintechArm,
  valid: boolean,
  pack: FintechEvidence["pack"],
  inputNanoUsdPerToken: bigint,
): FintechTrace["runtime"] {
  const runtime = record(value, "trace runtime");
  exactKeys(
    runtime,
    [
      "caseExecutionOrdinal",
      "providerInvocationCount",
      "inputTokens",
      "outputTokens",
      "costNanoUsd",
      "endToEndMs",
      "providerMs",
      "model",
      "transport",
      "packId",
      "packVersion",
      "questionSetHash",
    ],
    "trace runtime",
  );
  nonNegativeInteger(runtime.caseExecutionOrdinal, "case execution ordinal");
  invariant(
    runtime.caseExecutionOrdinal <= 2,
    "case execution ordinal exceeds its bounded maximum",
  );
  boundedNonNegativeInteger(
    runtime.providerInvocationCount,
    maxProviderInvocationCount,
    "provider invocation count",
  );
  boundedNonNegativeInteger(
    runtime.inputTokens,
    maxTokensPerTrace,
    "inputTokens",
  );
  boundedNonNegativeInteger(
    runtime.outputTokens,
    maxTokensPerTrace,
    "outputTokens",
  );
  const retainedCost = boundedDecimal(
    runtime.costNanoUsd,
    maxCostNanoUsd,
    "trace cost",
    false,
  );
  finiteNonNegative(runtime.endToEndMs, "end-to-end latency");
  finiteNonNegative(runtime.providerMs, "provider latency");
  invariant(
    runtime.providerMs <= runtime.endToEndMs,
    "provider latency cannot exceed end-to-end latency",
  );
  invariant(runtime.packId === pack.id, "trace pack id is inconsistent");
  invariant(
    runtime.packVersion === pack.version,
    "trace pack version is inconsistent",
  );
  invariant(
    runtime.questionSetHash === pack.questionSetHash,
    "trace question set is inconsistent",
  );
  const expectedCost = BigInt(runtime.inputTokens) * inputNanoUsdPerToken;
  invariant(
    retainedCost === expectedCost,
    "trace cost does not match retained pricing evidence",
  );
  if (arm === "no_jev") {
    invariant(
      runtime.caseExecutionOrdinal === 0 &&
        runtime.providerInvocationCount === 0 &&
        runtime.inputTokens === 0 &&
        runtime.outputTokens === 0 &&
        runtime.costNanoUsd === "0" &&
        runtime.providerMs === 0 &&
        runtime.model === null &&
        runtime.transport === null,
      "no-Jev baseline must have zero provider accounting",
    );
  } else {
    invariant(
      runtime.caseExecutionOrdinal === 1 || runtime.caseExecutionOrdinal === 2,
      "Jev case execution ordinal must be 1 or 2",
    );
    if (valid) {
      invariant(
        runtime.inputTokens > 0,
        "valid Jev trace requires positive inputTokens",
      );
      invariant(
        runtime.providerInvocationCount >= (arm === "jev_serial" ? 6 : 1),
        `${arm} provider invocation count is incomplete`,
      );
    }
    invariant(
      typeof runtime.model === "string" && concreteJevModel.test(runtime.model),
      "Jev trace requires a concrete Jev model version",
    );
    nonEmptyString(runtime.transport, "Jev transport");
  }
  return runtime as unknown as FintechTrace["runtime"];
}

function validateBoundary(
  value: unknown,
  arm: FintechArm,
  providerInvocationCount: number,
  providerStateDigest: string,
): void {
  const boundary = record(value, "trace boundary");
  exactKeys(
    boundary,
    [
      "advisoryOnly",
      "execution",
      "unsafeExecutionAttemptCount",
      "providerStateDigest",
      "providerStateContainsGold",
      "providerStateContainsRegulatedData",
      "providerStateRedacted",
    ],
    "trace boundary",
  );
  invariant(boundary.advisoryOnly === true, "trace must remain advisory-only");
  invariant(
    boundary.execution === "NOT_SUPPORTED",
    "trace execution is not prohibited",
  );
  invariant(
    boundary.unsafeExecutionAttemptCount === 0,
    "unsafe execution attempt evidence is forbidden",
  );
  invariant(
    boundary.providerStateContainsGold === false,
    "gold labels must never enter provider state",
  );
  invariant(
    boundary.providerStateContainsRegulatedData === false,
    "regulated data must never enter retained provider state",
  );
  invariant(
    boundary.providerStateRedacted === true,
    "provider state must be redacted",
  );
  if (arm === "no_jev" || providerInvocationCount === 0)
    invariant(
      boundary.providerStateDigest === null,
      "unused provider state digest must be null",
    );
  else
    invariant(
      typeof boundary.providerStateDigest === "string" &&
        sha256Pattern.test(boundary.providerStateDigest) &&
        boundary.providerStateDigest === providerStateDigest,
      "provider state digest does not match the frozen dataset",
    );
}

function validateTrace(
  value: unknown,
  datasetCase: FintechDatasetCase,
  pack: FintechEvidence["pack"],
  inputNanoUsdPerToken: bigint,
): FintechTrace {
  const trace = record(value, "trace");
  exactKeys(
    trace,
    [
      "schemaVersion",
      "traceId",
      "caseId",
      "groupId",
      "split",
      "arm",
      "valid",
      "route",
      "routeScore",
      "signals",
      "runtime",
      "boundary",
    ],
    "trace",
  );
  invariant(trace.schemaVersion === "1", "trace schema version is invalid");
  nonEmptyString(trace.traceId, "trace id");
  invariant(
    trace.caseId === datasetCase.caseId,
    "trace case binding is invalid",
  );
  invariant(
    trace.groupId === datasetCase.groupId,
    "trace group binding is invalid",
  );
  invariant(
    trace.split === datasetCase.split,
    "trace split binding is invalid",
  );
  invariant(arms.includes(trace.arm as FintechArm), "trace arm is invalid");
  const arm = trace.arm as FintechArm;
  invariant(typeof trace.valid === "boolean", "trace validity is invalid");
  invariant(
    routes.includes(trace.route as FintechRoute),
    "trace route is invalid",
  );
  const runtime = validateRuntime(
    trace.runtime,
    arm,
    trace.valid,
    pack,
    inputNanoUsdPerToken,
  );
  validateBoundary(
    trace.boundary,
    arm,
    runtime.providerInvocationCount,
    datasetCase.providerStateDigest,
  );
  if (arm === "no_jev") {
    invariant(
      trace.valid === true,
      "deterministic baseline trace must be valid",
    );
    invariant(
      Array.isArray(trace.signals) && trace.signals.length === 0,
      "no-Jev trace cannot retain Noul signals",
    );
    invariant(trace.routeScore === null, "no-Jev route score must be null");
    invariant(
      trace.route === baselineDefinition.route,
      "no-Jev baseline must deterministically route to investigate",
    );
  } else if (trace.valid) {
    const signals = validateSignalArray(trace.signals);
    const typedTrace = { ...trace, signals } as unknown as FintechTrace;
    invariant(
      routeFromSignals(traceSignalMap(typedTrace)) === trace.route,
      "Jev trace route does not match its six signals",
    );
    const expectedScore = routeScore(typedTrace);
    probability(trace.routeScore, "Jev route score");
    invariant(
      trace.routeScore === expectedScore,
      "Jev route score is not reproducible",
    );
  } else {
    invariant(
      trace.route === "escalate" &&
        trace.routeScore === null &&
        Array.isArray(trace.signals) &&
        trace.signals.length === 0,
      "invalid Jev trace must fail closed to escalation without synthetic signals",
    );
  }
  return trace as unknown as FintechTrace;
}

export function assertFintechEvidence(
  value: unknown,
): asserts value is FintechEvidence {
  const evidence = record(value, "fintech evidence");
  exactKeys(
    evidence,
    [
      "schemaVersion",
      "runId",
      "executionState",
      "createdAt",
      "taskContract",
      "pack",
      "baseline",
      "pricing",
      "dataset",
      "traces",
      "metrics",
    ],
    "fintech evidence",
  );
  invariant(
    evidence.schemaVersion === "1",
    "fintech evidence schema version is invalid",
  );
  nonEmptyString(evidence.runId, "run id");
  invariant(
    evidence.executionState === "NOT_RUN" ||
      evidence.executionState === "COMPLETED",
    "fintech execution state is invalid",
  );
  exactTimestamp(evidence.createdAt, "run creation time");
  validateTaskContract(evidence.taskContract);
  validatePack(evidence.pack);
  validateBaseline(evidence.baseline);
  const inputPrice = validatePricing(evidence.pricing);
  const datasetCases = validateDataset(
    evidence.dataset,
    evidence.executionState,
  );
  const createdAt = Date.parse(evidence.createdAt as string);
  const preregisteredAt = Date.parse(
    (evidence.taskContract as Record<string, unknown>)
      .preregisteredAt as string,
  );
  const pricingObservedAt = Date.parse(
    (evidence.pricing as Record<string, unknown>).observedAt as string,
  );
  invariant(
    preregisteredAt <= createdAt,
    "task preregistration cannot occur after run creation",
  );
  invariant(
    pricingObservedAt <= createdAt,
    "pricing observation cannot occur after run creation",
  );
  if (evidence.executionState === "COMPLETED") {
    const frozenAt = Date.parse(
      (evidence.dataset as Record<string, unknown>).frozenAt as string,
    );
    invariant(
      preregisteredAt <= frozenAt,
      "dataset freeze cannot precede task preregistration",
    );
    invariant(
      frozenAt <= createdAt,
      "dataset freeze cannot occur after run creation",
    );
  }
  invariant(Array.isArray(evidence.traces), "fintech traces must be an array");
  invariant(
    evidence.traces.length <= maxTraces,
    "fintech traces exceed the bounded maximum",
  );
  if (evidence.executionState === "NOT_RUN") {
    invariant(
      evidence.traces.length === 0,
      "NOT_RUN evidence cannot contain traces",
    );
    invariant(
      evidence.metrics === null,
      "NOT_RUN evidence metrics must be null",
    );
    return;
  }
  invariant(evidence.metrics !== null, "completed evidence requires metrics");
  const pack = evidence.pack as unknown as FintechEvidence["pack"];
  const caseById = new Map(datasetCases.map((item) => [item.caseId, item]));
  const validated: FintechTrace[] = [];
  const validatedByCaseArm = new Map<string, FintechTrace>();
  const traceIds = new Set<string>();
  const coverage = new Map<string, Set<FintechArm>>();
  for (const traceValue of evidence.traces) {
    const preview = record(traceValue, "trace");
    const datasetCase = caseById.get(preview.caseId as string);
    invariant(datasetCase !== undefined, "trace references an unknown case");
    const trace = validateTrace(traceValue, datasetCase, pack, inputPrice);
    invariant(!traceIds.has(trace.traceId), "trace ids must be unique");
    traceIds.add(trace.traceId);
    const present = coverage.get(trace.caseId) ?? new Set<FintechArm>();
    invariant(!present.has(trace.arm), "case has duplicate traces for an arm");
    present.add(trace.arm);
    coverage.set(trace.caseId, present);
    validated.push(trace);
    validatedByCaseArm.set(`${trace.caseId}\0${trace.arm}`, trace);
  }
  invariant(
    datasetCases.every(
      (datasetCase) =>
        coverage.get(datasetCase.caseId)?.size === arms.length &&
        arms.every((arm) => coverage.get(datasetCase.caseId)?.has(arm)),
    ),
    "every case requires exactly one trace for each arm",
  );
  for (const [caseIndex, datasetCase] of datasetCases.entries()) {
    const batched = validatedByCaseArm.get(
      `${datasetCase.caseId}\0jev_batched`,
    );
    const serial = validatedByCaseArm.get(`${datasetCase.caseId}\0jev_serial`);
    invariant(
      batched !== undefined && serial !== undefined,
      "counterbalanced case is missing a Jev arm",
    );
    invariant(
      batched.runtime.model === serial.runtime.model &&
        batched.runtime.transport === serial.runtime.transport &&
        batched.runtime.questionSetHash === serial.runtime.questionSetHash,
      "batched and serial arms must use the same model, transport, and question set",
    );
    const expectedBatchedOrdinal = caseIndex % 2 === 0 ? 1 : 2;
    const expectedSerialOrdinal = caseIndex % 2 === 0 ? 2 : 1;
    invariant(
      batched.runtime.caseExecutionOrdinal === expectedBatchedOrdinal &&
        serial.runtime.caseExecutionOrdinal === expectedSerialOrdinal,
      "execution ordinal does not match the counterbalanced arm order policy",
    );
  }
  const recomputed = recomputeFintechMetrics({
    ...(evidence as unknown as FintechEvidence),
    traces: validated,
  });
  assertBoundedMetricsEqual(evidence.metrics, recomputed);
}

function percentage(value: number | null): string {
  return value === null ? "N/A" : `${(value * 100).toFixed(2)}%`;
}

export function renderFintechReport(value: unknown): string {
  assertFintechEvidence(value);
  if (value.executionState === "NOT_RUN")
    return [
      "# Fintech evidence report",
      "",
      "**Status: `NOT_RUN`**",
      "",
      "No fintech measurements have been run. All accuracy, latency, token, and cost fields remain absent.",
      "",
    ].join("\n");
  const rows = arms.map((arm) => {
    const metric = value.metrics?.byArm[arm];
    invariant(metric !== undefined, "completed report metrics are missing");
    return `| ${arm} | ${metric.testSampleCount} | ${percentage(metric.testRouteAccuracy)} | ${metric.providerInvocationCount} | ${metric.inputTokens} | ${metric.costNanoUsd} |`;
  });
  return [
    "# Fintech evidence report",
    "",
    "**Status: `COMPLETED`**",
    "",
    "Metrics below are recomputed from retained case-level traces. Accuracy uses only the held-out test split.",
    "",
    "| Arm | Held-out cases | Route accuracy | Provider calls | Input tokens | Cost (nano-USD) |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...rows,
    "",
    `Batched/serial held-out answer agreement: ${percentage(value.metrics?.batching.testAnswerAgreement ?? null)}`,
    `Batched/serial signal-pair coverage: ${percentage(value.metrics?.batching.testSignalPairCoverage ?? null)}`,
    `Batched/serial signal agreement: ${percentage(value.metrics?.batching.testSignalRobustness.labelAgreementRate ?? null)}`,
    `Batched/serial mean distribution shift (total variation): ${percentage(value.metrics?.batching.testSignalRobustness.meanTotalVariation ?? null)}`,
    `Batched/serial jointly correct signals: ${percentage(value.metrics?.batching.testSignalRobustness.jointAccuracy ?? null)}`,
    `Jev batched/no-Jev held-out accuracy delta: ${percentage(value.metrics?.ablation.heldOutAccuracyDelta ?? null)}`,
    "",
    "This evidence is advisory-only and makes no claim of financial authorization, identity, compliance disposition, or execution capability.",
    "",
  ].join("\n");
}

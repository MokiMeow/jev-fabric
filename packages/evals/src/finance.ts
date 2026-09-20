import {
  categoricalBrier,
  quantile,
  topLabelEce,
  type CategoricalObservation,
} from "./metrics.js";

export const financeRoutes = ["observe", "investigate", "escalate"] as const;
export type FinanceRoute = (typeof financeRoutes)[number];

export const financeTracks = [
  "market_surveillance",
  "visual_evidence",
  "financial_text_triage",
] as const;
export type FinanceTrack = (typeof financeTracks)[number];

export const financeArchitectures = [
  "deterministic_only",
  "host_model_only",
  "jev_advisory",
  "host_plus_jev",
] as const;
export type FinanceArchitecture = (typeof financeArchitectures)[number];

export type FinanceRouteProbabilities = Readonly<Record<FinanceRoute, number>>;
export type FinanceCalibrationReason =
  | "deterministic_only"
  | "composite_no_distribution";

interface FinanceBenchmarkTraceBase {
  readonly caseId: string;
  readonly groupId: string;
  readonly track: FinanceTrack;
  readonly architecture: FinanceArchitecture;
  readonly goldRoute: FinanceRoute;
  readonly lookaheadProbe: boolean;
  readonly unsafeExecutionAttempt: boolean;
  readonly durationMs: number;
  readonly inputTokens: number | null;
  readonly costMicros: string | null;
}

interface FinancePredictedTraceBase extends FinanceBenchmarkTraceBase {
  readonly status: "predicted";
  readonly predictedRoute: FinanceRoute;
  readonly abstained: boolean;
  readonly lookaheadRejected: false;
}

export interface FinanceMeasuredPredictedTrace
  extends FinancePredictedTraceBase {
  readonly routeQuestionProbabilities: FinanceRouteProbabilities;
  readonly calibrationStatus: "measured";
  readonly calibrationReason?: never;
}

export interface FinanceUncalibratedPredictedTrace
  extends FinancePredictedTraceBase {
  readonly routeQuestionProbabilities: null;
  readonly calibrationStatus: "unavailable";
  readonly calibrationReason: FinanceCalibrationReason;
}

export type FinancePredictedTrace =
  | FinanceMeasuredPredictedTrace
  | FinanceUncalibratedPredictedTrace;

export interface FinanceRejectedLookaheadTrace
  extends FinanceBenchmarkTraceBase {
  readonly status: "rejected_lookahead";
  readonly lookaheadProbe: true;
  readonly lookaheadRejected: true;
  readonly predictedRoute?: never;
  readonly routeQuestionProbabilities?: never;
  readonly calibrationStatus?: never;
  readonly calibrationReason?: never;
  readonly abstained?: never;
}

export type FinanceBenchmarkTrace =
  | FinancePredictedTrace
  | FinanceRejectedLookaheadTrace;

export interface FinanceBenchmarkMetrics {
  readonly accuracy: number | null;
  readonly macroF1: number;
  readonly routeQuestionBrier: number | null;
  readonly routeQuestionEce: number | null;
  readonly coverage: number;
  readonly unsafeExecutionAttemptRate: number;
  readonly lookaheadRejectionRate: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly inputTokens: number | null;
  readonly estimatedCostUsd: number | null;
}

export interface FinanceBenchmarkCell {
  readonly track: FinanceTrack;
  readonly architecture: FinanceArchitecture;
  readonly sampleCount: number;
  readonly calibrationStatus: "measured" | "unavailable";
  readonly calibrationReason: "no_measured_route_question_distributions" | null;
  readonly accountingStatus: "MEASURED" | "UNMETERED";
  readonly accountingReason: "unmetered_attempt" | null;
  readonly metrics: FinanceBenchmarkMetrics;
}

const routeSet = new Set<string>(financeRoutes);
const trackSet = new Set<string>(financeTracks);
const architectureSet = new Set<string>(financeArchitectures);
const traceKeys = [
  "caseId",
  "groupId",
  "track",
  "architecture",
  "goldRoute",
  "status",
  "lookaheadProbe",
  "lookaheadRejected",
  "unsafeExecutionAttempt",
  "durationMs",
  "inputTokens",
  "costMicros",
] as const;
const predictedTraceKeys = [
  "predictedRoute",
  "routeQuestionProbabilities",
  "calibrationStatus",
  "abstained",
] as const;
const predictionOnlyKeys = [
  ...predictedTraceKeys,
  "calibrationReason",
] as const;

/**
 * Strict, deterministic aggregation for a complete finance benchmark matrix.
 * This function performs no I/O and rejects unsafe or incomplete evidence.
 */
export function aggregateFinanceBenchmarkTraces<
  T extends FinanceBenchmarkTrace,
>(traces: readonly T[]): readonly FinanceBenchmarkCell[] {
  const cells = new Map<string, FinanceBenchmarkTrace[]>();
  const caseIdsByCell = new Map<string, Set<string>>();

  for (const trace of traces) {
    validateTrace(trace);
    const key = cellKey(trace.track, trace.architecture);
    const rows = cells.get(key) ?? [];
    const caseIds = caseIdsByCell.get(key) ?? new Set<string>();
    if (caseIds.has(trace.caseId))
      throw new TypeError(
        `duplicate finance case id in ${key}: ${trace.caseId}`,
      );
    caseIds.add(trace.caseId);
    rows.push(trace);
    cells.set(key, rows);
    caseIdsByCell.set(key, caseIds);
  }

  return financeTracks.flatMap((track) =>
    financeArchitectures.map((architecture) => {
      const key = cellKey(track, architecture);
      const rows = cells.get(key);
      if (rows === undefined || rows.length === 0)
        throw new TypeError(`missing finance benchmark cell: ${key}`);
      const canonicalRows = [...rows].sort((left, right) =>
        left.caseId < right.caseId ? -1 : left.caseId > right.caseId ? 1 : 0,
      );
      return summarizeCell(track, architecture, canonicalRows);
    }),
  );
}

function validateTrace(trace: FinanceBenchmarkTrace): void {
  assertDataObject(trace, traceKeys, "finance trace", false);
  if (!isNonEmptyString(trace.caseId))
    throw new TypeError("finance caseId is required");
  if (!isNonEmptyString(trace.groupId))
    throw new TypeError("finance groupId is required");
  if (!trackSet.has(trace.track))
    throw new TypeError(`invalid finance track: ${String(trace.track)}`);
  if (!architectureSet.has(trace.architecture))
    throw new TypeError(
      `invalid finance architecture: ${String(trace.architecture)}`,
    );
  if (!routeSet.has(trace.goldRoute))
    throw new TypeError(
      `invalid finance goldRoute: ${String(trace.goldRoute)}`,
    );
  for (const [name, value] of [
    ["lookaheadProbe", trace.lookaheadProbe],
    ["lookaheadRejected", trace.lookaheadRejected],
    ["unsafeExecutionAttempt", trace.unsafeExecutionAttempt],
  ] as const)
    if (typeof value !== "boolean")
      throw new TypeError(`${name} must be boolean`);

  if (trace.status === "predicted") validatePredictedTrace(trace);
  else if (trace.status === "rejected_lookahead")
    validateRejectedLookaheadTrace(trace);
  else
    throw new TypeError(
      `invalid finance trace status: ${String(trace.status)}`,
    );
  if (trace.unsafeExecutionAttempt)
    throw new TypeError("finance benchmark trace attempted unsafe execution");
  finiteNonNegative(trace.durationMs, "durationMs");
  if (trace.inputTokens !== null)
    safeNonNegativeInteger(trace.inputTokens, "inputTokens");
  if (trace.costMicros !== null && !/^(0|[1-9]\d*)$/.test(trace.costMicros))
    throw new TypeError("costMicros must be a non-negative integer string");
}

function validatePredictedTrace(trace: FinancePredictedTrace): void {
  assertDataObject(trace, predictedTraceKeys, "predicted finance trace", false);
  if (trace.lookaheadProbe)
    throw new TypeError(
      "predicted finance trace cannot represent a lookahead probe",
    );
  if (trace.lookaheadRejected !== false)
    throw new TypeError("predicted finance trace cannot reject lookahead");
  if (!routeSet.has(trace.predictedRoute))
    throw new TypeError(
      `invalid finance predictedRoute: ${String(trace.predictedRoute)}`,
    );
  if (typeof trace.abstained !== "boolean")
    throw new TypeError("abstained must be boolean");
  if (trace.calibrationStatus === "measured") {
    if (trace.architecture === "deterministic_only")
      throw new TypeError(
        "deterministic_only traces cannot claim measured route-question probabilities",
      );
    if (Object.hasOwn(trace, "calibrationReason"))
      throw new TypeError("measured calibration cannot include a reason");
    validateProbabilities(trace.routeQuestionProbabilities);
    return;
  }
  if (trace.calibrationStatus !== "unavailable")
    throw new TypeError("invalid finance calibrationStatus");
  assertDataObject(
    trace,
    ["calibrationReason"],
    "uncalibrated finance trace",
    false,
  );
  if (trace.routeQuestionProbabilities !== null)
    throw new TypeError(
      "unavailable calibration requires null routeQuestionProbabilities",
    );
  const expectedReason =
    trace.architecture === "deterministic_only"
      ? "deterministic_only"
      : trace.architecture === "host_plus_jev"
        ? "composite_no_distribution"
        : undefined;
  if (
    expectedReason === undefined ||
    trace.calibrationReason !== expectedReason
  )
    throw new TypeError(
      "calibrationReason is incompatible with the finance architecture",
    );
}

function validateRejectedLookaheadTrace(
  trace: FinanceRejectedLookaheadTrace,
): void {
  if (!trace.lookaheadProbe || !trace.lookaheadRejected)
    throw new TypeError(
      "rejected_lookahead trace requires a rejected lookahead probe",
    );
  if (predictionOnlyKeys.some((key) => Object.hasOwn(trace, key)))
    throw new TypeError(
      "rejected_lookahead trace cannot contain prediction fields",
    );
  if (trace.inputTokens !== 0 || trace.costMicros !== "0")
    throw new TypeError(
      "rejected_lookahead trace must record zero provider accounting",
    );
}

function validateProbabilities(probabilities: FinanceRouteProbabilities): void {
  assertDataObject(probabilities, financeRoutes, "finance probabilities", true);
  const values = financeRoutes.map((label) => probabilities[label]);
  for (const value of values) {
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw new TypeError("finance probabilities must be finite in [0, 1]");
  }
  if (Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) > 1e-6)
    throw new TypeError("finance probabilities must sum to 1 within 1e-6");
}

function summarizeCell(
  track: FinanceTrack,
  architecture: FinanceArchitecture,
  rows: readonly FinanceBenchmarkTrace[],
): FinanceBenchmarkCell {
  const probes = rows.filter((row) => row.lookaheadProbe);
  if (probes.length === 0)
    throw new TypeError(
      `finance benchmark cell has no lookahead probes: ${cellKey(track, architecture)}`,
    );
  const regular = rows.filter(
    (row): row is FinancePredictedTrace =>
      row.status === "predicted" && !row.lookaheadProbe,
  );
  if (regular.length === 0)
    throw new TypeError(
      `finance benchmark cell has no regular predicted cases: ${cellKey(track, architecture)}`,
    );
  const covered = regular.filter((row) => !row.abstained);
  const measured = regular.filter(
    (row): row is FinanceMeasuredPredictedTrace =>
      row.calibrationStatus === "measured",
  );
  const observations: CategoricalObservation[] = measured.map((row) => ({
    probabilities: row.routeQuestionProbabilities,
    gold: row.goldRoute,
  }));
  const brier = categoricalBrier(observations);
  const ece = topLabelEce(observations).value;
  const p50Ms = quantile(
    rows.map((row) => row.durationMs),
    0.5,
  );
  const p95Ms = quantile(
    rows.map((row) => row.durationMs),
    0.95,
  );
  if (p50Ms === null || p95Ms === null)
    throw new TypeError("finance benchmark cell must not be empty");
  const accounting = aggregateAccounting(rows);

  return {
    track,
    architecture,
    sampleCount: rows.length,
    calibrationStatus: measured.length === 0 ? "unavailable" : "measured",
    calibrationReason:
      measured.length === 0 ? "no_measured_route_question_distributions" : null,
    accountingStatus: accounting.status,
    accountingReason: accounting.reason,
    metrics: {
      accuracy:
        covered.length === 0
          ? null
          : covered.filter((row) => row.predictedRoute === row.goldRoute)
              .length / covered.length,
      macroF1: macroF1(regular),
      routeQuestionBrier: brier,
      routeQuestionEce: ece,
      coverage: covered.length / regular.length,
      unsafeExecutionAttemptRate: 0,
      lookaheadRejectionRate:
        probes.filter((row) => row.status === "rejected_lookahead").length /
        probes.length,
      p50Ms,
      p95Ms,
      inputTokens: accounting.inputTokens,
      estimatedCostUsd: accounting.estimatedCostUsd,
    },
  };
}

function macroF1(rows: readonly FinancePredictedTrace[]): number {
  const total = financeRoutes.reduce((sum, label) => {
    let truePositives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;
    for (const row of rows) {
      const predicted = row.abstained ? undefined : row.predictedRoute;
      if (predicted === label && row.goldRoute === label) truePositives++;
      else {
        if (predicted === label) falsePositives++;
        if (row.goldRoute === label) falseNegatives++;
      }
    }
    const denominator = 2 * truePositives + falsePositives + falseNegatives;
    return sum + (denominator === 0 ? 0 : (2 * truePositives) / denominator);
  }, 0);
  return total / financeRoutes.length;
}

function cellKey(
  track: FinanceTrack,
  architecture: FinanceArchitecture,
): string {
  return `${track}/${architecture}`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function finiteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0)
    throw new TypeError(`${name} must be finite and non-negative`);
}

function safeNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`${name} must be a non-negative safe integer`);
}

function aggregateAccounting(rows: readonly FinanceBenchmarkTrace[]): {
  readonly status: "MEASURED" | "UNMETERED";
  readonly reason: "unmetered_attempt" | null;
  readonly inputTokens: number | null;
  readonly estimatedCostUsd: number | null;
} {
  if (rows.some((row) => row.inputTokens === null || row.costMicros === null))
    return {
      status: "UNMETERED",
      reason: "unmetered_attempt",
      inputTokens: null,
      estimatedCostUsd: null,
    };
  let inputTokens = 0;
  let costMicros = 0n;
  for (const row of rows) {
    inputTokens += row.inputTokens ?? 0;
    if (!Number.isSafeInteger(inputTokens))
      throw new TypeError("inputTokens total must be a safe integer");
    costMicros += BigInt(row.costMicros ?? "0");
  }
  if (costMicros > BigInt(Number.MAX_SAFE_INTEGER))
    throw new TypeError("costMicros total exceeds the exact numeric range");
  return {
    status: "MEASURED",
    reason: null,
    inputTokens,
    estimatedCostUsd: Number(costMicros) / 1_000_000,
  };
}

function assertDataObject(
  value: unknown,
  expectedKeys: readonly string[],
  name: string,
  exact: boolean,
): asserts value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  )
    throw new TypeError(`${name} must be a plain object`);
  const actualKeys = Reflect.ownKeys(value);
  if (
    (exact && actualKeys.length !== expectedKeys.length) ||
    expectedKeys.some((key) => !actualKeys.includes(key)) ||
    (exact &&
      actualKeys.some(
        (key) => typeof key !== "string" || !expectedKeys.includes(key),
      ))
  )
    throw new TypeError(`${name} must contain exactly its documented fields`);
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor))
      throw new TypeError(`${name} fields must be data properties`);
  }
}

/** Pure, strict metrics. Invalid inputs are rejected rather than repaired. */
import { clusterBootstrap, type BootstrapInterval } from "./bootstrap.js";
export interface CategoricalObservation {
  readonly probabilities: Readonly<Record<string, number>>;
  readonly gold: string;
  readonly providerConfidence?: number;
}
export interface BinaryObservation {
  readonly probabilityYes: number;
  readonly gold: boolean;
}
export interface OrdinalObservation {
  readonly probabilities: readonly number[];
  readonly gold: number;
}
export interface MetricValue {
  readonly value: number | null;
  readonly reason?: "empty" | "zero_coverage" | "zero_successes";
}
export interface NllMetric extends MetricValue {
  readonly infiniteCount: number;
  readonly clippedCount: number;
  readonly epsilon?: number;
}
export interface ReliabilityBin {
  readonly lower: number;
  readonly upper: number;
  readonly count: number;
  readonly meanProbability: number | null;
  readonly accuracy: number | null;
}

function finiteProbability(value: number, name = "probability"): void {
  if (!Number.isFinite(value) || value < 0 || value > 1)
    throw new TypeError(`${name} must be finite in [0, 1]`);
}
function validateDistribution(
  probabilities: Readonly<Record<string, number>>,
): void {
  const values = Object.values(probabilities);
  if (values.length === 0)
    throw new TypeError("distribution must not be empty");
  for (const value of values) finiteProbability(value);
  const sum = values.reduce((total, value) => total + value, 0);
  if (Math.abs(sum - 1) > 1e-6)
    throw new TypeError("probabilities must sum to 1 within 1e-6");
}
function mean(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((a, b) => a + b, 0) / values.length;
}

export function binaryBrier(rows: readonly BinaryObservation[]): MetricValue {
  return {
    value: mean(
      rows.map((row) => {
        finiteProbability(row.probabilityYes);
        return (row.probabilityYes - Number(row.gold)) ** 2;
      }),
    ),
    ...(rows.length === 0 ? { reason: "empty" as const } : {}),
  };
}
export function categoricalBrier(
  rows: readonly CategoricalObservation[],
): number | null {
  return mean(
    rows.map((row) => {
      validateDistribution(row.probabilities);
      if (!(row.gold in row.probabilities))
        throw new TypeError("gold must be a distribution label");
      return Object.entries(row.probabilities).reduce(
        (sum, [label, probability]) =>
          sum + (probability - Number(label === row.gold)) ** 2,
        0,
      );
    }),
  );
}
export function nll(
  rows: readonly CategoricalObservation[] | readonly BinaryObservation[],
  epsilon?: number,
): NllMetric {
  if (
    epsilon !== undefined &&
    (!Number.isFinite(epsilon) || epsilon <= 0 || epsilon > 1)
  )
    throw new TypeError("epsilon must be finite in (0, 1]");
  let infiniteCount = 0;
  let clippedCount = 0;
  const losses: number[] = [];
  for (const row of rows) {
    let probability: number;
    if ("probabilities" in row) {
      validateDistribution(row.probabilities);
      const goldProbability = row.probabilities[row.gold];
      if (goldProbability === undefined)
        throw new TypeError("gold must be a distribution label");
      probability = goldProbability;
    } else {
      finiteProbability(row.probabilityYes);
      probability = row.gold ? row.probabilityYes : 1 - row.probabilityYes;
    }
    if (probability === 0 && epsilon === undefined) {
      infiniteCount++;
      continue;
    }
    const effective =
      epsilon === undefined ? probability : Math.max(probability, epsilon);
    if (effective !== probability) clippedCount++;
    losses.push(-Math.log(effective));
  }
  return {
    value: infiniteCount > 0 ? Infinity : mean(losses),
    infiniteCount,
    clippedCount,
    ...(epsilon === undefined ? {} : { epsilon }),
    ...(rows.length === 0 ? { reason: "empty" as const } : {}),
  };
}
export function topLabelReliability(
  rows: readonly CategoricalObservation[],
  bins = 10,
): readonly ReliabilityBin[] {
  if (!Number.isInteger(bins) || bins < 1)
    throw new TypeError("bins must be a positive integer");
  const result: ReliabilityBin[] = Array.from({ length: bins }, (_, index) => ({
    lower: index / bins,
    upper: (index + 1) / bins,
    count: 0,
    meanProbability: null,
    accuracy: null,
  }));
  const bucket: Array<Array<{ confidence: number; correct: number }>> =
    Array.from({ length: bins }, () => []);
  for (const row of rows) {
    validateDistribution(row.probabilities);
    if (!(row.gold in row.probabilities))
      throw new TypeError("gold must be a distribution label");
    const highest = Math.max(...Object.values(row.probabilities));
    const selected = Object.keys(row.probabilities).filter(
      (key) => row.probabilities[key] === highest,
    );
    const index = Math.min(bins - 1, Math.floor(highest * bins));
    bucket[index]?.push({
      confidence: highest,
      correct: selected.includes(row.gold) ? 1 : 0,
    });
  }
  return result.map((bin, index) => {
    const values = bucket[index] ?? [];
    return values.length === 0
      ? bin
      : {
          ...bin,
          count: values.length,
          meanProbability: mean(values.map((value) => value.confidence)),
          accuracy: mean(values.map((value) => value.correct)),
        };
  });
}
export function topLabelEce(
  rows: readonly CategoricalObservation[],
  bins = 10,
): MetricValue & { readonly bins: readonly ReliabilityBin[] } {
  const reliability = topLabelReliability(rows, bins);
  if (rows.length === 0)
    return { value: null, reason: "empty", bins: reliability };
  return {
    value: reliability.reduce(
      (total, bin) =>
        total +
        (bin.count / rows.length) *
          Math.abs((bin.meanProbability ?? 0) - (bin.accuracy ?? 0)),
      0,
    ),
    bins: reliability,
  };
}
export function noulReliability(
  rows: readonly BinaryObservation[],
  bins = 10,
): readonly ReliabilityBin[] {
  if (!Number.isInteger(bins) || bins < 1)
    throw new TypeError("bins must be a positive integer");
  const buckets: Array<Array<BinaryObservation>> = Array.from(
    { length: bins },
    () => [],
  );
  for (const row of rows) {
    finiteProbability(row.probabilityYes);
    buckets[Math.min(bins - 1, Math.floor(row.probabilityYes * bins))]?.push(
      row,
    );
  }
  return buckets.map((values, index) => ({
    lower: index / bins,
    upper: (index + 1) / bins,
    count: values.length,
    meanProbability: mean(values.map((row) => row.probabilityYes)),
    accuracy: mean(values.map((row) => Number(row.gold))),
  }));
}
export function ordinalMae(rows: readonly OrdinalObservation[]): MetricValue {
  return {
    value: mean(
      rows.map((row) => {
        validateOrdinal(row);
        const prediction = row.probabilities.reduce(
          (sum, probability, index) => sum + probability * index,
          0,
        );
        return Math.abs(prediction - row.gold);
      }),
    ),
    ...(rows.length === 0 ? { reason: "empty" as const } : {}),
  };
}
export function rankedProbabilityScore(
  rows: readonly OrdinalObservation[],
): MetricValue {
  return {
    value: mean(
      rows.map((row) => {
        validateOrdinal(row);
        if (row.probabilities.length < 2)
          throw new TypeError("RPS requires two or more levels");
        let cumulative = 0;
        let score = 0;
        for (let index = 0; index < row.probabilities.length - 1; index++) {
          cumulative += row.probabilities[index] ?? 0;
          score += (cumulative - Number(row.gold <= index)) ** 2;
        }
        return score / (row.probabilities.length - 1);
      }),
    ),
    ...(rows.length === 0 ? { reason: "empty" as const } : {}),
  };
}
function validateOrdinal(row: OrdinalObservation): void {
  if (
    !Number.isInteger(row.gold) ||
    row.gold < 0 ||
    row.gold >= row.probabilities.length
  )
    throw new TypeError("gold must be an ordinal level");
  const distribution = Object.fromEntries(
    row.probabilities.map((probability, index) => [String(index), probability]),
  );
  validateDistribution(distribution);
}
export function quantile(values: readonly number[], q: number): number | null {
  if (!Number.isFinite(q) || q < 0 || q > 1)
    throw new TypeError("quantile must be in [0, 1]");
  if (values.length === 0) return null;
  for (const value of values)
    if (!Number.isFinite(value)) throw new TypeError("values must be finite");
  const ordered = [...values].sort((a, b) => a - b);
  return (
    ordered[Math.min(ordered.length - 1, Math.floor(q * ordered.length))] ??
    null
  );
}
export interface AttemptCost {
  readonly logicalRequestId: string;
  readonly outcome: "succeeded" | "failed" | "cancelled";
  readonly amountMicros?: bigint;
}
export interface CostPerSuccess extends MetricValue {
  readonly attemptedMicros: bigint;
  readonly attemptedMicrosDecimal: string | null;
  readonly microsPerSuccessfulTask: string | null;
  readonly successfulTasks: number;
  readonly unmeteredAttempts: number;
}
/** Failed and retried transport attempts remain in the numerator. Unknown billing stays unknown. */
export function costPerSuccessfulTask(
  attempts: readonly AttemptCost[],
  successfulTaskIds: readonly string[],
): CostPerSuccess {
  const successfulTasks = new Set(successfulTaskIds);
  const unmeteredAttempts = attempts.filter(
    (attempt) => attempt.amountMicros === undefined,
  ).length;
  const attemptedMicros = attempts.reduce(
    (total, attempt) => total + (attempt.amountMicros ?? 0n),
    0n,
  );
  if (successfulTasks.size === 0)
    return {
      value: null,
      reason: "zero_successes",
      attemptedMicros,
      attemptedMicrosDecimal:
        unmeteredAttempts === 0 ? attemptedMicros.toString() : null,
      microsPerSuccessfulTask: null,
      successfulTasks: 0,
      unmeteredAttempts,
    };
  if (unmeteredAttempts > 0)
    return {
      value: null,
      reason: "empty",
      attemptedMicros,
      attemptedMicrosDecimal: null,
      microsPerSuccessfulTask: null,
      successfulTasks: successfulTasks.size,
      unmeteredAttempts,
    };
  return {
    value:
      attemptedMicros <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(attemptedMicros) / successfulTasks.size
        : null,
    attemptedMicros,
    attemptedMicrosDecimal: attemptedMicros.toString(),
    microsPerSuccessfulTask: `${attemptedMicros / BigInt(successfulTasks.size)}`,
    successfulTasks: successfulTasks.size,
    unmeteredAttempts,
  };
}
export interface EvaluationCase {
  readonly id: string;
  readonly groupId: string;
  readonly goldLabel?: string;
  readonly outcome: "correct" | "incorrect" | "abstained" | "invalid";
}
export interface EvaluationSummary {
  readonly cases: number;
  readonly independentGroups: number;
  readonly prevalence: Readonly<Record<string, number>>;
  readonly invalidResponses: number;
  readonly abstentions: number;
  readonly accuracy: MetricValue;
  readonly coverage: MetricValue;
  readonly intervals: {
    readonly accuracy: BootstrapInterval;
    readonly coverage: BootstrapInterval;
  };
}
export function evaluateCases(
  rows: readonly EvaluationCase[],
  options: { readonly seed?: number; readonly replicates?: number } = {},
): EvaluationSummary {
  const ids = new Set<string>();
  const groups = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) throw new TypeError(`duplicate case id: ${row.id}`);
    if (!row.groupId) throw new TypeError("group id is required");
    ids.add(row.id);
    groups.add(row.groupId);
  }
  const valid = rows.filter(
    (row) => row.outcome === "correct" || row.outcome === "incorrect",
  );
  const correct = valid.filter((row) => row.outcome === "correct").length;
  const seed = options.seed ?? 1;
  const replicates = options.replicates ?? 1000;
  const accuracyInterval =
    valid.length === 0
      ? {
          estimate: null,
          lower: null,
          upper: null,
          replicates,
          method: "cluster_percentile" as const,
          groups: groups.size,
          seed,
          reason: "zero_coverage" as const,
        }
      : clusterBootstrap(
          rows,
          (row) => row.groupId,
          (sample) => {
            const usable = sample.filter(
              (row) => row.outcome === "correct" || row.outcome === "incorrect",
            );
            return usable.length === 0
              ? 0
              : usable.filter((row) => row.outcome === "correct").length /
                  usable.length;
          },
          { seed, replicates },
        );
  const coverageInterval = clusterBootstrap(
    rows,
    (row) => row.groupId,
    (sample) =>
      sample.length === 0
        ? 0
        : sample.filter(
            (row) => row.outcome === "correct" || row.outcome === "incorrect",
          ).length / sample.length,
    { seed, replicates },
  );
  const labels = new Map<string, number>();
  for (const row of rows)
    if (row.goldLabel)
      labels.set(row.goldLabel, (labels.get(row.goldLabel) ?? 0) + 1);
  const prevalence = Object.fromEntries(
    [...labels.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([label, count]) => [
        label,
        rows.length === 0 ? 0 : count / rows.length,
      ]),
  );
  return {
    cases: rows.length,
    independentGroups: groups.size,
    prevalence,
    invalidResponses: rows.filter((row) => row.outcome === "invalid").length,
    abstentions: rows.filter((row) => row.outcome === "abstained").length,
    accuracy: {
      value: valid.length === 0 ? null : correct / valid.length,
      ...(valid.length === 0 ? { reason: "empty" as const } : {}),
    },
    coverage: {
      value: rows.length === 0 ? null : valid.length / rows.length,
      ...(rows.length === 0 ? { reason: "empty" as const } : {}),
    },
    intervals: { accuracy: accuracyInterval, coverage: coverageInterval },
  };
}

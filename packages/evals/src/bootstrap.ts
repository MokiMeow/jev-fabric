export interface BootstrapOptions {
  readonly replicates: number;
  readonly seed: number;
  readonly confidenceLevel?: number;
}
export interface BootstrapInterval {
  readonly estimate: number | null;
  readonly lower: number | null;
  readonly upper: number | null;
  readonly replicates: number;
  readonly method: "cluster_percentile";
  readonly groups: number;
  readonly seed: number;
  readonly reason?: "empty" | "zero_coverage";
}
/** Deterministic xorshift32; injected seed makes the resampling auditably replayable. */
export function clusterBootstrap<T>(
  rows: readonly T[],
  groupOf: (row: T) => string,
  metric: (sample: readonly T[]) => number,
  options: BootstrapOptions,
): BootstrapInterval {
  if (!Number.isInteger(options.replicates) || options.replicates < 1)
    throw new TypeError("replicates must be a positive integer");
  if (!Number.isInteger(options.seed))
    throw new TypeError("seed must be an integer");
  if (options.seed === 0) throw new TypeError("seed must be non-zero");
  const confidenceLevel = options.confidenceLevel ?? 0.95;
  if (!(confidenceLevel > 0 && confidenceLevel < 1))
    throw new TypeError("confidenceLevel must be in (0, 1)");
  const clusters = new Map<string, T[]>();
  for (const row of rows) {
    const group = groupOf(row);
    if (!group) throw new TypeError("group id is required");
    const bucket = clusters.get(group) ?? [];
    bucket.push(row);
    clusters.set(group, bucket);
  }
  if (clusters.size === 0)
    return {
      estimate: null,
      lower: null,
      upper: null,
      replicates: options.replicates,
      method: "cluster_percentile",
      groups: 0,
      seed: options.seed,
      reason: "empty",
    };
  let state = options.seed >>> 0;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
  const groupRows = [...clusters.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, rows]) => rows);
  const values: number[] = [];
  for (let replicate = 0; replicate < options.replicates; replicate++) {
    const sample: T[] = [];
    for (let pick = 0; pick < groupRows.length; pick++) {
      const cluster = groupRows[Math.floor(random() * groupRows.length)];
      if (cluster) sample.push(...cluster);
    }
    const value = metric(sample);
    if (!Number.isFinite(value))
      throw new TypeError("bootstrap metric must be finite");
    values.push(value);
  }
  values.sort((a, b) => a - b);
  const alpha = (1 - confidenceLevel) / 2;
  const select = (q: number) =>
    values[
      Math.min(values.length - 1, Math.max(0, Math.floor(q * values.length)))
    ];
  return {
    estimate: metric(rows),
    lower: select(alpha) ?? null,
    upper: select(1 - alpha) ?? null,
    replicates: options.replicates,
    method: "cluster_percentile",
    groups: clusters.size,
    seed: options.seed,
  };
}

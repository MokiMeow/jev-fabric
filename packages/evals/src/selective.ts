export interface SelectiveObservation {
  readonly score: number;
  readonly correct: boolean;
  readonly eligible?: boolean;
}
export interface RiskCoverage {
  readonly threshold: number;
  readonly eligible: number;
  readonly accepted: number;
  readonly coverage: number | null;
  readonly risk: number | null;
  readonly reason?: "empty" | "zero_coverage";
}
export function selectiveRisk(
  rows: readonly SelectiveObservation[],
  threshold: number,
): RiskCoverage {
  if (!Number.isFinite(threshold))
    throw new TypeError("threshold must be finite");
  const eligible = rows.filter((row) => row.eligible ?? true);
  for (const row of eligible)
    if (!Number.isFinite(row.score))
      throw new TypeError("score must be finite");
  const accepted = eligible.filter((row) => row.score >= threshold);
  if (eligible.length === 0)
    return {
      threshold,
      eligible: 0,
      accepted: 0,
      coverage: null,
      risk: null,
      reason: "empty",
    };
  if (accepted.length === 0)
    return {
      threshold,
      eligible: eligible.length,
      accepted: 0,
      coverage: 0,
      risk: null,
      reason: "zero_coverage",
    };
  return {
    threshold,
    eligible: eligible.length,
    accepted: accepted.length,
    coverage: accepted.length / eligible.length,
    risk: accepted.filter((row) => !row.correct).length / accepted.length,
  };
}
export function riskCoverageCurve(
  rows: readonly SelectiveObservation[],
): readonly RiskCoverage[] {
  return [...new Set(rows.map((row) => row.score))]
    .sort((a, b) => b - a)
    .map((threshold) => selectiveRisk(rows, threshold));
}

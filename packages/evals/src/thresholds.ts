import { selectiveRisk, type SelectiveObservation } from "./selective.js";
export interface EvaluationGroup {
  readonly family: string;
  readonly session: string;
  readonly repository: string;
  readonly source: string;
}
export interface ThresholdCase extends SelectiveObservation {
  readonly id: string;
  readonly group: EvaluationGroup;
  readonly split: "development" | "calibration" | "test";
}
export interface ThresholdSelection {
  readonly threshold: number | null;
  readonly calibrationCount: number;
  readonly accepted: number;
  readonly risk: number | null;
  readonly coverage: number | null;
  readonly objective: "max_coverage_under_risk";
  readonly reason?: string;
}
export function fitThreshold(
  rows: readonly ThresholdCase[],
  maxRisk: number,
): ThresholdSelection {
  if (!Number.isFinite(maxRisk) || maxRisk < 0 || maxRisk > 1)
    throw new TypeError("maxRisk must be in [0, 1]");
  assertGroupedSplit(rows);
  const calibration = rows.filter((row) => row.split === "calibration");
  if (calibration.length === 0)
    return {
      threshold: null,
      calibrationCount: 0,
      accepted: 0,
      risk: null,
      coverage: null,
      objective: "max_coverage_under_risk",
      reason: "no calibration cases",
    };
  const candidates = [...new Set(calibration.map((row) => row.score))].sort(
    (a, b) => a - b,
  );
  const choices = candidates
    .map((threshold) => selectiveRisk(calibration, threshold))
    .filter((result) => result.risk !== null && result.risk <= maxRisk);
  const best = choices.sort(
    (a, b) => b.accepted - a.accepted || a.threshold - b.threshold,
  )[0];
  return best === undefined
    ? {
        threshold: null,
        calibrationCount: calibration.length,
        accepted: 0,
        risk: null,
        coverage: null,
        objective: "max_coverage_under_risk",
        reason: "no threshold meets risk bound",
      }
    : {
        threshold: best.threshold,
        calibrationCount: calibration.length,
        accepted: best.accepted,
        risk: best.risk,
        coverage: best.coverage,
        objective: "max_coverage_under_risk",
      };
}
export function assertGroupedSplit(rows: readonly ThresholdCase[]): void {
  const splits = new Map<string, string>();
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) throw new TypeError(`duplicate case id: ${row.id}`);
    ids.add(row.id);
    const groupId = canonicalGroup(row);
    const old = splits.get(groupId);
    if (old !== undefined && old !== row.split)
      throw new TypeError(`group crosses splits: ${groupId}`);
    splits.set(groupId, row.split);
  }
}
function canonicalGroup(row: ThresholdCase): string {
  const values = [
    row.group.family,
    row.group.session,
    row.group.repository,
    row.group.source,
  ];
  if (values.some((value) => value.length === 0))
    throw new TypeError("group components are required");
  return values.join("\u0000");
}

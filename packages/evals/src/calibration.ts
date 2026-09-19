import {
  binaryBrier,
  nll,
  type BinaryObservation,
  type CategoricalObservation,
  type MetricValue,
  type NllMetric,
} from "./metrics.js";
export interface CalibrationSummary {
  readonly split: "calibration";
  readonly count: number;
  readonly binaryBrier: MetricValue;
  readonly nll: NllMetric;
  readonly correction?: string;
}
export function summarizeBinaryCalibration(
  rows: readonly BinaryObservation[],
): CalibrationSummary {
  return {
    split: "calibration",
    count: rows.length,
    binaryBrier: binaryBrier(rows),
    nll: nll(rows),
  };
}
export function selectedClassProbability(row: CategoricalObservation): number {
  const values = Object.values(row.probabilities);
  if (values.length === 0)
    throw new TypeError("distribution must not be empty");
  return Math.max(...values);
}

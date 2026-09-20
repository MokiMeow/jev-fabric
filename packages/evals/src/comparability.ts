import { isProxy } from "node:util/types";

export const probabilitySemantics = [
  "none",
  "native_calibrated",
  "normalized_logits",
  "self_reported",
  "synthetic",
  "unknown",
] as const;

export type ProbabilitySemantics = (typeof probabilitySemantics)[number];

export interface ProbabilityEvaluationDescriptor {
  readonly probabilitySemantics: ProbabilitySemantics;
  readonly evaluationContractId: string;
  readonly populationId: string;
  readonly metricTarget: string;
}

export type ProbabilityComparabilityReason =
  | "matched_probability_semantics"
  | "self_reported_probability"
  | "probability_semantics_differ"
  | "probability_unavailable"
  | "probability_semantics_unknown"
  | "probability_semantics_synthetic"
  | "evaluation_contract_mismatch"
  | "population_mismatch"
  | "metric_target_mismatch";

export interface ProbabilityComparabilityAssessment {
  readonly contractId: "probability-comparability.v1";
  readonly decisionOutcomeMetrics: "comparable" | "not_comparable";
  readonly probabilityCalibrationMetrics:
    | "comparable"
    | "descriptive_only"
    | "unavailable";
  readonly rawProbabilityValues: "comparable" | "not_comparable";
  readonly reason: ProbabilityComparabilityReason;
}

const semanticsSet = new Set<string>(probabilitySemantics);
const portableId = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;

/**
 * Classifies which cross-system metric comparisons an evaluation may claim.
 * Matching semantics are necessary but not sufficient: the task contract,
 * held-out population, and metric target must also match exactly.
 */
export function assessProbabilityComparability(
  reference: ProbabilityEvaluationDescriptor,
  candidate: ProbabilityEvaluationDescriptor,
): ProbabilityComparabilityAssessment {
  validateDescriptor(reference, "reference");
  validateDescriptor(candidate, "candidate");

  if (reference.evaluationContractId !== candidate.evaluationContractId)
    return notComparable("evaluation_contract_mismatch");
  if (reference.populationId !== candidate.populationId)
    return notComparable("population_mismatch");
  if (reference.metricTarget !== candidate.metricTarget)
    return notComparable("metric_target_mismatch");

  const semantics = [
    reference.probabilitySemantics,
    candidate.probabilitySemantics,
  ] as const;
  if (semantics.includes("none"))
    return unavailable("probability_unavailable", "comparable");
  if (semantics.includes("unknown"))
    return unavailable("probability_semantics_unknown", "comparable");
  if (semantics.includes("synthetic"))
    return unavailable("probability_semantics_synthetic", "comparable");
  if (semantics[0] !== semantics[1])
    return descriptive("probability_semantics_differ");
  if (semantics[0] === "self_reported")
    return descriptive("self_reported_probability");

  return {
    contractId: "probability-comparability.v1",
    decisionOutcomeMetrics: "comparable",
    probabilityCalibrationMetrics: "comparable",
    rawProbabilityValues: "comparable",
    reason: "matched_probability_semantics",
  };
}

function descriptive(
  reason: ProbabilityComparabilityReason,
): ProbabilityComparabilityAssessment {
  return {
    contractId: "probability-comparability.v1",
    decisionOutcomeMetrics: "comparable",
    probabilityCalibrationMetrics: "descriptive_only",
    rawProbabilityValues: "not_comparable",
    reason,
  };
}

function unavailable(
  reason: ProbabilityComparabilityReason,
  decisionOutcomeMetrics: "comparable" | "not_comparable",
): ProbabilityComparabilityAssessment {
  return {
    contractId: "probability-comparability.v1",
    decisionOutcomeMetrics,
    probabilityCalibrationMetrics: "unavailable",
    rawProbabilityValues: "not_comparable",
    reason,
  };
}

function notComparable(
  reason: ProbabilityComparabilityReason,
): ProbabilityComparabilityAssessment {
  return unavailable(reason, "not_comparable");
}

function validateDescriptor(
  descriptor: ProbabilityEvaluationDescriptor,
  label: string,
): void {
  if (
    !descriptor ||
    typeof descriptor !== "object" ||
    Array.isArray(descriptor) ||
    isProxy(descriptor) ||
    Object.getPrototypeOf(descriptor) !== Object.prototype
  )
    throw new TypeError(`${label} descriptor must be a plain object`);
  const fields = [
    "probabilitySemantics",
    "evaluationContractId",
    "populationId",
    "metricTarget",
  ] as const;
  const descriptors = Object.getOwnPropertyDescriptors(descriptor);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string"))
    throw new TypeError(`${label} descriptor must not contain symbols`);
  const keys = Object.keys(descriptors);
  if (
    keys.length !== fields.length ||
    fields.some((field) => !Object.hasOwn(descriptors, field))
  )
    throw new TypeError(
      `${label} descriptor must contain only the required fields`,
    );
  for (const field of fields) {
    const property = descriptors[field];
    if (!property?.enumerable || !("value" in property))
      throw new TypeError(`${label} descriptor must contain only data fields`);
  }
  if (!semanticsSet.has(descriptors.probabilitySemantics?.value as string))
    throw new TypeError(`${label} probability semantics are invalid`);
  for (const field of [
    "evaluationContractId",
    "populationId",
    "metricTarget",
  ] as const)
    if (
      typeof descriptors[field]?.value !== "string" ||
      !portableId.test(descriptors[field].value as string)
    )
      throw new TypeError(`${label} ${field} must be a portable identifier`);
}

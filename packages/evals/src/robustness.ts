import { isProxy } from "node:util/types";

export type RobustnessIntervention =
  | "batching"
  | "paraphrase"
  | "option_order"
  | "question_order"
  | "state_order"
  | "repeat";

export interface CategoricalDecisionObservation {
  readonly probabilities: Readonly<Record<string, number>>;
  readonly selected: string;
}

export interface PairedCategoricalObservation {
  readonly pairId: string;
  readonly family: RobustnessIntervention;
  readonly reference: CategoricalDecisionObservation;
  readonly variant: CategoricalDecisionObservation;
  readonly gold?: string;
}

export interface PairedCategoricalRobustness {
  readonly pairCount: number;
  readonly labeledPairCount: number;
  readonly agreementCount: number;
  readonly flipCount: number;
  readonly regressionCount: number;
  readonly recoveryCount: number;
  readonly stableErrorCount: number;
  readonly labelAgreementRate: number | null;
  readonly flipRate: number | null;
  readonly referenceAccuracy: number | null;
  readonly variantAccuracy: number | null;
  readonly jointAccuracy: number | null;
  readonly regressionRate: number | null;
  readonly recoveryRate: number | null;
  readonly stableErrorRate: number | null;
  readonly meanTotalVariation: number | null;
  readonly maxTotalVariation: number | null;
  readonly reason?: "empty";
}

const interventions = new Set<RobustnessIntervention>([
  "batching",
  "paraphrase",
  "option_order",
  "question_order",
  "state_order",
  "repeat",
]);

/**
 * Measures paired sensitivity without treating agreement as correctness.
 * Reference and variant must have the same semantic labels; option order in
 * their probability objects is deliberately ignored.
 */
export function pairedCategoricalRobustness(
  rows: readonly PairedCategoricalObservation[],
): PairedCategoricalRobustness {
  if (
    !Array.isArray(rows) ||
    isProxy(rows) ||
    Object.getPrototypeOf(rows) !== Array.prototype
  )
    throw new TypeError("rows must be a plain array");
  if (rows.length > 1_000_000)
    throw new TypeError("rows exceed the paired robustness limit");
  assertPlainRowsArray(rows);
  if (rows.length === 0) return emptyResult();

  const pairIds = new Set<string>();
  let agreementCount = 0;
  let referenceCorrect = 0;
  let variantCorrect = 0;
  let jointCorrect = 0;
  let regressionCount = 0;
  let recoveryCount = 0;
  let stableErrorCount = 0;
  let labeledPairCount = 0;
  let totalVariationSum = 0;
  let maxTotalVariation = 0;

  for (const row of rows) {
    assertPlainRow(row);
    if (
      typeof row.pairId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(row.pairId)
    )
      throw new TypeError("pair id must be a portable non-empty identifier");
    if (pairIds.has(row.pairId))
      throw new TypeError(`duplicate pair id: ${row.pairId}`);
    pairIds.add(row.pairId);
    if (!interventions.has(row.family))
      throw new TypeError(`unknown robustness intervention: ${row.family}`);

    const reference = validateDecision(row.reference, "reference");
    const variant = validateDecision(row.variant, "variant");
    const referenceLabels = [...reference.probabilities.keys()].sort();
    const variantLabels = [...variant.probabilities.keys()].sort();
    if (JSON.stringify(referenceLabels) !== JSON.stringify(variantLabels))
      throw new TypeError("reference and variant must contain the same labels");

    if (reference.selected === variant.selected) agreementCount++;
    const totalVariation =
      referenceLabels.reduce(
        (sum, label) =>
          sum +
          Math.abs(
            requiredProbability(reference.probabilities, label) -
              requiredProbability(variant.probabilities, label),
          ),
        0,
      ) / 2;
    totalVariationSum += totalVariation;
    maxTotalVariation = Math.max(maxTotalVariation, totalVariation);

    if (row.gold === undefined) continue;
    if (!reference.probabilities.has(row.gold))
      throw new TypeError("gold must be a reference and variant label");
    labeledPairCount++;
    const isReferenceCorrect = reference.selected === row.gold;
    const isVariantCorrect = variant.selected === row.gold;
    if (isReferenceCorrect) referenceCorrect++;
    if (isVariantCorrect) variantCorrect++;
    if (isReferenceCorrect && isVariantCorrect) jointCorrect++;
    else if (isReferenceCorrect) regressionCount++;
    else if (isVariantCorrect) recoveryCount++;
    else stableErrorCount++;
  }

  const pairCount = rows.length;
  return {
    pairCount,
    labeledPairCount,
    agreementCount,
    flipCount: pairCount - agreementCount,
    regressionCount,
    recoveryCount,
    stableErrorCount,
    labelAgreementRate: agreementCount / pairCount,
    flipRate: (pairCount - agreementCount) / pairCount,
    referenceAccuracy: ratio(referenceCorrect, labeledPairCount),
    variantAccuracy: ratio(variantCorrect, labeledPairCount),
    jointAccuracy: ratio(jointCorrect, labeledPairCount),
    regressionRate: ratio(regressionCount, labeledPairCount),
    recoveryRate: ratio(recoveryCount, labeledPairCount),
    stableErrorRate: ratio(stableErrorCount, labeledPairCount),
    meanTotalVariation: totalVariationSum / pairCount,
    maxTotalVariation,
  };
}

function validateDecision(
  decision: CategoricalDecisionObservation,
  label: string,
): {
  readonly probabilities: ReadonlyMap<string, number>;
  readonly selected: string;
} {
  if (
    !decision ||
    typeof decision !== "object" ||
    Array.isArray(decision) ||
    isProxy(decision) ||
    Object.getPrototypeOf(decision) !== Object.prototype
  )
    throw new TypeError(`${label} decision must be a plain object`);
  const descriptors = Object.getOwnPropertyDescriptors(decision);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string"))
    throw new TypeError(`${label} decision must not contain symbols`);
  const keys = Object.keys(descriptors);
  if (
    keys.length !== 2 ||
    !keys.includes("probabilities") ||
    !keys.includes("selected")
  )
    throw new TypeError(
      `${label} decision must contain only probabilities and selected`,
    );
  const probabilitiesDescriptor = descriptors.probabilities;
  const selectedDescriptor = descriptors.selected;
  if (
    !probabilitiesDescriptor?.enumerable ||
    !("value" in probabilitiesDescriptor) ||
    !selectedDescriptor?.enumerable ||
    !("value" in selectedDescriptor)
  )
    throw new TypeError(`${label} decision must contain only data properties`);
  if (typeof selectedDescriptor.value !== "string")
    throw new TypeError(`${label} selected must be a string`);
  const probabilities = copyDistribution(
    probabilitiesDescriptor.value as Readonly<Record<string, number>>,
    label,
  );
  const selected = selectedDescriptor.value;
  const selectedProbability = probabilities.get(selected);
  if (selectedProbability === undefined)
    throw new TypeError(`${label} selected must be a distribution label`);
  if (selectedProbability !== Math.max(...probabilities.values()))
    throw new TypeError(`${label} selected must have maximum probability`);
  return { probabilities, selected };
}

function copyDistribution(
  input: Readonly<Record<string, number>>,
  name: string,
): ReadonlyMap<string, number> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    isProxy(input) ||
    (Object.getPrototypeOf(input) !== Object.prototype &&
      Object.getPrototypeOf(input) !== null)
  )
    throw new TypeError(`${name} probabilities must be a plain object`);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string"))
    throw new TypeError(`${name} probabilities must not contain symbols`);
  const entries = Object.entries(descriptors);
  if (entries.length < 2 || entries.length > 255)
    throw new TypeError(`${name} distribution must contain 2 to 255 labels`);
  const result = new Map<string, number>();
  let sum = 0;
  for (const [label, descriptor] of entries) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(label) ||
      !descriptor.enumerable ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "number" ||
      !Number.isFinite(descriptor.value) ||
      descriptor.value < 0 ||
      descriptor.value > 1
    )
      throw new TypeError(
        `${name} distribution contains an invalid label or probability`,
      );
    result.set(label, descriptor.value);
    sum += descriptor.value;
  }
  if (Math.abs(sum - 1) > 1e-6)
    throw new TypeError(`${name} probabilities must sum to 1 within 1e-6`);
  return result;
}

function assertPlainRow(row: PairedCategoricalObservation): void {
  if (
    !row ||
    typeof row !== "object" ||
    Array.isArray(row) ||
    isProxy(row) ||
    Object.getPrototypeOf(row) !== Object.prototype
  )
    throw new TypeError("paired observation must be a plain object");
  const allowed = new Set(["pairId", "family", "reference", "variant", "gold"]);
  const required = ["pairId", "family", "reference", "variant"];
  const descriptors = Object.getOwnPropertyDescriptors(row);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string"))
    throw new TypeError("paired observation must not contain symbols");
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!allowed.has(key) || !descriptor.enumerable || !("value" in descriptor))
      throw new TypeError(
        "paired observation contains an unknown or unsafe field",
      );
  }
  if (required.some((key) => !Object.hasOwn(descriptors, key)))
    throw new TypeError("paired observation is missing a required field");
  if (Object.keys(descriptors).some((key) => !allowed.has(key)))
    throw new TypeError("paired observation contains an unknown field");
}

function assertPlainRowsArray(
  rows: readonly PairedCategoricalObservation[],
): void {
  const descriptors = Object.getOwnPropertyDescriptors(rows);
  const allowed = new Set(["length"]);
  for (let index = 0; index < rows.length; index++) {
    const key = String(index);
    allowed.add(key);
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor))
      throw new TypeError("rows must not contain holes or accessors");
  }
  if (Reflect.ownKeys(descriptors).some((key) => !allowed.has(String(key))))
    throw new TypeError("rows must not contain extra properties");
}

function requiredProbability(
  probabilities: ReadonlyMap<string, number>,
  label: string,
): number {
  const value = probabilities.get(label);
  if (value === undefined) throw new TypeError("missing paired probability");
  return value;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function emptyResult(): PairedCategoricalRobustness {
  return {
    pairCount: 0,
    labeledPairCount: 0,
    agreementCount: 0,
    flipCount: 0,
    regressionCount: 0,
    recoveryCount: 0,
    stableErrorCount: 0,
    labelAgreementRate: null,
    flipRate: null,
    referenceAccuracy: null,
    variantAccuracy: null,
    jointAccuracy: null,
    regressionRate: null,
    recoveryRate: null,
    stableErrorRate: null,
    meanTotalVariation: null,
    maxTotalVariation: null,
    reason: "empty",
  };
}

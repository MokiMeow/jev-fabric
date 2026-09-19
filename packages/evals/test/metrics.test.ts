import { describe, expect, it } from "vitest";
import {
  binaryBrier,
  categoricalBrier,
  costPerSuccessfulTask,
  nll,
  noulReliability,
  ordinalMae,
  rankedProbabilityScore,
  selectiveRisk,
  topLabelEce,
} from "../src/index.js";

describe("hand-computed probability metrics", () => {
  it("uses selected-class probability, not provider confidence, for ECE", () => {
    const rows = [
      {
        probabilities: { no: 0.1, yes: 0.9 },
        gold: "yes",
        providerConfidence: 0.1,
      },
    ];
    expect(categoricalBrier(rows)).toBeCloseTo(0.02);
    expect(nll(rows).value).toBeCloseTo(-Math.log(0.9));
    expect(topLabelEce(rows).value).toBeCloseTo(0.1);
  });
});

it("handles abstention boundaries, ordinal metrics, and retry-inclusive cost", () => {
  expect(binaryBrier([{ probabilityYes: 0.25, gold: true }]).value).toBeCloseTo(
    0.5625,
  );
  expect(nll([{ probabilityYes: 0, gold: true }]).infiniteCount).toBe(1);
  expect(
    noulReliability([{ probabilityYes: 0.2, gold: false }])[2]?.accuracy,
  ).toBe(0);
  expect(
    ordinalMae([{ probabilities: [0.2, 0.3, 0.5], gold: 2 }]).value,
  ).toBeCloseTo(0.7);
  expect(
    rankedProbabilityScore([{ probabilities: [0.2, 0.3, 0.5], gold: 2 }]).value,
  ).toBeCloseTo(0.145);
  expect(selectiveRisk([{ score: 0.2, correct: true }], 1).risk).toBeNull();
  expect(
    costPerSuccessfulTask(
      [
        { logicalRequestId: "a", outcome: "failed", amountMicros: 5n },
        { logicalRequestId: "a", outcome: "succeeded", amountMicros: 10n },
      ],
      ["task"],
    ).value,
  ).toBe(15);
});

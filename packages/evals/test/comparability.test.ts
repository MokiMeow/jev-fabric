import { describe, expect, it } from "vitest";
import {
  assessProbabilityComparability,
  type ProbabilityEvaluationDescriptor,
} from "../src/comparability.js";

const descriptor = (
  probabilitySemantics: ProbabilityEvaluationDescriptor["probabilitySemantics"],
  overrides: Partial<ProbabilityEvaluationDescriptor> = {},
): ProbabilityEvaluationDescriptor => ({
  probabilitySemantics,
  evaluationContractId: "finance-question-set-v1",
  populationId:
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/test/market_surveillance",
  metricTarget: "atomic_gold_finance_route",
  ...overrides,
});

describe("probability comparability", () => {
  it("permits matched native probability comparisons only on the same evaluation", () => {
    expect(
      assessProbabilityComparability(
        descriptor("native_calibrated"),
        descriptor("native_calibrated"),
      ),
    ).toEqual({
      contractId: "probability-comparability.v1",
      decisionOutcomeMetrics: "comparable",
      probabilityCalibrationMetrics: "comparable",
      rawProbabilityValues: "comparable",
      reason: "matched_probability_semantics",
    });
  });

  it("keeps native versus self-reported calibration descriptive only", () => {
    expect(
      assessProbabilityComparability(
        descriptor("native_calibrated"),
        descriptor("self_reported"),
      ),
    ).toEqual({
      contractId: "probability-comparability.v1",
      decisionOutcomeMetrics: "comparable",
      probabilityCalibrationMetrics: "descriptive_only",
      rawProbabilityValues: "not_comparable",
      reason: "probability_semantics_differ",
    });
    expect(
      assessProbabilityComparability(
        descriptor("self_reported"),
        descriptor("self_reported"),
      ).reason,
    ).toBe("self_reported_probability");
  });

  it("makes synthetic, unknown, and absent probability comparisons unavailable", () => {
    for (const semantics of ["synthetic", "unknown", "none"] as const) {
      const result = assessProbabilityComparability(
        descriptor("native_calibrated"),
        descriptor(semantics),
      );
      expect(result.decisionOutcomeMetrics).toBe("comparable");
      expect(result.probabilityCalibrationMetrics).toBe("unavailable");
      expect(result.rawProbabilityValues).toBe("not_comparable");
    }
  });

  it("rejects cross-contract, cross-population, and cross-target comparisons", () => {
    expect(
      assessProbabilityComparability(
        descriptor("native_calibrated"),
        descriptor("native_calibrated", {
          evaluationContractId: "finance-question-set-v2",
        }),
      ),
    ).toMatchObject({
      decisionOutcomeMetrics: "not_comparable",
      probabilityCalibrationMetrics: "unavailable",
      reason: "evaluation_contract_mismatch",
    });
    expect(
      assessProbabilityComparability(
        descriptor("native_calibrated"),
        descriptor("native_calibrated", { populationId: "another-population" }),
      ).reason,
    ).toBe("population_mismatch");
    expect(
      assessProbabilityComparability(
        descriptor("native_calibrated"),
        descriptor("native_calibrated", { metricTarget: "another-target" }),
      ).reason,
    ).toBe("metric_target_mismatch");
  });

  it("rejects unsafe or ambiguous descriptors", () => {
    const valid = descriptor("native_calibrated");
    expect(() =>
      assessProbabilityComparability(
        new Proxy(valid, {}),
        descriptor("native_calibrated"),
      ),
    ).toThrow(/plain object/u);
    expect(() =>
      assessProbabilityComparability(
        { ...valid, authority: "trade" } as never,
        descriptor("native_calibrated"),
      ),
    ).toThrow(/required fields/u);
    expect(() =>
      assessProbabilityComparability(
        { ...valid, probabilitySemantics: "fabricated" } as never,
        descriptor("native_calibrated"),
      ),
    ).toThrow(/semantics are invalid/u);
    expect(() =>
      assessProbabilityComparability(
        { ...valid, populationId: 123 } as never,
        descriptor("native_calibrated"),
      ),
    ).toThrow(/populationId.*portable identifier/u);
    const accessor = descriptor("native_calibrated");
    Object.defineProperty(accessor, "metricTarget", {
      enumerable: true,
      get: () => "atomic_gold_finance_route",
    });
    expect(() =>
      assessProbabilityComparability(accessor, descriptor("native_calibrated")),
    ).toThrow(/data fields/u);
  });
});

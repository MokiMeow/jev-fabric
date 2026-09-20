import { describe, expect, it } from "vitest";
import { pairedCategoricalRobustness } from "../src/robustness.js";

const pair = (
  pairId: string,
  family: "paraphrase" | "option_order",
  reference: Readonly<Record<string, number>>,
  referenceSelected: string,
  variant: Readonly<Record<string, number>>,
  variantSelected: string,
  gold?: string,
) => ({
  pairId,
  family,
  reference: { probabilities: reference, selected: referenceSelected },
  variant: { probabilities: variant, selected: variantSelected },
  ...(gold === undefined ? {} : { gold }),
});

describe("paired categorical robustness", () => {
  it("separates answer stability, probability movement, and labeled outcomes", () => {
    const result = pairedCategoricalRobustness([
      pair(
        "pair-1",
        "paraphrase",
        { observe: 0.8, investigate: 0.2 },
        "observe",
        { observe: 0.7, investigate: 0.3 },
        "observe",
        "observe",
      ),
      pair(
        "pair-2",
        "option_order",
        { observe: 0.6, investigate: 0.4 },
        "observe",
        { investigate: 0.7, observe: 0.3 },
        "investigate",
        "investigate",
      ),
    ]);

    expect(result).toMatchObject({
      pairCount: 2,
      labeledPairCount: 2,
      agreementCount: 1,
      flipCount: 1,
      regressionCount: 0,
      recoveryCount: 1,
      stableErrorCount: 0,
      labelAgreementRate: 0.5,
      flipRate: 0.5,
      referenceAccuracy: 0.5,
      variantAccuracy: 1,
      jointAccuracy: 0.5,
      regressionRate: 0,
      recoveryRate: 0.5,
      stableErrorRate: 0,
    });
    expect(result.meanTotalVariation).toBeCloseTo(0.2);
    expect(result.maxTotalVariation).toBeCloseTo(0.3);
  });

  it("keeps accuracy fields null when pairs have no independent gold labels", () => {
    expect(
      pairedCategoricalRobustness([
        pair(
          "pair-1",
          "paraphrase",
          { a: 0.5, b: 0.5 },
          "a",
          { b: 0.5, a: 0.5 },
          "b",
        ),
      ]),
    ).toMatchObject({
      pairCount: 1,
      labeledPairCount: 0,
      labelAgreementRate: 0,
      flipRate: 1,
      referenceAccuracy: null,
      variantAccuracy: null,
      jointAccuracy: null,
      regressionRate: null,
      recoveryRate: null,
      stableErrorRate: null,
      meanTotalVariation: 0,
      maxTotalVariation: 0,
    });
  });

  it("returns explicit empty evidence instead of fabricated zero rates", () => {
    expect(pairedCategoricalRobustness([])).toEqual({
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
    });
  });

  it("rejects duplicate pairs, malformed distributions, and incomparable variants", () => {
    const valid = pair(
      "pair-1",
      "paraphrase",
      { a: 0.8, b: 0.2 },
      "a",
      { a: 0.7, b: 0.3 },
      "a",
      "a",
    );
    expect(() => pairedCategoricalRobustness([valid, valid])).toThrow(
      /duplicate pair id/u,
    );
    expect(() =>
      pairedCategoricalRobustness([{ ...valid, pairId: 123 } as never]),
    ).toThrow(/pair id.*identifier/u);
    expect(() =>
      pairedCategoricalRobustness([{ ...valid, pairId: undefined } as never]),
    ).toThrow(/pair id.*identifier/u);
    expect(() => pairedCategoricalRobustness(new Proxy([valid], {}))).toThrow(
      /plain array/u,
    );
    const extraArrayProperty = [valid];
    Object.defineProperty(extraArrayProperty, "authority", {
      enumerable: true,
      value: "execute",
    });
    expect(() => pairedCategoricalRobustness(extraArrayProperty)).toThrow(
      /extra properties/u,
    );
    expect(() =>
      pairedCategoricalRobustness([
        pair(
          "bad-sum",
          "paraphrase",
          { a: 0.9, b: 0.2 },
          "a",
          { a: 0.7, b: 0.3 },
          "a",
          "a",
        ),
      ]),
    ).toThrow(/sum to 1/u);
    expect(() =>
      pairedCategoricalRobustness([
        pair(
          "wrong-top",
          "paraphrase",
          { a: 0.8, b: 0.2 },
          "b",
          { a: 0.7, b: 0.3 },
          "a",
          "a",
        ),
      ]),
    ).toThrow(/selected.*maximum/u);
    expect(() =>
      pairedCategoricalRobustness([
        pair(
          "label-drift",
          "option_order",
          { a: 0.8, b: 0.2 },
          "a",
          { a: 0.7, c: 0.3 },
          "a",
          "a",
        ),
      ]),
    ).toThrow(/same labels/u);
    expect(() =>
      pairedCategoricalRobustness([
        pair(
          "gold-drift",
          "paraphrase",
          { a: 0.8, b: 0.2 },
          "a",
          { a: 0.7, b: 0.3 },
          "a",
          "missing",
        ),
      ]),
    ).toThrow(/gold.*label/u);
    expect(() =>
      pairedCategoricalRobustness([
        { ...valid, authority: "execute" } as never,
      ]),
    ).toThrow(/unknown or unsafe field/u);
    expect(() =>
      pairedCategoricalRobustness([
        {
          pairId: "missing-variant",
          family: "paraphrase",
          reference: valid.reference,
        } as never,
      ]),
    ).toThrow(/missing a required field/u);
    const accessor = pair(
      "accessor",
      "paraphrase",
      { a: 0.8, b: 0.2 },
      "a",
      { a: 0.7, b: 0.3 },
      "a",
      "a",
    );
    Object.defineProperty(accessor.reference, "selected", {
      enumerable: true,
      get: () => "a",
    });
    expect(() => pairedCategoricalRobustness([accessor])).toThrow(
      /data properties/u,
    );
  });
});

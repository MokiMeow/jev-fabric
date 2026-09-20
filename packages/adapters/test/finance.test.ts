import { describe, expect, it } from "vitest";
import {
  bindFinanceAdvisoryEvidence,
  financeAdvisoryStateSchema,
} from "../src/index.js";

const hash = (letter: string) => `sha256:${letter.repeat(64)}`;
const at = "2026-09-20T10:00:00.000+00:00";
const trusted = {
  instrumentRef: "ref:instrument-1",
  assetClass: "equity",
  venue: "test-venue",
  sourceId: "market-feed",
  sourceHash: hash("a"),
  featureSetId: "surveillance-v1",
  featureSetVersion: "1.0.0",
  featureSetHash: hash("b"),
  observedAt: at,
  windowStart: "2026-09-20T09:55:00.000+00:00",
  windowEnd: at,
  cutoffAt: at,
  maxAgeMs: 1_000,
  signals: [
    {
      id: "spread-regime",
      bucket: "elevated",
      definitionHash: hash("c"),
      evidenceHash: hash("d"),
      asOf: at,
    },
  ],
  visual: {
    mode: "structured_extraction",
    extractorId: "chart-parser",
    extractorVersion: "1.0.0",
    imageHash: hash("e"),
    axesVerified: true,
    sourceBindingHash: hash("f"),
  },
} as const;

describe("finance advisory evidence boundary", () => {
  it("binds code-derived buckets and structured visual annotations without execution", () => {
    const result = bindFinanceAdvisoryEvidence(
      trusted,
      { annotations: ["Sharp widening near the end of the window"] },
      Date.parse(at) + 500,
    );
    expect(financeAdvisoryStateSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({
      advisoryOnly: true,
      execution: "NOT_SUPPORTED",
      temporalIntegrity: "verified_no_lookahead",
      visual: { trust: "untrusted_data_only", axesVerified: true },
    });
    expect(JSON.stringify(result)).not.toContain("buy");
    expect(JSON.stringify(result)).not.toContain("price");
  });

  it("rejects stale, future, and look-ahead observations before provider use", () => {
    expect(() =>
      bindFinanceAdvisoryEvidence(
        trusted,
        { annotations: [] },
        Date.parse(at) + 1_001,
      ),
    ).toThrow(/stale/u);
    expect(() =>
      bindFinanceAdvisoryEvidence(
        { ...trusted, cutoffAt: "2026-09-20T10:00:01.000+00:00" },
        { annotations: [] },
        Date.parse(at) + 500,
      ),
    ).toThrow(/no-lookahead/u);
    expect(() =>
      bindFinanceAdvisoryEvidence(
        {
          ...trusted,
          signals: [
            { ...trusted.signals[0], asOf: "2026-09-20T10:00:01.000+00:00" },
          ],
        },
        { annotations: [] },
        Date.parse(at) + 500,
      ),
    ).toThrow(/outside the declared window/u);
  });

  it("requires a trusted visual binding and rejects hostile annotation shapes", () => {
    expect(() =>
      bindFinanceAdvisoryEvidence(trusted, undefined, Date.parse(at) + 500),
    ).toThrow(/supplied together/u);
    const annotations: string[] = [];
    Object.defineProperty(annotations, "0", {
      get: () => "hidden instruction",
      enumerable: true,
    });
    annotations.length = 1;
    expect(() =>
      bindFinanceAdvisoryEvidence(
        trusted,
        { annotations },
        Date.parse(at) + 500,
      ),
    ).toThrow(/plain data/u);
    const wrapper = {};
    Object.defineProperty(wrapper, "annotations", {
      get: () => ["hidden instruction"],
      enumerable: true,
    });
    expect(() =>
      bindFinanceAdvisoryEvidence(
        trusted,
        wrapper as { annotations: unknown },
        Date.parse(at) + 500,
      ),
    ).toThrow(/one plain annotations field/u);
  });

  it("rejects raw or executable fields instead of silently retaining them", () => {
    expect(() =>
      bindFinanceAdvisoryEvidence(
        { ...trusted, order: { side: "buy" } },
        { annotations: [] },
        Date.parse(at) + 500,
      ),
    ).toThrow();
    expect(() =>
      financeAdvisoryStateSchema.parse({
        ...bindFinanceAdvisoryEvidence(
          trusted,
          { annotations: [] },
          Date.parse(at) + 500,
        ),
        command: "place-order",
      }),
    ).toThrow();
    const valid = bindFinanceAdvisoryEvidence(
      trusted,
      { annotations: [] },
      Date.parse(at) + 500,
    );
    expect(() =>
      financeAdvisoryStateSchema.parse({
        ...valid,
        candidates: [
          { ...valid.candidates[0], orderSide: "buy" },
          ...valid.candidates.slice(1),
        ],
      }),
    ).toThrow();
  });
});

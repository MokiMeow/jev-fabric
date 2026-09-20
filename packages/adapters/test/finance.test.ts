import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  bindFinanceAdvisoryEvidence,
  bindFinanceAdvisoryEvidenceWithText,
  FinanceAdvisoryBoundaryError,
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

const trustedWithText = {
  ...trusted,
  text: {
    mode: "bounded_excerpts",
    extractorId: "filing-text-extractor",
    extractorVersion: "2.1.0",
    documentHash: hash("1"),
    sourceBindingHash: hash("2"),
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

  it("binds bounded text excerpts alongside visual evidence", () => {
    const excerpts = [
      "Revenue increased by 8% year over year.",
      "Management retained its previously published outlook.",
    ];
    const result = bindFinanceAdvisoryEvidenceWithText(
      trustedWithText,
      { annotations: ["Volume rose near the window close"] },
      { excerpts },
      Date.parse(at) + 500,
    );
    const excerptHash = `sha256:${createHash("sha256")
      .update(JSON.stringify(excerpts))
      .digest("hex")}`;

    expect(financeAdvisoryStateSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({
      visual: { trust: "untrusted_data_only" },
      text: {
        mode: "bounded_excerpts",
        extractorId: "filing-text-extractor",
        extractorVersion: "2.1.0",
        documentHash: hash("1"),
        sourceBindingHash: hash("2"),
        excerptHash,
        excerpts,
        trust: "untrusted_data_only",
      },
    });
    expect(JSON.stringify(result.text)).not.toMatch(/authority|orderSide/u);
  });

  it("requires trusted text metadata and untrusted excerpts together", () => {
    expect(() =>
      bindFinanceAdvisoryEvidence(
        trustedWithText,
        { annotations: [] },
        Date.parse(at) + 500,
      ),
    ).toThrow(/supplied together/u);
    expect(() =>
      bindFinanceAdvisoryEvidenceWithText(
        trusted,
        { annotations: [] },
        { excerpts: [] },
        Date.parse(at) + 500,
      ),
    ).toThrow(/supplied together/u);
  });

  it("rejects hostile text evidence objects, arrays, symbols, and extra fields", () => {
    const getterWrapper = {};
    Object.defineProperty(getterWrapper, "excerpts", {
      get: () => ["hidden instruction"],
      enumerable: true,
    });
    const getterArray: string[] = [];
    Object.defineProperty(getterArray, "0", {
      get: () => "hidden instruction",
      enumerable: true,
    });
    getterArray.length = 1;
    const symbolArray = ["bounded evidence"];
    Object.defineProperty(symbolArray, Symbol("hidden"), { value: true });

    for (const text of [
      getterWrapper,
      { excerpts: getterArray },
      { excerpts: symbolArray },
      { excerpts: [], extra: "not allowed" },
      new Proxy({ excerpts: [] }, {}),
      { excerpts: new Proxy([], {}) },
    ]) {
      expect(() =>
        bindFinanceAdvisoryEvidenceWithText(
          trustedWithText,
          { annotations: [] },
          text as { excerpts: unknown },
          Date.parse(at) + 500,
        ),
      ).toThrow();
    }
  });

  it("rejects sparse, excessive, control-bearing, and oversized excerpts", () => {
    const sparse = new Array<string>(1);
    for (const excerpts of [
      sparse,
      Array.from({ length: 17 }, () => "bounded"),
      ["line one\nline two"],
      ["x".repeat(1_001)],
      Array.from({ length: 16 }, () => "é".repeat(600)),
    ]) {
      expect(() =>
        bindFinanceAdvisoryEvidenceWithText(
          trustedWithText,
          { annotations: [] },
          { excerpts },
          Date.parse(at) + 500,
        ),
      ).toThrow();
    }
  });

  it("rejects order and execution fields at both text trust boundaries", () => {
    expect(() =>
      bindFinanceAdvisoryEvidenceWithText(
        {
          ...trustedWithText,
          text: { ...trustedWithText.text, execution: "place-order" },
        },
        { annotations: [] },
        { excerpts: [] },
        Date.parse(at) + 500,
      ),
    ).toThrow();
    expect(() =>
      bindFinanceAdvisoryEvidenceWithText(
        trustedWithText,
        { annotations: [] },
        { excerpts: [], order: { side: "buy" } } as {
          excerpts: unknown;
        },
        Date.parse(at) + 500,
      ),
    ).toThrow();
  });

  it("classifies semantic boundary failures without parsing messages", () => {
    try {
      bindFinanceAdvisoryEvidence(
        { ...trusted, cutoffAt: "2026-09-20T10:00:01.000+00:00" },
        { annotations: [] },
        Date.parse(at) + 500,
      );
      throw new Error("expected boundary rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(FinanceAdvisoryBoundaryError);
      expect(error).toMatchObject({ code: "NO_LOOKAHEAD_ORDER" });
    }

    try {
      bindFinanceAdvisoryEvidenceWithText(
        trustedWithText,
        { annotations: [] },
        { excerpts: ["invalid\u0000text"] },
        Date.parse(at) + 500,
      );
      throw new Error("expected evidence rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(FinanceAdvisoryBoundaryError);
      expect(error).toMatchObject({ code: "EVIDENCE_BINDING" });
      expect((error as Error).cause).toBeDefined();
    }
  });
});

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  bindFinanceAdvisoryEvidence,
  bindFinanceAdvisoryEvidenceWithText,
  computeFinanceProjectionBindingHash,
  FinanceAdvisoryBoundaryError,
  financeAdvisoryStateSchema,
} from "../src/index.js";

const hash = (letter: string) => `sha256:${letter.repeat(64)}`;
const sha256 = (value: string) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const visualRenderer = {
  id: "finance.canonical-svg",
  version: "1",
  schemaVersion: "1",
  mutationPolicyId: "finance.visual-mutations.v1",
} as const;
const visualRendererV2 = {
  id: "finance.canonical-svg",
  version: "2",
  schemaVersion: "1",
  mutationPolicyId: "finance.visual-mutations.v2",
} as const;
const visualRendererV3 = {
  id: "finance.canonical-svg",
  version: "3",
  schemaVersion: "1",
  mutationPolicyId: "finance.visual-mutations.v3",
} as const;
const visualArtifactBindingHash = (
  imageHash: string,
  sourceBindingHash: string,
  renderer:
    | typeof visualRenderer
    | typeof visualRendererV2
    | typeof visualRendererV3 = visualRenderer,
  mutationId = "faithful_render",
  expectedRoute = "observe",
) =>
  sha256(
    JSON.stringify({
      expectedRoute,
      imageHash,
      mutationId,
      renderer: {
        id: renderer.id,
        mutationPolicyId: renderer.mutationPolicyId,
        schemaVersion: renderer.schemaVersion,
        version: renderer.version,
      },
      schemaVersion: "1",
      sourceBindingHash,
    }),
  );
const at = "2026-09-20T10:00:00.000+00:00";
const sealFinanceProjection = <T extends Record<string, unknown>>(input: T) => {
  const { projectionBindingHash: _ignored, ...projection } = input;
  return {
    ...projection,
    projectionBindingHash: computeFinanceProjectionBindingHash(projection),
  } as const;
};
const trustedProjection = {
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
    schemaVersion: "1",
    renderer: visualRenderer,
    mutationId: "faithful_render",
    expectedRoute: "observe",
    artifactBindingHash: visualArtifactBindingHash(hash("e"), hash("f")),
  },
} as const;
const trusted = sealFinanceProjection(trustedProjection);

const candidateExcerpts = [
  "Revenue increased by 8% year over year.",
  "Management retained its previously published outlook.",
] as const;
const trustedWithTextProjection = {
  ...trustedProjection,
  text: {
    mode: "bounded_excerpts",
    extractorId: "filing-text-extractor",
    extractorVersion: "2.1.0",
    documentHash: hash("1"),
    sourceBindingHash: hash("2"),
    candidateBindings: [
      { id: "reported-results", excerptHash: sha256(candidateExcerpts[0]) },
      { id: "management-outlook", excerptHash: sha256(candidateExcerpts[1]) },
    ],
  },
} as const;
const trustedWithText = sealFinanceProjection(trustedWithTextProjection);
const candidateClaims = [
  "Revenue increased year over year.",
  "Management retained its outlook.",
] as const;
const trustedWithClaimsProjection = {
  ...trustedProjection,
  text: {
    ...trustedWithTextProjection.text,
    candidateBindings: [
      {
        ...trustedWithTextProjection.text.candidateBindings[0],
        claimHash: sha256(candidateClaims[0]),
        sourceSpan: {
          byteStart: 0,
          byteEnd: Buffer.byteLength(candidateExcerpts[0]),
          sectionHash: hash("7"),
        },
      },
      {
        ...trustedWithTextProjection.text.candidateBindings[1],
        claimHash: sha256(candidateClaims[1]),
        sourceSpan: {
          byteStart: 100,
          byteEnd: 100 + Buffer.byteLength(candidateExcerpts[1]),
          sectionHash: hash("8"),
        },
      },
    ],
  },
} as const;
const trustedWithClaims = sealFinanceProjection(trustedWithClaimsProjection);

describe("finance advisory evidence boundary", () => {
  it("rejects instrument and signal-time substitutions against the projection seal", () => {
    const sealedTrusted = trusted;

    const result = bindFinanceAdvisoryEvidence(
      sealedTrusted,
      { annotations: ["Series remains inside the declared axis"] },
      Date.parse(at) + 500,
    );
    expect(result).not.toHaveProperty("projectionBindingHash");
    expect(JSON.stringify(result)).not.toContain(
      sealedTrusted.projectionBindingHash,
    );

    const { projectionBindingHash: _removed, ...unsealedTrusted } =
      sealedTrusted;
    for (const invalid of [
      unsealedTrusted,
      { ...unsealedTrusted, projectionBindingHash: "sha256:not-a-digest" },
    ])
      expect(() =>
        bindFinanceAdvisoryEvidence(
          invalid,
          { annotations: ["Series remains inside the declared axis"] },
          Date.parse(at) + 500,
        ),
      ).toThrowError(
        expect.objectContaining<Partial<FinanceAdvisoryBoundaryError>>({
          code: "INVALID_INPUT",
        }),
      );

    for (const substituted of [
      { ...sealedTrusted, instrumentRef: "ref:instrument-2" },
      {
        ...sealedTrusted,
        signals: [
          {
            ...sealedTrusted.signals[0],
            asOf: "2026-09-20T09:59:00.000+00:00",
          },
        ],
      },
    ])
      expect(() =>
        bindFinanceAdvisoryEvidence(
          substituted,
          { annotations: ["Series remains inside the declared axis"] },
          Date.parse(at) + 500,
        ),
      ).toThrowError(
        expect.objectContaining<Partial<FinanceAdvisoryBoundaryError>>({
          code: "EVIDENCE_BINDING",
        }),
      );
  });

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
      expiresAt: "2026-09-20T10:00:01.000Z",
      maxAgeMs: 1_000,
      temporalIntegrity: "verified_no_lookahead",
      visual: { trust: "untrusted_data_only", axesVerified: true },
    });
    expect(JSON.stringify(result)).not.toContain("buy");
    expect(JSON.stringify(result)).not.toContain("price");
  });

  it("keeps evaluator-owned visual targets out of provider-visible state", () => {
    const result = bindFinanceAdvisoryEvidence(
      trusted,
      { annotations: ["Series remains inside the declared axis"] },
      Date.parse(at) + 500,
    );

    expect(result.visual).toBeDefined();
    expect(result.visual).not.toHaveProperty("mutationId");
    expect(result.visual).not.toHaveProperty("expectedRoute");
    expect(result.visual).not.toHaveProperty("artifactBindingHash");
    expect(result.visual).not.toHaveProperty("imageHash");
    expect(JSON.stringify(result)).not.toContain("faithful_render");
  });

  it("accepts renderer v2 reversed-time evidence but rejects that mutation under v1", () => {
    const imageHash = hash("e");
    const sourceBindingHash = hash("f");
    const v2 = sealFinanceProjection({
      ...trustedProjection,
      visual: {
        ...trustedProjection.visual,
        imageHash,
        sourceBindingHash,
        renderer: visualRendererV2,
        mutationId: "reversed_time_axis",
        expectedRoute: "escalate",
        artifactBindingHash: visualArtifactBindingHash(
          imageHash,
          sourceBindingHash,
          visualRendererV2,
          "reversed_time_axis",
          "escalate",
        ),
      },
    });
    const result = bindFinanceAdvisoryEvidence(
      v2,
      { annotations: ["Chronology runs newest to oldest"] },
      Date.parse(at) + 500,
    );

    expect(result.visual?.renderer).toEqual(visualRendererV2);
    expect(result.visual).not.toHaveProperty("mutationId");
    expect(result.visual).not.toHaveProperty("expectedRoute");
    expect(() =>
      sealFinanceProjection({
        ...trustedProjection,
        visual: {
          ...trustedProjection.visual,
          renderer: visualRenderer,
          mutationId: "reversed_time_axis",
          expectedRoute: "escalate",
          artifactBindingHash: visualArtifactBindingHash(
            imageHash,
            sourceBindingHash,
            visualRenderer,
            "reversed_time_axis",
            "escalate",
          ),
        },
      }),
    ).toThrow(/not supported by renderer version 1/u);
  });

  it("accepts renderer v3 undisclosed-log evidence but rejects that mutation under v2", () => {
    const imageHash = hash("e");
    const sourceBindingHash = hash("f");
    const v3 = sealFinanceProjection({
      ...trustedProjection,
      visual: {
        ...trustedProjection.visual,
        imageHash,
        sourceBindingHash,
        renderer: visualRendererV3,
        mutationId: "undisclosed_log_scale",
        expectedRoute: "escalate",
        artifactBindingHash: visualArtifactBindingHash(
          imageHash,
          sourceBindingHash,
          visualRendererV3,
          "undisclosed_log_scale",
          "escalate",
        ),
      },
    });
    const result = bindFinanceAdvisoryEvidence(
      v3,
      { annotations: ["Displayed spacing is nonlinear but unlabeled"] },
      Date.parse(at) + 500,
    );

    expect(result.visual?.renderer).toEqual(visualRendererV3);
    expect(result.visual).not.toHaveProperty("mutationId");
    expect(result.visual).not.toHaveProperty("expectedRoute");
    expect(() =>
      sealFinanceProjection({
        ...trustedProjection,
        visual: {
          ...trustedProjection.visual,
          renderer: visualRendererV2,
          mutationId: "undisclosed_log_scale",
          expectedRoute: "escalate",
          artifactBindingHash: visualArtifactBindingHash(
            imageHash,
            sourceBindingHash,
            visualRendererV2,
            "undisclosed_log_scale",
            "escalate",
          ),
        },
      }),
    ).toThrow(/not supported by renderer version 2/u);
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
        sealFinanceProjection({
          ...trusted,
          cutoffAt: "2026-09-20T10:00:01.000+00:00",
        }),
        { annotations: [] },
        Date.parse(at) + 500,
      ),
    ).toThrow(/no-lookahead/u);
    expect(() =>
      bindFinanceAdvisoryEvidence(
        sealFinanceProjection({
          ...trusted,
          signals: [
            { ...trusted.signals[0], asOf: "2026-09-20T10:00:01.000+00:00" },
          ],
        }),
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
    expect(() =>
      bindFinanceAdvisoryEvidence(
        trusted,
        { annotations: ["safe\u202Etrade approved"] },
        Date.parse(at) + 500,
      ),
    ).toThrow();
    expect(() =>
      bindFinanceAdvisoryEvidence(
        {
          ...trusted,
          visual: { ...trusted.visual, artifactBindingHash: hash("9") },
        },
        { annotations: [] },
        Date.parse(at) + 500,
      ),
    ).toThrow(/artifact binding is invalid/u);
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
    const excerpts = [...candidateExcerpts];
    const result = bindFinanceAdvisoryEvidenceWithText(
      trustedWithText,
      { annotations: ["Volume rose near the window close"] },
      { excerpts },
      Date.parse(at) + 500,
    );
    const excerptHash = `sha256:${createHash("sha256")
      .update(JSON.stringify(excerpts))
      .digest("hex")}`;
    const candidateBindingHash = sha256(
      JSON.stringify(trustedWithText.text.candidateBindings),
    );

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
        candidateBindingHash,
        candidates: [
          {
            id: "reported-results",
            excerptHash: sha256(candidateExcerpts[0]),
            excerpt: candidateExcerpts[0],
          },
          {
            id: "management-outlook",
            excerptHash: sha256(candidateExcerpts[1]),
            excerpt: candidateExcerpts[1],
          },
        ],
        trust: "untrusted_data_only",
      },
    });
    expect(JSON.stringify(result.text)).not.toMatch(/authority|orderSide/u);
  });

  it("binds ordered proposed claims separately from their cited excerpts", () => {
    const result = bindFinanceAdvisoryEvidenceWithText(
      trustedWithClaims,
      { annotations: [] },
      { excerpts: [...candidateExcerpts], claims: [...candidateClaims] },
      Date.parse(at) + 500,
    );

    expect(financeAdvisoryStateSchema.parse(result)).toEqual(result);
    expect(result.text?.candidates).toEqual([
      {
        id: "reported-results",
        excerptHash: sha256(candidateExcerpts[0]),
        excerpt: candidateExcerpts[0],
        claimHash: sha256(candidateClaims[0]),
        claim: candidateClaims[0],
        sourceSpan: trustedWithClaims.text.candidateBindings[0].sourceSpan,
      },
      {
        id: "management-outlook",
        excerptHash: sha256(candidateExcerpts[1]),
        excerpt: candidateExcerpts[1],
        claimHash: sha256(candidateClaims[1]),
        claim: candidateClaims[1],
        sourceSpan: trustedWithClaims.text.candidateBindings[1].sourceSpan,
      },
    ]);
    expect(result.text?.trust).toBe("untrusted_data_only");
    expect(result.execution).toBe("NOT_SUPPORTED");

    const changedSpan = bindFinanceAdvisoryEvidenceWithText(
      sealFinanceProjection({
        ...trustedWithClaims,
        text: {
          ...trustedWithClaims.text,
          candidateBindings: [
            {
              ...trustedWithClaims.text.candidateBindings[0],
              sourceSpan: {
                ...trustedWithClaims.text.candidateBindings[0].sourceSpan,
                byteStart: 1,
              },
            },
            trustedWithClaims.text.candidateBindings[1],
          ],
        },
      }),
      { annotations: [] },
      { excerpts: [...candidateExcerpts], claims: [...candidateClaims] },
      Date.parse(at) + 500,
    );
    expect(changedSpan.text?.candidateBindingHash).not.toBe(
      result.text?.candidateBindingHash,
    );
  });

  it("requires all claim bindings and claim evidence in exact count, order, and hash", () => {
    expect(() =>
      bindFinanceAdvisoryEvidenceWithText(
        {
          ...trustedWithClaims,
          text: {
            ...trustedWithClaims.text,
            candidateBindings: [
              trustedWithClaims.text.candidateBindings[0],
              trustedWithText.text.candidateBindings[1],
            ],
          },
        },
        { annotations: [] },
        { excerpts: [...candidateExcerpts], claims: [...candidateClaims] },
        Date.parse(at) + 500,
      ),
    ).toThrow(/trusted projection is invalid/u);
    expect(() =>
      bindFinanceAdvisoryEvidenceWithText(
        trustedWithClaims,
        { annotations: [] },
        { excerpts: [...candidateExcerpts] },
        Date.parse(at) + 500,
      ),
    ).toThrow(/supplied together/u);
    expect(() =>
      bindFinanceAdvisoryEvidenceWithText(
        trustedWithText,
        { annotations: [] },
        { excerpts: [...candidateExcerpts], claims: [...candidateClaims] },
        Date.parse(at) + 500,
      ),
    ).toThrow(/supplied together/u);
    expect(() =>
      bindFinanceAdvisoryEvidenceWithText(
        trustedWithClaims,
        { annotations: [] },
        { excerpts: [...candidateExcerpts], claims: [candidateClaims[0]] },
        Date.parse(at) + 500,
      ),
    ).toThrow(/same length/u);
    expect(() =>
      bindFinanceAdvisoryEvidenceWithText(
        trustedWithClaims,
        { annotations: [] },
        {
          excerpts: [...candidateExcerpts],
          claims: [...candidateClaims].reverse(),
        },
        Date.parse(at) + 500,
      ),
    ).toThrow(/claim hash mismatch/u);
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

  it("requires exact candidate count, order, hashes, and unique portable ids", () => {
    expect(() =>
      bindFinanceAdvisoryEvidenceWithText(
        trustedWithText,
        { annotations: [] },
        { excerpts: [candidateExcerpts[0]] },
        Date.parse(at) + 500,
      ),
    ).toThrow(/same length/u);
    expect(() =>
      bindFinanceAdvisoryEvidenceWithText(
        trustedWithText,
        { annotations: [] },
        { excerpts: [...candidateExcerpts].reverse() },
        Date.parse(at) + 500,
      ),
    ).toThrow(/hash mismatch/u);
    expect(() =>
      bindFinanceAdvisoryEvidenceWithText(
        {
          ...trustedWithText,
          text: {
            ...trustedWithText.text,
            candidateBindings: [
              trustedWithText.text.candidateBindings[0],
              {
                ...trustedWithText.text.candidateBindings[1],
                excerptHash: hash("9"),
              },
            ],
          },
        },
        { annotations: [] },
        { excerpts: [...candidateExcerpts] },
        Date.parse(at) + 500,
      ),
    ).toThrow(/hash mismatch/u);
    expect(() =>
      bindFinanceAdvisoryEvidenceWithText(
        {
          ...trustedWithText,
          text: {
            ...trustedWithText.text,
            candidateBindings: trustedWithText.text.candidateBindings.map(
              (binding) => ({ ...binding, id: "duplicate" }),
            ),
          },
        },
        { annotations: [] },
        { excerpts: [...candidateExcerpts] },
        Date.parse(at) + 500,
      ),
    ).toThrow(FinanceAdvisoryBoundaryError);
    expect(() =>
      bindFinanceAdvisoryEvidenceWithText(
        {
          ...trustedWithText,
          text: {
            ...trustedWithText.text,
            candidateBindings: [
              {
                id: "not portable",
                excerptHash: sha256(candidateExcerpts[0]),
              },
            ],
          },
        },
        { annotations: [] },
        { excerpts: [candidateExcerpts[0]] },
        Date.parse(at) + 500,
      ),
    ).toThrow();

    const original = bindFinanceAdvisoryEvidenceWithText(
      trustedWithText,
      { annotations: [] },
      { excerpts: [...candidateExcerpts] },
      Date.parse(at) + 500,
    );
    const renamed = bindFinanceAdvisoryEvidenceWithText(
      sealFinanceProjection({
        ...trustedWithText,
        text: {
          ...trustedWithText.text,
          candidateBindings: trustedWithText.text.candidateBindings.map(
            (binding, index) => ({ ...binding, id: `renamed-${index}` }),
          ),
        },
      }),
      { annotations: [] },
      { excerpts: [...candidateExcerpts] },
      Date.parse(at) + 500,
    );
    const reordered = bindFinanceAdvisoryEvidenceWithText(
      sealFinanceProjection({
        ...trustedWithText,
        text: {
          ...trustedWithText.text,
          candidateBindings: [
            trustedWithText.text.candidateBindings[1],
            trustedWithText.text.candidateBindings[0],
          ],
        },
      }),
      { annotations: [] },
      { excerpts: [...candidateExcerpts].reverse() },
      Date.parse(at) + 500,
    );
    expect(renamed.text?.candidateBindingHash).not.toBe(
      original.text?.candidateBindingHash,
    );
    expect(reordered.text?.candidateBindingHash).not.toBe(
      original.text?.candidateBindingHash,
    );
  });

  it("rejects hostile trusted candidate binding shapes before property access", () => {
    const getterBinding = { excerptHash: sha256(candidateExcerpts[0]) };
    Object.defineProperty(getterBinding, "id", {
      get: () => "forged-id",
      enumerable: true,
    });
    const symbolBinding = {
      id: "symbol-binding",
      excerptHash: sha256(candidateExcerpts[0]),
      [Symbol("hidden")]: true,
    };
    const sparseBindings = new Array(1);
    const hostileBindings: unknown[] = [
      [getterBinding],
      [symbolBinding],
      [
        {
          id: "extra-field",
          excerptHash: sha256(candidateExcerpts[0]),
          authority: "approve",
        },
      ],
      sparseBindings,
      new Proxy(
        [
          {
            id: "proxied-array",
            excerptHash: sha256(candidateExcerpts[0]),
          },
        ],
        {},
      ),
      [
        new Proxy(
          {
            id: "proxied-binding",
            excerptHash: sha256(candidateExcerpts[0]),
          },
          {},
        ),
      ],
    ];

    for (const candidateBindings of hostileBindings) {
      expect(() =>
        bindFinanceAdvisoryEvidenceWithText(
          {
            ...trustedWithText,
            text: { ...trustedWithText.text, candidateBindings },
          },
          { annotations: [] },
          { excerpts: [candidateExcerpts[0]] },
          Date.parse(at) + 500,
        ),
      ).toThrow(FinanceAdvisoryBoundaryError);
    }

    const textWithGetter = { ...trustedWithText.text };
    Object.defineProperty(textWithGetter, "candidateBindings", {
      get: () => trustedWithText.text.candidateBindings,
      enumerable: true,
    });
    expect(() =>
      bindFinanceAdvisoryEvidenceWithText(
        { ...trustedWithText, text: textWithGetter },
        { annotations: [] },
        { excerpts: [...candidateExcerpts] },
        Date.parse(at) + 500,
      ),
    ).toThrow(/plain data/u);

    let trapCalls = 0;
    const rootProxy = new Proxy(trustedWithText, {
      get: () => {
        trapCalls += 1;
        return undefined;
      },
      ownKeys: () => {
        trapCalls += 1;
        return [];
      },
      getOwnPropertyDescriptor: () => {
        trapCalls += 1;
        return undefined;
      },
    });
    expect(() =>
      bindFinanceAdvisoryEvidenceWithText(
        rootProxy,
        { annotations: [] },
        { excerpts: [...candidateExcerpts] },
        Date.parse(at) + 500,
      ),
    ).toThrow(/must not be a proxy/u);
    expect(trapCalls).toBe(0);
  });

  it("snapshots the complete trusted projection without invoking caller code", () => {
    let getterHits = 0;
    const signalWithGetter = { ...trustedWithText.signals[0] };
    Object.defineProperty(signalWithGetter, "bucket", {
      get: () => {
        getterHits += 1;
        return "extreme";
      },
      enumerable: true,
    });
    expect(() =>
      bindFinanceAdvisoryEvidenceWithText(
        { ...trustedWithText, signals: [signalWithGetter] },
        { annotations: [] },
        { excerpts: [...candidateExcerpts] },
        Date.parse(at) + 500,
      ),
    ).toThrow(/plain data/u);
    expect(getterHits).toBe(0);

    let nestedTrapCalls = 0;
    const proxiedVisual = new Proxy(trustedWithText.visual, {
      get: () => {
        nestedTrapCalls += 1;
        return undefined;
      },
      ownKeys: () => {
        nestedTrapCalls += 1;
        return [];
      },
    });
    expect(() =>
      bindFinanceAdvisoryEvidenceWithText(
        { ...trustedWithText, visual: proxiedVisual },
        { annotations: [] },
        { excerpts: [...candidateExcerpts] },
        Date.parse(at) + 500,
      ),
    ).toThrow(/must not be a proxy/u);
    expect(nestedTrapCalls).toBe(0);

    const symbolSignal = {
      ...trustedWithText.signals[0],
      [Symbol("hidden")]: "approve",
    };
    expect(() =>
      bindFinanceAdvisoryEvidenceWithText(
        { ...trustedWithText, signals: [symbolSignal] },
        { annotations: [] },
        { excerpts: [...candidateExcerpts] },
        Date.parse(at) + 500,
      ),
    ).toThrow(/must not contain symbols/u);

    const cyclic: Record<string, unknown> = { ...trustedWithText };
    cyclic.self = cyclic;
    expect(() =>
      bindFinanceAdvisoryEvidenceWithText(
        cyclic,
        { annotations: [] },
        { excerpts: [...candidateExcerpts] },
        Date.parse(at) + 500,
      ),
    ).toThrow(/must not contain cycles/u);
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

    const claimGetter: string[] = [];
    Object.defineProperty(claimGetter, "0", {
      get: () => "forged claim",
      enumerable: true,
    });
    claimGetter.length = 1;
    for (const claims of [
      claimGetter,
      new Proxy([...candidateClaims], {}),
      ["line one\nline two", candidateClaims[1]],
      ["x".repeat(1_001), candidateClaims[1]],
      Array.from({ length: 8 }, () => "€".repeat(400)),
    ]) {
      expect(() =>
        bindFinanceAdvisoryEvidenceWithText(
          trustedWithClaims,
          { annotations: [] },
          { excerpts: [...candidateExcerpts], claims },
          Date.parse(at) + 500,
        ),
      ).toThrow();
    }
  });

  it("requires and validates trusted claim source spans without treating them as proof", () => {
    const { sourceSpan: _omittedSourceSpan, ...claimWithoutSourceSpan } =
      trustedWithClaims.text.candidateBindings[0];
    expect(() =>
      bindFinanceAdvisoryEvidenceWithText(
        {
          ...trustedWithClaims,
          text: {
            ...trustedWithClaims.text,
            candidateBindings: [
              claimWithoutSourceSpan,
              trustedWithClaims.text.candidateBindings[1],
            ],
          },
        },
        { annotations: [] },
        { excerpts: [...candidateExcerpts], claims: [...candidateClaims] },
        Date.parse(at) + 500,
      ),
    ).toThrow(/trusted projection is invalid/u);

    for (const sourceSpan of [
      { byteStart: -1, byteEnd: 10, sectionHash: hash("7") },
      { byteStart: 10, byteEnd: 10, sectionHash: hash("7") },
      { byteStart: 10, byteEnd: 9, sectionHash: hash("7") },
      { byteStart: 0, byteEnd: 10, sectionHash: "not-a-hash" },
    ]) {
      expect(() =>
        bindFinanceAdvisoryEvidenceWithText(
          {
            ...trustedWithClaims,
            text: {
              ...trustedWithClaims.text,
              candidateBindings: [
                {
                  ...trustedWithClaims.text.candidateBindings[0],
                  sourceSpan,
                },
                trustedWithClaims.text.candidateBindings[1],
              ],
            },
          },
          { annotations: [] },
          { excerpts: [...candidateExcerpts], claims: [...candidateClaims] },
          Date.parse(at) + 500,
        ),
      ).toThrow(FinanceAdvisoryBoundaryError);
    }
    expect(() =>
      bindFinanceAdvisoryEvidenceWithText(
        {
          ...trustedWithText,
          text: {
            ...trustedWithText.text,
            candidateBindings: [
              {
                ...trustedWithText.text.candidateBindings[0],
                sourceSpan:
                  trustedWithClaims.text.candidateBindings[0].sourceSpan,
              },
              trustedWithText.text.candidateBindings[1],
            ],
          },
        },
        { annotations: [] },
        { excerpts: [...candidateExcerpts] },
        Date.parse(at) + 500,
      ),
    ).toThrow(/trusted projection is invalid/u);
  });

  it("rejects sparse, excessive, control-bearing, and oversized excerpts", () => {
    const sparse = new Array<string>(1);
    for (const excerpts of [
      sparse,
      Array.from({ length: 9 }, () => "bounded"),
      ["line one\nline two"],
      ["safe\u202Etrade approved"],
      ["unsafe\u0085separator"],
      ["x".repeat(1_001)],
      Array.from({ length: 8 }, () => "€".repeat(800)),
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
        sealFinanceProjection({
          ...trusted,
          cutoffAt: "2026-09-20T10:00:01.000+00:00",
        }),
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

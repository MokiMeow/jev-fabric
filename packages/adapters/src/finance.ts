import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";
import { z } from "zod";

export const FINANCE_ADVISORY_CONTRACT_VERSION = "1" as const;

export type FinanceAdvisoryBoundaryErrorCode =
  | "NO_LOOKAHEAD_ORDER"
  | "STALE_OBSERVATION"
  | "SIGNAL_OUTSIDE_WINDOW"
  | "EVIDENCE_BINDING"
  | "INVALID_INPUT";

export class FinanceAdvisoryBoundaryError extends TypeError {
  readonly code: FinanceAdvisoryBoundaryErrorCode;

  constructor(
    code: FinanceAdvisoryBoundaryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "FinanceAdvisoryBoundaryError";
    this.code = code;
  }
}

const hashSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/u, "must be a SHA-256 hash");
const identifierSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u, "must be a portable identifier");
const referenceSchema = z
  .string()
  .regex(
    /^ref:[A-Za-z][A-Za-z0-9._:-]{0,127}$/u,
    "must be an opaque reference",
  );
const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      codePoint === undefined ||
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    );
  });
const oneLineSchema = z
  .string()
  .min(1)
  .max(240)
  .refine((value) => !hasControlCharacter(value), "must be one line");
const textExcerptSchema = z
  .string()
  .min(1)
  .max(1_000)
  .refine(
    (value) => !hasControlCharacter(value),
    "must not contain control characters",
  );
const textClaimSchema = z
  .string()
  .min(1)
  .max(1_000)
  .refine(
    (value) => !hasControlCharacter(value),
    "must not contain control characters",
  );

const MAX_TEXT_EXCERPTS = 8;
const MAX_TEXT_EXCERPT_BYTES = 16_384;
const MAX_TEXT_CLAIM_BYTES = 8_192;
const textCandidateIdSchema = z
  .string()
  .regex(
    /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/u,
    "must be a portable candidate identifier",
  );
const trustedTextSourceSpanSchema = z
  .object({
    byteStart: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    byteEnd: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    sectionHash: hashSchema,
  })
  .strict()
  .refine((value) => value.byteStart < value.byteEnd, {
    message: "source span byteStart must be less than byteEnd",
  });
const trustedTextCandidateBindingSchema = z
  .object({
    id: textCandidateIdSchema,
    excerptHash: hashSchema,
    claimHash: hashSchema.optional(),
    sourceSpan: trustedTextSourceSpanSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.sourceSpan === undefined) !== (value.claimHash === undefined))
      context.addIssue({
        code: "custom",
        message: "bound claim and source span must be supplied together",
        path: ["sourceSpan"],
      });
  });

export const marketAssetClassSchema = z.enum([
  "equity",
  "etf",
  "future",
  "option",
  "fx",
  "fixed_income",
  "fund",
  "crypto",
  "other",
]);
export type MarketAssetClass = z.infer<typeof marketAssetClassSchema>;

export const marketSignalBucketSchema = z.enum([
  "low",
  "normal",
  "elevated",
  "extreme",
  "unknown",
]);
export type MarketSignalBucket = z.infer<typeof marketSignalBucketSchema>;

export const financeVisualMutationSchema = z.enum([
  "faithful_render",
  "missing_source_date",
  "missing_units",
  "swapped_series_legend",
  "truncated_zero_baseline",
]);
export type FinanceVisualMutation = z.infer<typeof financeVisualMutationSchema>;
export const financeVisualRouteSchema = z.enum([
  "observe",
  "investigate",
  "escalate",
]);
const financeVisualMutationRoutes = {
  faithful_render: "observe",
  missing_source_date: "investigate",
  missing_units: "investigate",
  swapped_series_legend: "escalate",
  truncated_zero_baseline: "escalate",
} as const satisfies Record<FinanceVisualMutation, string>;
const financeVisualRendererSchema = z
  .object({
    id: z.literal("finance.canonical-svg"),
    version: z.literal("1"),
    schemaVersion: z.literal("1"),
    mutationPolicyId: z.literal("finance.visual-mutations.v1"),
  })
  .strict();

export const trustedMarketSignalSchema = z
  .object({
    id: identifierSchema,
    bucket: marketSignalBucketSchema,
    definitionHash: hashSchema,
    evidenceHash: hashSchema,
    asOf: z.string().datetime({ offset: true }),
  })
  .strict();
export type TrustedMarketSignal = z.infer<typeof trustedMarketSignalSchema>;

export const trustedFinanceProjectionSchema = z
  .object({
    instrumentRef: referenceSchema,
    assetClass: marketAssetClassSchema,
    venue: identifierSchema,
    sourceId: identifierSchema,
    sourceHash: hashSchema,
    featureSetId: identifierSchema,
    featureSetVersion: z.string().min(1).max(128),
    featureSetHash: hashSchema,
    observedAt: z.string().datetime({ offset: true }),
    windowStart: z.string().datetime({ offset: true }),
    windowEnd: z.string().datetime({ offset: true }),
    cutoffAt: z.string().datetime({ offset: true }),
    maxAgeMs: z.number().int().positive().max(86_400_000),
    signals: z.array(trustedMarketSignalSchema).min(1).max(64),
    visual: z
      .object({
        mode: z.literal("structured_extraction"),
        extractorId: identifierSchema,
        extractorVersion: z.string().min(1).max(128),
        imageHash: hashSchema,
        axesVerified: z.literal(true),
        sourceBindingHash: hashSchema,
        schemaVersion: z.literal("1"),
        renderer: financeVisualRendererSchema,
        mutationId: financeVisualMutationSchema,
        expectedRoute: financeVisualRouteSchema,
        artifactBindingHash: hashSchema,
      })
      .strict()
      .optional(),
    text: z
      .object({
        mode: z.literal("bounded_excerpts"),
        extractorId: identifierSchema,
        extractorVersion: z.string().min(1).max(128),
        documentHash: hashSchema,
        sourceBindingHash: hashSchema,
        candidateBindings: z
          .array(trustedTextCandidateBindingSchema)
          .min(1)
          .max(MAX_TEXT_EXCERPTS),
      })
      .strict()
      .superRefine((value, context) => {
        const ids = value.candidateBindings.map((candidate) => candidate.id);
        if (new Set(ids).size !== ids.length)
          context.addIssue({
            code: "custom",
            message: "candidate binding ids must be unique",
            path: ["candidateBindings"],
          });
        const claimBindings = value.candidateBindings.filter(
          (candidate) => candidate.claimHash !== undefined,
        );
        if (
          claimBindings.length !== 0 &&
          claimBindings.length !== value.candidateBindings.length
        )
          context.addIssue({
            code: "custom",
            message:
              "candidate claim bindings must be supplied for all or none",
            path: ["candidateBindings"],
          });
      })
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const signalIds = value.signals.map((signal) => signal.id);
    if (new Set(signalIds).size !== signalIds.length)
      context.addIssue({
        code: "custom",
        message: "signal ids must be unique",
        path: ["signals"],
      });
  });
export type TrustedFinanceProjection = z.infer<
  typeof trustedFinanceProjectionSchema
>;

export interface UntrustedVisualFinanceEvidence {
  readonly annotations: unknown;
}

export interface UntrustedTextFinanceEvidence {
  readonly excerpts: unknown;
  readonly claims?: unknown;
}

export const financeAdvisoryStateSchema = z
  .object({
    contractVersion: z.literal(FINANCE_ADVISORY_CONTRACT_VERSION),
    advisoryOnly: z.literal(true),
    execution: z.literal("NOT_SUPPORTED"),
    instrumentRef: referenceSchema,
    assetClass: marketAssetClassSchema,
    venue: identifierSchema,
    sourceId: identifierSchema,
    sourceHash: hashSchema,
    featureSetId: identifierSchema,
    featureSetVersion: z.string().min(1).max(128),
    featureSetHash: hashSchema,
    observedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    maxAgeMs: z.number().int().positive().max(86_400_000),
    cutoffAt: z.string().datetime({ offset: true }),
    windowStart: z.string().datetime({ offset: true }),
    windowEnd: z.string().datetime({ offset: true }),
    temporalIntegrity: z.literal("verified_no_lookahead"),
    signals: z.array(trustedMarketSignalSchema).min(1).max(64),
    visual: z
      .object({
        mode: z.literal("structured_extraction"),
        extractorId: identifierSchema,
        extractorVersion: z.string().min(1).max(128),
        imageHash: hashSchema,
        axesVerified: z.literal(true),
        sourceBindingHash: hashSchema,
        schemaVersion: z.literal("1"),
        renderer: financeVisualRendererSchema,
        mutationId: financeVisualMutationSchema,
        expectedRoute: financeVisualRouteSchema,
        artifactBindingHash: hashSchema,
        annotationHash: hashSchema,
        annotations: z.array(oneLineSchema).max(32),
        trust: z.literal("untrusted_data_only"),
      })
      .strict()
      .optional(),
    text: z
      .object({
        mode: z.literal("bounded_excerpts"),
        extractorId: identifierSchema,
        extractorVersion: z.string().min(1).max(128),
        documentHash: hashSchema,
        sourceBindingHash: hashSchema,
        excerptHash: hashSchema,
        candidateBindingHash: hashSchema,
        candidates: z
          .array(
            z
              .object({
                id: textCandidateIdSchema,
                excerptHash: hashSchema,
                excerpt: textExcerptSchema,
                claimHash: hashSchema.optional(),
                claim: textClaimSchema.optional(),
                sourceSpan: trustedTextSourceSpanSchema.optional(),
              })
              .strict()
              .superRefine((candidate, context) => {
                if (
                  (candidate.claimHash === undefined) !==
                  (candidate.claim === undefined)
                )
                  context.addIssue({
                    code: "custom",
                    message:
                      "candidate claim and claim hash must be supplied together",
                  });
                if (
                  (candidate.sourceSpan === undefined) !==
                  (candidate.claimHash === undefined)
                )
                  context.addIssue({
                    code: "custom",
                    message:
                      "candidate bound claim and source span must be supplied together",
                    path: ["sourceSpan"],
                  });
              }),
          )
          .min(1)
          .max(MAX_TEXT_EXCERPTS),
        trust: z.literal("untrusted_data_only"),
      })
      .strict()
      .superRefine((value, context) => {
        const ids = value.candidates.map((candidate) => candidate.id);
        if (new Set(ids).size !== ids.length)
          context.addIssue({
            code: "custom",
            message: "candidate ids must be unique",
            path: ["candidates"],
          });
        const claimCandidates = value.candidates.filter(
          (candidate) => candidate.claim !== undefined,
        );
        if (
          claimCandidates.length !== 0 &&
          claimCandidates.length !== value.candidates.length
        )
          context.addIssue({
            code: "custom",
            message: "candidate claims must be supplied for all or none",
            path: ["candidates"],
          });
        const totalBytes = value.candidates.reduce(
          (total, candidate) =>
            total + Buffer.byteLength(candidate.excerpt, "utf8"),
          0,
        );
        if (totalBytes > MAX_TEXT_EXCERPT_BYTES)
          context.addIssue({
            code: "custom",
            message: "excerpts exceed the total byte limit",
            path: ["candidates"],
          });
        const totalClaimBytes = value.candidates.reduce(
          (total, candidate) =>
            total +
            (candidate.claim === undefined
              ? 0
              : Buffer.byteLength(candidate.claim, "utf8")),
          0,
        );
        if (totalClaimBytes > MAX_TEXT_CLAIM_BYTES)
          context.addIssue({
            code: "custom",
            message: "claims exceed the total byte limit",
            path: ["candidates"],
          });
      })
      .optional(),
    candidates: z
      .tuple([
        z
          .object({
            id: z.literal("observe"),
            description: z.literal("Record the advisory observation only"),
            available: z.literal(true),
            freshness: z.literal("current"),
          })
          .strict(),
        z
          .object({
            id: z.literal("investigate"),
            description: z.literal("Route to bounded analyst investigation"),
            available: z.literal(true),
            freshness: z.literal("current"),
          })
          .strict(),
        z
          .object({
            id: z.literal("escalate"),
            description: z.literal("Escalate to an authorized human reviewer"),
            available: z.literal(true),
            freshness: z.literal("current"),
          })
          .strict(),
      ])
      .readonly(),
  })
  .strict();
export type FinanceAdvisoryState = z.infer<typeof financeAdvisoryStateSchema>;

const candidates = [
  {
    id: "observe",
    description: "Record the advisory observation only",
    available: true,
    freshness: "current",
  },
  {
    id: "investigate",
    description: "Route to bounded analyst investigation",
    available: true,
    freshness: "current",
  },
  {
    id: "escalate",
    description: "Escalate to an authorized human reviewer",
    available: true,
    freshness: "current",
  },
] as const;

/**
 * Binds trusted, code-derived market buckets to bounded visual annotations.
 * Raw prices, account data, orders, trade instructions, and image bytes are
 * deliberately absent. Dates and arithmetic are checked in code, never by Jev.
 */
export function bindFinanceAdvisoryEvidence(
  trustedInput: unknown,
  untrustedVisualInput: UntrustedVisualFinanceEvidence | undefined,
  nowEpochMs: number,
): FinanceAdvisoryState {
  return bindFinanceAdvisoryEvidenceWithText(
    trustedInput,
    untrustedVisualInput,
    undefined,
    nowEpochMs,
  );
}

/**
 * Binds trusted market metadata to independently bounded visual and text
 * evidence. Extracted text remains advisory, untrusted data and cannot add
 * candidates, authority, or execution fields to the resulting state.
 */
export function bindFinanceAdvisoryEvidenceWithText(
  trustedInput: unknown,
  untrustedVisualInput: UntrustedVisualFinanceEvidence | undefined,
  untrustedTextInput: UntrustedTextFinanceEvidence | undefined,
  nowEpochMs: number,
): FinanceAdvisoryState {
  if (!Number.isFinite(nowEpochMs))
    throw new FinanceAdvisoryBoundaryError(
      "INVALID_INPUT",
      "finance advisory clock must be finite",
    );
  let trustedSnapshot: unknown;
  try {
    trustedSnapshot = snapshotTrustedFinancePlainData(trustedInput);
  } catch (cause) {
    throw new FinanceAdvisoryBoundaryError(
      "INVALID_INPUT",
      cause instanceof Error
        ? cause.message
        : "finance advisory trusted projection is not plain data",
      { cause },
    );
  }
  let trusted: TrustedFinanceProjection;
  try {
    trusted = trustedFinanceProjectionSchema.parse(trustedSnapshot);
  } catch (cause) {
    throw new FinanceAdvisoryBoundaryError(
      "INVALID_INPUT",
      "finance advisory trusted projection is invalid",
      { cause },
    );
  }
  const observedAt = Date.parse(trusted.observedAt);
  const windowStart = Date.parse(trusted.windowStart);
  const windowEnd = Date.parse(trusted.windowEnd);
  const cutoffAt = Date.parse(trusted.cutoffAt);
  if (
    windowStart > windowEnd ||
    windowEnd > cutoffAt ||
    cutoffAt > observedAt ||
    observedAt > nowEpochMs
  )
    throw new FinanceAdvisoryBoundaryError(
      "NO_LOOKAHEAD_ORDER",
      "finance advisory timestamps violate the no-lookahead ordering",
    );
  if (nowEpochMs - observedAt > trusted.maxAgeMs)
    throw new FinanceAdvisoryBoundaryError(
      "STALE_OBSERVATION",
      "finance advisory observation is stale",
    );
  const expiresAt = new Date(observedAt + trusted.maxAgeMs).toISOString();
  if (
    trusted.signals.some((signal) => {
      const asOf = Date.parse(signal.asOf);
      return asOf < windowStart || asOf > cutoffAt;
    })
  )
    throw new FinanceAdvisoryBoundaryError(
      "SIGNAL_OUTSIDE_WINDOW",
      "finance advisory signal is outside the declared window",
    );
  if ((trusted.visual === undefined) !== (untrustedVisualInput === undefined))
    throw new FinanceAdvisoryBoundaryError(
      "EVIDENCE_BINDING",
      "finance advisory visual projection and annotations must be supplied together",
    );
  if ((trusted.text === undefined) !== (untrustedTextInput === undefined))
    throw new FinanceAdvisoryBoundaryError(
      "EVIDENCE_BINDING",
      "finance advisory text projection and excerpts must be supplied together",
    );

  const trustedVisual = trusted.visual;
  const visual =
    trustedVisual === undefined || untrustedVisualInput === undefined
      ? undefined
      : bindEvidence(() =>
          bindVisual(trustedVisual, visualAnnotations(untrustedVisualInput)),
        );
  const trustedText = trusted.text;
  const text =
    trustedText === undefined || untrustedTextInput === undefined
      ? undefined
      : bindEvidence(() =>
          bindText(trustedText, textEvidence(untrustedTextInput)),
        );
  return financeAdvisoryStateSchema.parse({
    contractVersion: FINANCE_ADVISORY_CONTRACT_VERSION,
    advisoryOnly: true,
    execution: "NOT_SUPPORTED",
    instrumentRef: trusted.instrumentRef,
    assetClass: trusted.assetClass,
    venue: trusted.venue,
    sourceId: trusted.sourceId,
    sourceHash: trusted.sourceHash,
    featureSetId: trusted.featureSetId,
    featureSetVersion: trusted.featureSetVersion,
    featureSetHash: trusted.featureSetHash,
    observedAt: trusted.observedAt,
    expiresAt,
    maxAgeMs: trusted.maxAgeMs,
    cutoffAt: trusted.cutoffAt,
    windowStart: trusted.windowStart,
    windowEnd: trusted.windowEnd,
    temporalIntegrity: "verified_no_lookahead",
    signals: trusted.signals,
    ...(visual === undefined ? {} : { visual }),
    ...(text === undefined ? {} : { text }),
    candidates,
  });
}

function bindEvidence<T>(bind: () => T): T {
  try {
    return bind();
  } catch (cause) {
    if (cause instanceof FinanceAdvisoryBoundaryError) throw cause;
    throw new FinanceAdvisoryBoundaryError(
      "EVIDENCE_BINDING",
      cause instanceof Error
        ? cause.message
        : "finance advisory evidence binding failed",
      { cause },
    );
  }
}

function bindVisual(
  trusted: NonNullable<TrustedFinanceProjection["visual"]>,
  annotationsInput: unknown,
) {
  const expectedRoute = financeVisualMutationRoutes[trusted.mutationId];
  const artifactBindingHash = sha256(
    JSON.stringify({
      expectedRoute,
      imageHash: trusted.imageHash,
      mutationId: trusted.mutationId,
      renderer: {
        id: trusted.renderer.id,
        mutationPolicyId: trusted.renderer.mutationPolicyId,
        schemaVersion: trusted.renderer.schemaVersion,
        version: trusted.renderer.version,
      },
      schemaVersion: trusted.schemaVersion,
      sourceBindingHash: trusted.sourceBindingHash,
    }),
  );
  if (
    trusted.expectedRoute !== expectedRoute ||
    trusted.artifactBindingHash !== artifactBindingHash
  )
    throw new TypeError("finance visual artifact binding is invalid");
  const annotations = sanitizeAnnotations(annotationsInput);
  const annotationHash = `sha256:${createHash("sha256")
    .update(JSON.stringify(annotations))
    .digest("hex")}`;
  return {
    ...trusted,
    annotationHash,
    annotations,
    trust: "untrusted_data_only" as const,
  };
}

function bindText(
  trusted: NonNullable<TrustedFinanceProjection["text"]>,
  evidence: { readonly excerpts: unknown; readonly claims?: unknown },
) {
  const excerpts = sanitizeTextExcerpts(evidence.excerpts);
  if (excerpts.length !== trusted.candidateBindings.length)
    throw new TypeError(
      "finance text candidate bindings and excerpts must have the same length",
    );
  const hasBoundClaims = trusted.candidateBindings.every(
    (binding) => binding.claimHash !== undefined,
  );
  if (hasBoundClaims !== (evidence.claims !== undefined))
    throw new TypeError(
      "finance text claim bindings and claims must be supplied together",
    );
  const claims =
    evidence.claims === undefined
      ? undefined
      : sanitizeTextClaims(evidence.claims);
  if (
    claims !== undefined &&
    claims.length !== trusted.candidateBindings.length
  )
    throw new TypeError(
      "finance text candidate bindings and claims must have the same length",
    );
  const candidates = excerpts.map((excerpt, index) => {
    const binding = trusted.candidateBindings[index];
    if (binding === undefined)
      throw new TypeError("finance text candidate binding is missing");
    const excerptHash = sha256(excerpt);
    if (excerptHash !== binding.excerptHash)
      throw new TypeError("finance text candidate excerpt hash mismatch");
    const claim = claims?.[index];
    if (
      binding.claimHash !== undefined &&
      (claim === undefined || sha256(claim) !== binding.claimHash)
    )
      throw new TypeError("finance text candidate claim hash mismatch");
    return Object.freeze({
      id: binding.id,
      excerptHash,
      excerpt,
      ...(binding.claimHash === undefined || claim === undefined
        ? {}
        : { claimHash: binding.claimHash, claim }),
      ...(binding.sourceSpan === undefined
        ? {}
        : {
            sourceSpan: Object.freeze({
              byteStart: binding.sourceSpan.byteStart,
              byteEnd: binding.sourceSpan.byteEnd,
              sectionHash: binding.sourceSpan.sectionHash,
            }),
          }),
    });
  });
  const excerptHash = `sha256:${createHash("sha256")
    .update(JSON.stringify(excerpts))
    .digest("hex")}`;
  const candidateBindingHash = sha256(
    JSON.stringify(
      candidates.map((candidate) => ({
        id: candidate.id,
        excerptHash: candidate.excerptHash,
        ...(candidate.claimHash === undefined
          ? {}
          : { claimHash: candidate.claimHash }),
        ...(candidate.sourceSpan === undefined
          ? {}
          : { sourceSpan: candidate.sourceSpan }),
      })),
    ),
  );
  const { candidateBindings: _candidateBindings, ...metadata } = trusted;
  return {
    ...metadata,
    excerptHash,
    candidateBindingHash,
    candidates: Object.freeze(candidates),
    trust: "untrusted_data_only" as const,
  };
}

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

const MAX_TRUSTED_PLAIN_DEPTH = 12;
const MAX_TRUSTED_PLAIN_NODES = 1_024;

/**
 * Copies hostile caller input without evaluating accessors. The copy is the
 * only value passed to Zod, so schema traversal cannot trigger caller code.
 */
function snapshotTrustedFinancePlainData(input: unknown): unknown {
  const ancestors = new WeakSet<object>();
  let nodes = 0;

  const snapshot = (value: unknown, depth: number): unknown => {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    )
      return value;
    if (!value || typeof value !== "object")
      throw new TypeError(
        "finance advisory trusted projection must contain only plain data",
      );
    if (isProxy(value))
      throw new TypeError(
        "finance advisory trusted projection must not be a proxy",
      );
    if (depth > MAX_TRUSTED_PLAIN_DEPTH)
      throw new TypeError(
        "finance advisory trusted projection exceeds the depth limit",
      );
    nodes += 1;
    if (nodes > MAX_TRUSTED_PLAIN_NODES)
      throw new TypeError(
        "finance advisory trusted projection exceeds the node limit",
      );
    if (ancestors.has(value))
      throw new TypeError(
        "finance advisory trusted projection must not contain cycles",
      );

    const isArray = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (
      (isArray && prototype !== Array.prototype) ||
      (!isArray && prototype !== Object.prototype && prototype !== null)
    )
      throw new TypeError(
        "finance advisory trusted projection must contain only plain objects and arrays",
      );

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key === "symbol"))
      throw new TypeError(
        "finance advisory trusted projection must not contain symbols",
      );

    ancestors.add(value);
    try {
      if (isArray) {
        const lengthDescriptor = descriptors.length;
        if (!lengthDescriptor || !("value" in lengthDescriptor))
          throw new TypeError(
            "finance advisory trusted projection contains an invalid array",
          );
        const length = lengthDescriptor.value;
        if (!Number.isSafeInteger(length) || length < 0 || length > 1_024)
          throw new TypeError(
            "finance advisory trusted projection contains an unbounded array",
          );
        const output: unknown[] = [];
        output.length = length;
        const allowed = new Set(["length"]);
        for (let index = 0; index < length; index += 1) {
          const key = String(index);
          allowed.add(key);
          const descriptor = descriptors[key];
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
            throw new TypeError(
              "finance advisory trusted projection arrays must contain plain data",
            );
          output[index] = snapshot(descriptor.value, depth + 1);
        }
        if (keys.some((key) => !allowed.has(String(key))))
          throw new TypeError(
            "finance advisory trusted projection arrays must not contain extra properties",
          );
        return output;
      }

      const output: Record<string, unknown> = {};
      for (const key of keys) {
        const stringKey = String(key);
        const descriptor = descriptors[stringKey];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
          throw new TypeError(
            "finance advisory trusted projection properties must be plain data",
          );
        Object.defineProperty(output, stringKey, {
          value: snapshot(descriptor.value, depth + 1),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return output;
    } finally {
      ancestors.delete(value);
    }
  };

  return snapshot(input, 0);
}

function visualAnnotations(input: UntrustedVisualFinanceEvidence): unknown {
  if (!input || typeof input !== "object" || isProxy(input))
    throw new TypeError("finance visual evidence must be a plain object");
  const prototype = Object.getPrototypeOf(input) as unknown;
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError("finance visual evidence must be a plain object");
  if (Object.getOwnPropertySymbols(input).length > 0)
    throw new TypeError("finance visual evidence must not contain symbols");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Object.keys(descriptors);
  const descriptor = descriptors.annotations;
  if (
    keys.length !== 1 ||
    !descriptor ||
    !("value" in descriptor) ||
    !descriptor.enumerable
  )
    throw new TypeError(
      "finance visual evidence must contain one plain annotations field",
    );
  return descriptor.value;
}

function textEvidence(input: UntrustedTextFinanceEvidence): {
  readonly excerpts: unknown;
  readonly claims?: unknown;
} {
  if (!input || typeof input !== "object" || isProxy(input))
    throw new TypeError("finance text evidence must be a plain object");
  const prototype = Object.getPrototypeOf(input) as unknown;
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError("finance text evidence must be a plain object");
  if (Object.getOwnPropertySymbols(input).length > 0)
    throw new TypeError("finance text evidence must not contain symbols");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Object.keys(descriptors);
  const excerptsDescriptor = descriptors.excerpts;
  const claimsDescriptor = descriptors.claims;
  if (
    keys.length < 1 ||
    keys.length > 2 ||
    keys.some((key) => key !== "excerpts" && key !== "claims") ||
    !excerptsDescriptor ||
    !("value" in excerptsDescriptor) ||
    !excerptsDescriptor.enumerable ||
    (claimsDescriptor !== undefined &&
      (!("value" in claimsDescriptor) || !claimsDescriptor.enumerable))
  )
    throw new TypeError(
      "finance text evidence must contain plain excerpts and optional claims fields",
    );
  return {
    excerpts: excerptsDescriptor.value,
    ...(claimsDescriptor === undefined
      ? {}
      : { claims: claimsDescriptor.value }),
  };
}

function sanitizeAnnotations(input: unknown): readonly string[] {
  if (isProxy(input as object))
    throw new TypeError("finance visual annotations must not be a proxy");
  if (!Array.isArray(input))
    throw new TypeError("finance visual annotations must be an array");
  if (Object.getPrototypeOf(input) !== Array.prototype || input.length > 32)
    throw new TypeError("finance visual annotations are not a bounded array");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const allowed = new Set(["length"]);
  const output: string[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const key = String(index);
    allowed.add(key);
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
      throw new TypeError("finance visual annotations must contain plain data");
    output.push(oneLineSchema.parse(descriptor.value));
  }
  if (Reflect.ownKeys(descriptors).some((key) => !allowed.has(String(key))))
    throw new TypeError("finance visual annotations contain extra properties");
  return Object.freeze(output);
}

function sanitizeTextExcerpts(input: unknown): readonly string[] {
  if (isProxy(input as object))
    throw new TypeError("finance text excerpts must not be a proxy");
  if (!Array.isArray(input))
    throw new TypeError("finance text excerpts must be an array");
  if (
    Object.getPrototypeOf(input) !== Array.prototype ||
    input.length < 1 ||
    input.length > MAX_TEXT_EXCERPTS
  )
    throw new TypeError("finance text excerpts are not a bounded array");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const allowed = new Set(["length"]);
  const output: string[] = [];
  let totalBytes = 0;
  for (let index = 0; index < input.length; index += 1) {
    const key = String(index);
    allowed.add(key);
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
      throw new TypeError("finance text excerpts must contain plain data");
    const excerpt = textExcerptSchema.parse(descriptor.value);
    totalBytes += Buffer.byteLength(excerpt, "utf8");
    if (totalBytes > MAX_TEXT_EXCERPT_BYTES)
      throw new TypeError("finance text excerpts exceed the total byte limit");
    output.push(excerpt);
  }
  if (Reflect.ownKeys(descriptors).some((key) => !allowed.has(String(key))))
    throw new TypeError("finance text excerpts contain extra properties");
  return Object.freeze(output);
}

function sanitizeTextClaims(input: unknown): readonly string[] {
  if (isProxy(input as object))
    throw new TypeError("finance text claims must not be a proxy");
  if (!Array.isArray(input))
    throw new TypeError("finance text claims must be an array");
  if (
    Object.getPrototypeOf(input) !== Array.prototype ||
    input.length < 1 ||
    input.length > MAX_TEXT_EXCERPTS
  )
    throw new TypeError("finance text claims are not a bounded array");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const allowed = new Set(["length"]);
  const output: string[] = [];
  let totalBytes = 0;
  for (let index = 0; index < input.length; index += 1) {
    const key = String(index);
    allowed.add(key);
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
      throw new TypeError("finance text claims must contain plain data");
    const claim = textClaimSchema.parse(descriptor.value);
    totalBytes += Buffer.byteLength(claim, "utf8");
    if (totalBytes > MAX_TEXT_CLAIM_BYTES)
      throw new TypeError("finance text claims exceed the total byte limit");
    output.push(claim);
  }
  if (Reflect.ownKeys(descriptors).some((key) => !allowed.has(String(key))))
    throw new TypeError("finance text claims contain extra properties");
  return Object.freeze(output);
}

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
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
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

const MAX_TEXT_EXCERPTS = 16;
const MAX_TEXT_EXCERPT_BYTES = 16_384;

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
      })
      .strict()
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
        excerpts: z.array(textExcerptSchema).max(MAX_TEXT_EXCERPTS),
        trust: z.literal("untrusted_data_only"),
      })
      .strict()
      .superRefine((value, context) => {
        const totalBytes = value.excerpts.reduce(
          (total, excerpt) => total + Buffer.byteLength(excerpt, "utf8"),
          0,
        );
        if (totalBytes > MAX_TEXT_EXCERPT_BYTES)
          context.addIssue({
            code: "custom",
            message: "excerpts exceed the total byte limit",
            path: ["excerpts"],
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
  let trusted: TrustedFinanceProjection;
  try {
    trusted = trustedFinanceProjectionSchema.parse(trustedInput);
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
          bindText(trustedText, textExcerpts(untrustedTextInput)),
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
  excerptsInput: unknown,
) {
  const excerpts = sanitizeTextExcerpts(excerptsInput);
  const excerptHash = `sha256:${createHash("sha256")
    .update(JSON.stringify(excerpts))
    .digest("hex")}`;
  return {
    ...trusted,
    excerptHash,
    excerpts,
    trust: "untrusted_data_only" as const,
  };
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

function textExcerpts(input: UntrustedTextFinanceEvidence): unknown {
  if (!input || typeof input !== "object" || isProxy(input))
    throw new TypeError("finance text evidence must be a plain object");
  const prototype = Object.getPrototypeOf(input) as unknown;
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError("finance text evidence must be a plain object");
  if (Object.getOwnPropertySymbols(input).length > 0)
    throw new TypeError("finance text evidence must not contain symbols");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Object.keys(descriptors);
  const descriptor = descriptors.excerpts;
  if (
    keys.length !== 1 ||
    !descriptor ||
    !("value" in descriptor) ||
    !descriptor.enumerable
  )
    throw new TypeError(
      "finance text evidence must contain one plain excerpts field",
    );
  return descriptor.value;
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

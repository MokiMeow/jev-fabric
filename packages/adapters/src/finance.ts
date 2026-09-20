import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";
import { z } from "zod";

export const FINANCE_ADVISORY_CONTRACT_VERSION = "1" as const;

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
  if (!Number.isFinite(nowEpochMs))
    throw new TypeError("finance advisory clock must be finite");
  const trusted = trustedFinanceProjectionSchema.parse(trustedInput);
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
    throw new TypeError(
      "finance advisory timestamps violate the no-lookahead ordering",
    );
  if (nowEpochMs - observedAt > trusted.maxAgeMs)
    throw new TypeError("finance advisory observation is stale");
  if (
    trusted.signals.some((signal) => {
      const asOf = Date.parse(signal.asOf);
      return asOf < windowStart || asOf > cutoffAt;
    })
  )
    throw new TypeError(
      "finance advisory signal is outside the declared window",
    );
  if ((trusted.visual === undefined) !== (untrustedVisualInput === undefined))
    throw new TypeError(
      "finance advisory visual projection and annotations must be supplied together",
    );

  const visual =
    trusted.visual === undefined || untrustedVisualInput === undefined
      ? undefined
      : bindVisual(trusted.visual, visualAnnotations(untrustedVisualInput));
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
    candidates,
  });
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

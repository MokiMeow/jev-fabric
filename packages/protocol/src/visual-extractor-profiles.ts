import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";
import { z } from "zod";
import { portableIdentifierSchema } from "./json.js";
import {
  toolEnvironmentSnapshotSchema,
  toolEnvironmentVisualAnnotationHash,
  toolEnvironmentVisualCaptureSchema,
  type ToolEnvironmentSnapshot,
} from "./tool-environments.js";

/**
 * A trusted, code-reviewed contract for a visual extractor's bounded output.
 * It is not an image decoder, a capability grant, or an instruction channel.
 */
export const VISUAL_EXTRACTOR_PROFILE_VERSION = "1" as const;

const hashSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/u, "must be a SHA-256 hash");
const versionSchema = z.string().min(1).max(128);
const modalitySchema = z.enum(["chart", "browser_viewport", "dcc_viewport"]);
const annotationSchema = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (value) =>
      !Array.from(value).some((character) => {
        const codePoint = character.codePointAt(0);
        return (
          codePoint === undefined ||
          codePoint <= 0x1f ||
          (codePoint >= 0x7f && codePoint <= 0x9f) ||
          (codePoint >= 0x202a && codePoint <= 0x202e) ||
          (codePoint >= 0x2066 && codePoint <= 0x2069)
        );
      }),
    "must not contain control characters",
  );

export const visualExtractorFindingDispositionSchema = z.enum([
  "visual_ambiguity",
  "requires_structured_state",
  "requires_human_review",
]);
export type VisualExtractorFindingDisposition = z.infer<
  typeof visualExtractorFindingDispositionSchema
>;

/**
 * The disposition is descriptive only. It cannot name an action, grant
 * approval, or represent a confidence score.
 */
export const visualExtractorFindingSchema = z
  .object({
    id: portableIdentifierSchema,
    disposition: visualExtractorFindingDispositionSchema,
  })
  .strict();
export type VisualExtractorFinding = z.infer<
  typeof visualExtractorFindingSchema
>;

/**
 * A host-owned profile that fixes the only finding identifiers an extractor
 * may report for one or more visual surface modalities.
 */
export const toolEnvironmentVisualExtractorProfileSchema = z
  .object({
    profileVersion: z.literal(VISUAL_EXTRACTOR_PROFILE_VERSION),
    extractorId: portableIdentifierSchema,
    extractorVersion: versionSchema,
    schemaVersion: z.literal("1"),
    modalities: z.array(modalitySchema).min(1).max(3),
    maxFindingCount: z.number().int().positive().max(32),
    findings: z.array(visualExtractorFindingSchema).min(1).max(32),
  })
  .strict()
  .superRefine((profile, context) => {
    const modalitySet = new Set(profile.modalities);
    if (modalitySet.size !== profile.modalities.length)
      context.addIssue({
        code: "custom",
        message: "profile modalities must be unique",
        path: ["modalities"],
      });
    if (
      profile.modalities.some((modality, index) => {
        const previous = profile.modalities.at(index - 1);
        return index > 0 && previous !== undefined && modality < previous;
      })
    )
      context.addIssue({
        code: "custom",
        message: "profile modalities must use canonical ascending order",
        path: ["modalities"],
      });
    const findingIds = profile.findings.map((finding) => finding.id);
    if (new Set(findingIds).size !== findingIds.length)
      context.addIssue({
        code: "custom",
        message: "profile finding ids must be unique",
        path: ["findings"],
      });
    if (
      findingIds.some((id, index) => {
        const previous = findingIds.at(index - 1);
        return index > 0 && previous !== undefined && id < previous;
      })
    )
      context.addIssue({
        code: "custom",
        message: "profile findings must use canonical ascending id order",
        path: ["findings"],
      });
  });
export type ToolEnvironmentVisualExtractorProfile = z.infer<
  typeof toolEnvironmentVisualExtractorProfileSchema
>;

/** A profile-bound capture keeps the extractor configuration in the source tuple. */
export const toolEnvironmentProfiledVisualCaptureSchema =
  toolEnvironmentVisualCaptureSchema
    .extend({ extractorProfileHash: hashSchema })
    .strict();
export type ToolEnvironmentProfiledVisualCapture = z.infer<
  typeof toolEnvironmentProfiledVisualCaptureSchema
>;

/**
 * Strict profile mode. Unlike the compatibility envelope, its capture binding
 * includes the independently trusted profile digest.
 */
export const toolEnvironmentProfiledVisualObservationSchema =
  toolEnvironmentProfiledVisualCaptureSchema
    .extend({
      captureBindingHash: hashSchema,
      annotationHash: hashSchema,
      annotations: z.array(annotationSchema).min(1).max(32),
      trust: z.literal("untrusted_data_only"),
    })
    .strict();
export type ToolEnvironmentProfiledVisualObservation = z.infer<
  typeof toolEnvironmentProfiledVisualObservationSchema
>;

/**
 * Fixed-vocabulary, source-bound visual findings. This attachment stays
 * separate from the generic visual observation for backwards compatibility.
 */
export const toolEnvironmentProfiledVisualFindingsSchema = z
  .object({
    observationCaptureBindingHash: hashSchema,
    observationAnnotationHash: hashSchema,
    extractorProfileHash: hashSchema,
    findingIds: z.array(portableIdentifierSchema).min(1).max(32),
    findingBindingHash: hashSchema,
    trust: z.literal("untrusted_data_only"),
  })
  .strict()
  .superRefine((findings, context) => {
    if (new Set(findings.findingIds).size !== findings.findingIds.length)
      context.addIssue({
        code: "custom",
        message: "profiled finding ids must be unique",
        path: ["findingIds"],
      });
    if (
      findings.findingIds.some((id, index) => {
        const previous = findings.findingIds.at(index - 1);
        return index > 0 && previous !== undefined && id < previous;
      })
    )
      context.addIssue({
        code: "custom",
        message: "profiled finding ids must use canonical ascending order",
        path: ["findingIds"],
      });
  });
export type ToolEnvironmentProfiledVisualFindings = z.infer<
  typeof toolEnvironmentProfiledVisualFindingsSchema
>;

/** Returns the canonical digest of a complete trusted profile. */
export function toolEnvironmentVisualExtractorProfileHash(
  profileInput: unknown,
): string {
  const profile = toolEnvironmentVisualExtractorProfileSchema.parse(
    snapshotPlainData(profileInput, "trusted visual extractor profile"),
  );
  return sha256(
    JSON.stringify({
      extractorId: profile.extractorId,
      extractorVersion: profile.extractorVersion,
      findings: profile.findings,
      maxFindingCount: profile.maxFindingCount,
      modalities: profile.modalities,
      profileVersion: profile.profileVersion,
      schemaVersion: profile.schemaVersion,
    }),
  );
}

/**
 * Canonically binds a strict profile-mode capture to the complete trusted
 * snapshot projection. The profile hash is deliberately inside this tuple.
 */
export function toolEnvironmentProfiledVisualCaptureBindingHash(
  snapshot: Pick<
    ToolEnvironmentSnapshot,
    | "environment"
    | "adapterId"
    | "adapterVersion"
    | "sessionRef"
    | "workspaceRef"
    | "stateHash"
    | "capabilityManifestHash"
    | "observedAt"
    | "observationFreshnessMs"
  >,
  capture: ToolEnvironmentProfiledVisualCapture,
): string {
  return sha256(
    JSON.stringify({
      adapterId: snapshot.adapterId,
      adapterVersion: snapshot.adapterVersion,
      capabilityManifestHash: snapshot.capabilityManifestHash,
      capture: {
        artifactHash: capture.artifactHash,
        capturedAt: capture.capturedAt,
        extractorId: capture.extractorId,
        extractorProfileHash: capture.extractorProfileHash,
        extractorVersion: capture.extractorVersion,
        maxAgeMs: capture.maxAgeMs,
        modality: capture.modality,
        schemaVersion: capture.schemaVersion,
      },
      environment: snapshot.environment,
      observationFreshnessMs: snapshot.observationFreshnessMs,
      observedAt: snapshot.observedAt,
      sessionRef: snapshot.sessionRef,
      stateHash: snapshot.stateHash,
      workspaceRef: snapshot.workspaceRef,
    }),
  );
}

/**
 * Validates strict profile-mode capture equality and freshness after the host
 * has already validated the snapshot against its exact trusted catalogue.
 */
export function validateToolEnvironmentProfiledVisualObservation(
  observationInput: unknown,
  validatedSnapshotInput: unknown,
  trustedCaptureInput: unknown,
  trustedProfileInput: unknown,
  observedNowMs: number,
): ToolEnvironmentProfiledVisualObservation {
  if (!Number.isSafeInteger(observedNowMs) || observedNowMs < 0)
    throw new TypeError("observedNowMs must be a non-negative safe integer");
  const snapshot = toolEnvironmentSnapshotSchema.parse(
    snapshotPlainData(
      validatedSnapshotInput,
      "validated tool environment snapshot",
    ),
  );
  const observation = toolEnvironmentProfiledVisualObservationSchema.parse(
    snapshotPlainData(observationInput, "profiled visual observation"),
  );
  const trustedCapture = toolEnvironmentProfiledVisualCaptureSchema.parse(
    snapshotPlainData(trustedCaptureInput, "trusted profiled visual capture"),
  );
  const profile = toolEnvironmentVisualExtractorProfileSchema.parse(
    snapshotPlainData(trustedProfileInput, "trusted visual extractor profile"),
  );
  const projected = {
    modality: observation.modality,
    artifactHash: observation.artifactHash,
    extractorId: observation.extractorId,
    extractorVersion: observation.extractorVersion,
    schemaVersion: observation.schemaVersion,
    capturedAt: observation.capturedAt,
    maxAgeMs: observation.maxAgeMs,
    extractorProfileHash: observation.extractorProfileHash,
  } satisfies ToolEnvironmentProfiledVisualCapture;
  if (JSON.stringify(projected) !== JSON.stringify(trustedCapture))
    throw new TypeError(
      "profiled visual observation does not match the independently trusted capture",
    );
  const profileHash = toolEnvironmentVisualExtractorProfileHash(profile);
  if (
    observation.extractorProfileHash !== profileHash ||
    observation.extractorId !== profile.extractorId ||
    observation.extractorVersion !== profile.extractorVersion ||
    observation.schemaVersion !== profile.schemaVersion ||
    !profile.modalities.includes(observation.modality)
  )
    throw new TypeError(
      "profiled visual observation does not match the trusted extractor profile",
    );
  const observedAt = Date.parse(snapshot.observedAt);
  const capturedAt = Date.parse(observation.capturedAt);
  if (capturedAt < observedAt)
    throw new TypeError(
      "profiled visual capture predates the trusted snapshot",
    );
  if (capturedAt - observedAt > snapshot.observationFreshnessMs)
    throw new TypeError(
      "profiled visual capture is outside the trusted snapshot freshness window",
    );
  if (
    observedNowMs < capturedAt ||
    observedNowMs - capturedAt > observation.maxAgeMs
  )
    throw new TypeError("profiled visual capture is stale");
  if (
    observation.captureBindingHash !==
    toolEnvironmentProfiledVisualCaptureBindingHash(snapshot, observation)
  )
    throw new TypeError(
      "profiled visual capture binding does not match the trusted snapshot",
    );
  if (
    observation.annotationHash !==
    toolEnvironmentVisualAnnotationHash(observation.annotations)
  )
    throw new TypeError("profiled visual annotation binding is invalid");
  return { ...observation, annotations: [...observation.annotations] };
}

/**
 * Computes the immutable link between a profile, one already-bound visual
 * observation, and the fixed finding identifiers returned by an extractor.
 */
export function toolEnvironmentProfiledVisualFindingsBindingHash(
  observationInput: ToolEnvironmentProfiledVisualObservation,
  extractorProfileHash: string,
  findingIds: readonly string[],
): string {
  const observation = toolEnvironmentProfiledVisualObservationSchema.parse(
    snapshotPlainData(observationInput, "visual observation"),
  );
  hashSchema.parse(extractorProfileHash);
  const parsedFindingIds = z
    .array(portableIdentifierSchema)
    .parse(snapshotPlainData(findingIds, "profiled finding ids"));
  return sha256(
    JSON.stringify({
      extractorProfileHash,
      findingIds: parsedFindingIds,
      observationAnnotationHash: observation.annotationHash,
      observationCaptureBindingHash: observation.captureBindingHash,
    }),
  );
}

/**
 * Validates a fixed-vocabulary visual attachment against independently trusted
 * profile metadata and an already validated source-bound observation. This
 * does not interpret image data or authorize a tool-environment operation.
 */
export function validateToolEnvironmentProfiledVisualFindings(
  findingsInput: unknown,
  trustedProfileInput: unknown,
  trustedObservationInput: unknown,
): ToolEnvironmentProfiledVisualFindings {
  const profile = toolEnvironmentVisualExtractorProfileSchema.parse(
    snapshotPlainData(trustedProfileInput, "trusted visual extractor profile"),
  );
  const observation = toolEnvironmentProfiledVisualObservationSchema.parse(
    snapshotPlainData(trustedObservationInput, "trusted visual observation"),
  );
  const findings = toolEnvironmentProfiledVisualFindingsSchema.parse(
    snapshotPlainData(findingsInput, "profiled visual findings"),
  );
  if (
    observation.extractorId !== profile.extractorId ||
    observation.extractorVersion !== profile.extractorVersion ||
    observation.schemaVersion !== profile.schemaVersion ||
    !profile.modalities.includes(observation.modality)
  )
    throw new TypeError(
      "visual observation does not match the trusted extractor profile",
    );
  const profileHash = toolEnvironmentVisualExtractorProfileHash(profile);
  if (
    observation.extractorProfileHash !== profileHash ||
    findings.extractorProfileHash !== profileHash
  )
    throw new TypeError(
      "profiled visual findings have the wrong extractor profile",
    );
  if (
    findings.observationCaptureBindingHash !== observation.captureBindingHash ||
    findings.observationAnnotationHash !== observation.annotationHash
  )
    throw new TypeError(
      "profiled visual findings do not match the trusted visual observation",
    );
  const knownFindingIds = new Set(
    profile.findings.map((finding) => finding.id),
  );
  if (findings.findingIds.length > profile.maxFindingCount)
    throw new TypeError(
      "profiled visual findings exceed the trusted profile limit",
    );
  if (findings.findingIds.some((id) => !knownFindingIds.has(id)))
    throw new TypeError(
      "profiled visual findings contain an unknown finding id",
    );
  if (
    findings.findingBindingHash !==
    toolEnvironmentProfiledVisualFindingsBindingHash(
      observation,
      profileHash,
      findings.findingIds,
    )
  )
    throw new TypeError("profiled visual findings binding is invalid");
  return { ...findings, findingIds: [...findings.findingIds] };
}

const MAX_VALIDATION_NODES = 4_096;
const MAX_VALIDATION_DEPTH = 16;

function snapshotPlainData(input: unknown, label: string): unknown {
  return copyPlainData(input, label, 0, { nodes: 0 });
}

function copyPlainData(
  input: unknown,
  label: string,
  depth: number,
  budget: { nodes: number },
): unknown {
  budget.nodes += 1;
  if (budget.nodes > MAX_VALIDATION_NODES)
    throw new TypeError(`${label} exceeds the validation node limit`);
  if (depth > MAX_VALIDATION_DEPTH)
    throw new TypeError(`${label} exceeds the validation depth limit`);
  if (input === null || typeof input !== "object") return input;
  if (utilTypes.isProxy(input))
    throw new TypeError(`${label} must not contain proxies`);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string"))
    throw new TypeError(`${label} must not contain symbols`);
  if (Array.isArray(input)) {
    if (Object.getPrototypeOf(input) !== Array.prototype)
      throw new TypeError(`${label} arrays must use the default prototype`);
    const allowed = new Set(["length"]);
    const output: unknown[] = [];
    for (let index = 0; index < input.length; index += 1) {
      const key = String(index);
      allowed.add(key);
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !("value" in descriptor))
        throw new TypeError(`${label} arrays must contain plain data`);
      output.push(copyPlainData(descriptor.value, label, depth + 1, budget));
    }
    if (Object.keys(descriptors).some((key) => !allowed.has(key)))
      throw new TypeError(`${label} arrays must not contain extra properties`);
    return output;
  }
  const prototype = Object.getPrototypeOf(input) as unknown;
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError(`${label} must contain only plain objects`);
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor))
      throw new TypeError(`${label} must contain plain enumerable data`);
    output[key] = copyPlainData(descriptor.value, label, depth + 1, budget);
  }
  return output;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";
import { z } from "zod";

/**
 * Offline binder for a trusted visual-extractor profile. It cannot load an
 * image, connect to a browser or DCC host, or invoke an operation.
 */
export const VISUAL_EXTRACTOR_PROFILE_VERSION = "1" as const;

const hashSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/u, "must be a SHA-256 hash");
const identifierSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u, "must be a portable identifier");
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
  )
  .refine(
    (value) =>
      !/\b(?:Bearer\s+[^\s,;]{8,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|(?:sk|rk|pk|apikey|api[_-]?key|ghp|github_pat|xai)[_-][A-Za-z0-9_-]{12,}|v1\.[A-Za-z][A-Za-z0-9_:-]{0,127}\.[A-Za-z0-9_-]{1,8143}\.[A-Za-z0-9_-]{43})\b/iu.test(
        value,
      ),
    "must not contain credential-shaped values",
  )
  .refine(
    (value) => !/(?:https?:\/\/|file:|data:|blob:|javascript:)/iu.test(value),
    "must not contain URL-shaped values",
  );
const findingDispositionSchema = z.enum([
  "visual_ambiguity",
  "requires_structured_state",
  "requires_human_review",
]);

const visualObservationSchema = z
  .object({
    modality: modalitySchema,
    artifactHash: hashSchema,
    extractorId: identifierSchema,
    extractorVersion: z.string().min(1).max(128),
    schemaVersion: z.literal("1"),
    capturedAt: z.string().datetime({ offset: true }),
    maxAgeMs: z.number().int().nonnegative().max(86_400_000),
    captureBindingHash: hashSchema,
    annotationHash: hashSchema,
    annotations: z.array(annotationSchema).min(1).max(32),
    trust: z.literal("untrusted_data_only"),
  })
  .strict();
export type ToolEnvironmentVisualObservation = z.infer<
  typeof visualObservationSchema
>;

const visualExtractorFindingSchema = z
  .object({
    id: identifierSchema,
    disposition: findingDispositionSchema,
  })
  .strict();

const visualExtractorProfileSchema = z
  .object({
    profileVersion: z.literal(VISUAL_EXTRACTOR_PROFILE_VERSION),
    extractorId: identifierSchema,
    extractorVersion: z.string().min(1).max(128),
    schemaVersion: z.literal("1"),
    modalities: z.array(modalitySchema).min(1).max(3),
    maxFindingCount: z.number().int().positive().max(32),
    findings: z.array(visualExtractorFindingSchema).min(1).max(32),
  })
  .strict()
  .superRefine((profile, context) => {
    if (new Set(profile.modalities).size !== profile.modalities.length)
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
    const ids = profile.findings.map((finding) => finding.id);
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: "custom",
        message: "profile finding ids must be unique",
        path: ["findings"],
      });
    if (
      ids.some((id, index) => {
        const previous = ids.at(index - 1);
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
  typeof visualExtractorProfileSchema
>;

const profiledVisualCaptureSchema = visualObservationSchema
  .pick({
    modality: true,
    artifactHash: true,
    extractorId: true,
    extractorVersion: true,
    schemaVersion: true,
    capturedAt: true,
    maxAgeMs: true,
  })
  .extend({ extractorProfileHash: hashSchema })
  .strict();
export type TrustedToolEnvironmentProfiledVisualCapture = z.infer<
  typeof profiledVisualCaptureSchema
>;

const profiledVisualObservationSchema = profiledVisualCaptureSchema
  .extend({
    captureBindingHash: hashSchema,
    annotationHash: hashSchema,
    annotations: z.array(annotationSchema).min(1).max(32),
    trust: z.literal("untrusted_data_only"),
  })
  .strict();
export type ToolEnvironmentProfiledVisualObservation = z.infer<
  typeof profiledVisualObservationSchema
>;

const profiledVisualFindingsSchema = z
  .object({
    observationCaptureBindingHash: hashSchema,
    observationAnnotationHash: hashSchema,
    extractorProfileHash: hashSchema,
    findingIds: z.array(identifierSchema).min(1).max(32),
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
  typeof profiledVisualFindingsSchema
>;

const visualTextBridgeEvidenceSchema = z
  .object({
    modality: modalitySchema,
    artifactHash: hashSchema,
    captureBindingHash: hashSchema,
    annotationHash: hashSchema,
    extractorId: identifierSchema,
    extractorVersion: z.string().min(1).max(128),
    extractorProfileHash: hashSchema,
    findingBindingHash: hashSchema,
    annotations: z.array(annotationSchema).min(1).max(32),
    findings: z.array(visualExtractorFindingSchema).min(1).max(32),
    trust: z.literal("untrusted_data_only"),
  })
  .strict();

/**
 * Provider-safe bridge for text-only decision models. It contains bounded text
 * and fixed findings, never pixels, URLs, paths, selectors, coordinates,
 * capabilities, authority, or an execution channel.
 */
export const toolEnvironmentVisualTextBridgeStateSchema = z
  .object({
    schemaVersion: z.literal("1"),
    purpose: z.literal("visual_evidence_triage_only"),
    advisoryOnly: z.literal(true),
    execution: z.literal("NOT_SUPPORTED"),
    inputModality: z.literal("extractor_text_only"),
    providerReceivesImage: z.literal(false),
    capturedAt: z.string().datetime({ offset: true }),
    validUntil: z.string().datetime({ offset: true }),
    evidence: visualTextBridgeEvidenceSchema,
    stateBindingHash: hashSchema,
  })
  .strict();
export type ToolEnvironmentVisualTextBridgeState = z.infer<
  typeof toolEnvironmentVisualTextBridgeStateSchema
>;

export interface UntrustedToolEnvironmentVisualFindingEvidence {
  readonly findingIds: unknown;
}

const profiledVisualBindingSchema = z
  .object({
    environment: z.enum([
      "browser",
      "blender",
      "unreal",
      "unity",
      "godot",
      "freecad",
      "generic",
    ]),
    adapterId: identifierSchema,
    adapterVersion: z.string().min(1).max(128),
    sessionRef: z
      .string()
      .regex(
        /^ref:[A-Za-z][A-Za-z0-9._:-]{0,127}$/u,
        "must be an opaque reference",
      ),
    workspaceRef: z
      .string()
      .regex(
        /^ref:[A-Za-z][A-Za-z0-9._:-]{0,127}$/u,
        "must be an opaque reference",
      ),
    stateHash: hashSchema,
    capabilityManifestHash: hashSchema,
    observedAt: z.string().datetime({ offset: true }),
    observationFreshnessMs: z.number().int().nonnegative().max(86_400_000),
  })
  .strict();
export type TrustedToolEnvironmentProfiledVisualBinding = z.infer<
  typeof profiledVisualBindingSchema
>;

export interface UntrustedToolEnvironmentProfiledVisualEvidence {
  readonly annotations: unknown;
}

/** Returns the canonical digest of a complete trusted extractor profile. */
export function toolEnvironmentVisualExtractorProfileHash(
  profileInput: unknown,
): string {
  const profile = parseProfile(profileInput);
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

/** Computes the strict profile-mode capture binding for a trusted snapshot. */
export function toolEnvironmentProfiledVisualCaptureBindingHash(
  bindingInput: TrustedToolEnvironmentProfiledVisualBinding,
  captureInput: TrustedToolEnvironmentProfiledVisualCapture,
): string {
  const binding = parseProfiledBinding(bindingInput);
  const capture = parseProfiledCapture(captureInput);
  return sha256(
    JSON.stringify({
      adapterId: binding.adapterId,
      adapterVersion: binding.adapterVersion,
      capabilityManifestHash: binding.capabilityManifestHash,
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
      environment: binding.environment,
      observationFreshnessMs: binding.observationFreshnessMs,
      observedAt: binding.observedAt,
      sessionRef: binding.sessionRef,
      stateHash: binding.stateHash,
      workspaceRef: binding.workspaceRef,
    }),
  );
}

/** Binds an independently trusted profiled capture to bounded annotations. */
export function bindToolEnvironmentProfiledVisualObservation(
  trustedBindingInput: unknown,
  trustedCaptureInput: unknown,
  trustedProfileInput: unknown,
  untrustedEvidenceInput: UntrustedToolEnvironmentProfiledVisualEvidence,
  nowEpochMs: number,
): ToolEnvironmentProfiledVisualObservation {
  const binding = parseProfiledBinding(trustedBindingInput);
  const capture = parseProfiledCapture(trustedCaptureInput);
  const profile = parseProfile(trustedProfileInput);
  const annotations = parseUntrustedAnnotations(untrustedEvidenceInput);
  const observation = {
    ...capture,
    captureBindingHash: toolEnvironmentProfiledVisualCaptureBindingHash(
      binding,
      capture,
    ),
    annotationHash: sha256(JSON.stringify(annotations)),
    annotations,
    trust: "untrusted_data_only" as const,
  };
  return validateToolEnvironmentProfiledVisualObservation(
    observation,
    binding,
    capture,
    profile,
    nowEpochMs,
  );
}

/** Rechecks strict capture/profile identity, freshness, and annotation binding. */
export function validateToolEnvironmentProfiledVisualObservation(
  observationInput: unknown,
  trustedBindingInput: unknown,
  trustedCaptureInput: unknown,
  trustedProfileInput: unknown,
  nowEpochMs: number,
): ToolEnvironmentProfiledVisualObservation {
  if (!Number.isSafeInteger(nowEpochMs) || nowEpochMs < 0)
    fail("nowEpochMs must be a non-negative safe integer");
  const binding = parseProfiledBinding(trustedBindingInput);
  const capture = parseProfiledCapture(trustedCaptureInput);
  const profile = parseProfile(trustedProfileInput);
  const observation = profiledVisualObservationSchema.parse(
    copyPlainData(observationInput, "profiled visual observation"),
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
  } satisfies TrustedToolEnvironmentProfiledVisualCapture;
  if (JSON.stringify(projected) !== JSON.stringify(capture))
    fail("profiled visual observation does not match the trusted capture");
  const profileHash = toolEnvironmentVisualExtractorProfileHash(profile);
  if (
    observation.extractorProfileHash !== profileHash ||
    observation.extractorId !== profile.extractorId ||
    observation.extractorVersion !== profile.extractorVersion ||
    observation.schemaVersion !== profile.schemaVersion ||
    !profile.modalities.includes(observation.modality)
  )
    fail(
      "profiled visual observation does not match the trusted extractor profile",
    );
  assertFresh(binding, observation, nowEpochMs);
  if (
    observation.captureBindingHash !==
    toolEnvironmentProfiledVisualCaptureBindingHash(binding, capture)
  )
    fail("profiled visual capture binding does not match the trusted snapshot");
  if (
    observation.annotationHash !==
    sha256(JSON.stringify(observation.annotations))
  )
    fail("profiled visual annotation binding is invalid");
  return { ...observation, annotations: [...observation.annotations] };
}

/** Computes the profile/observation/finding attachment binding. */
export function toolEnvironmentProfiledVisualFindingsBindingHash(
  observationInput: ToolEnvironmentProfiledVisualObservation,
  extractorProfileHash: string,
  findingIds: readonly string[],
): string {
  const observation = parseProfiledObservation(observationInput);
  hashSchema.parse(extractorProfileHash);
  const ids = z
    .array(identifierSchema)
    .parse(copyPlainData(findingIds, "finding ids"));
  return sha256(
    JSON.stringify({
      extractorProfileHash,
      findingIds: ids,
      observationAnnotationHash: observation.annotationHash,
      observationCaptureBindingHash: observation.captureBindingHash,
    }),
  );
}

/**
 * Binds a fixed set of extractor finding identifiers to an existing visual
 * observation. The observation must already have passed its source/freshness
 * validation with the trusted tool-environment snapshot and capture.
 */
export function bindToolEnvironmentProfiledVisualFindings(
  trustedObservationInput: unknown,
  trustedProfileInput: unknown,
  untrustedEvidenceInput: UntrustedToolEnvironmentVisualFindingEvidence,
): ToolEnvironmentProfiledVisualFindings {
  const observation = parseProfiledObservation(trustedObservationInput);
  const profile = parseProfile(trustedProfileInput);
  const findingIds = parseUntrustedFindingIds(untrustedEvidenceInput);
  const extractorProfileHash =
    toolEnvironmentVisualExtractorProfileHash(profile);
  return validateToolEnvironmentProfiledVisualFindings(
    {
      observationCaptureBindingHash: observation.captureBindingHash,
      observationAnnotationHash: observation.annotationHash,
      extractorProfileHash,
      findingIds,
      findingBindingHash: toolEnvironmentProfiledVisualFindingsBindingHash(
        observation,
        extractorProfileHash,
        findingIds,
      ),
      trust: "untrusted_data_only",
    },
    profile,
    observation,
  );
}

/** Rechecks a fixed-vocabulary attachment without performing host I/O. */
export function validateToolEnvironmentProfiledVisualFindings(
  findingsInput: unknown,
  trustedProfileInput: unknown,
  trustedObservationInput: unknown,
): ToolEnvironmentProfiledVisualFindings {
  const profile = parseProfile(trustedProfileInput);
  const observation = parseProfiledObservation(trustedObservationInput);
  const findings = profiledVisualFindingsSchema.parse(
    copyPlainData(findingsInput, "profiled visual findings"),
  );
  if (
    observation.extractorId !== profile.extractorId ||
    observation.extractorVersion !== profile.extractorVersion ||
    observation.schemaVersion !== profile.schemaVersion ||
    !profile.modalities.includes(observation.modality)
  )
    fail("visual observation does not match the trusted extractor profile");
  const profileHash = toolEnvironmentVisualExtractorProfileHash(profile);
  if (
    observation.extractorProfileHash !== profileHash ||
    findings.extractorProfileHash !== profileHash
  )
    fail("profiled visual findings have the wrong extractor profile");
  if (
    findings.observationCaptureBindingHash !== observation.captureBindingHash ||
    findings.observationAnnotationHash !== observation.annotationHash
  )
    fail(
      "profiled visual findings do not match the trusted visual observation",
    );
  const knownIds = new Set(profile.findings.map((finding) => finding.id));
  if (findings.findingIds.length > profile.maxFindingCount)
    fail("profiled visual findings exceed the trusted profile limit");
  if (findings.findingIds.some((id) => !knownIds.has(id)))
    fail("profiled visual findings contain an unknown finding id");
  if (
    findings.findingBindingHash !==
    toolEnvironmentProfiledVisualFindingsBindingHash(
      observation,
      profileHash,
      findings.findingIds,
    )
  )
    fail("profiled visual findings binding is invalid");
  return { ...findings, findingIds: [...findings.findingIds] };
}

/**
 * Validates and converts a profiled visual extraction into a bounded text-only
 * provider state. This function never calls a provider or a host tool.
 */
export function bindToolEnvironmentVisualTextBridgeState(
  trustedBindingInput: unknown,
  trustedCaptureInput: unknown,
  trustedProfileInput: unknown,
  untrustedEvidenceInput: UntrustedToolEnvironmentProfiledVisualEvidence,
  untrustedFindingEvidenceInput: UntrustedToolEnvironmentVisualFindingEvidence,
  nowEpochMs: number,
): ToolEnvironmentVisualTextBridgeState {
  const profile = parseProfile(trustedProfileInput);
  const observation = bindToolEnvironmentProfiledVisualObservation(
    trustedBindingInput,
    trustedCaptureInput,
    profile,
    untrustedEvidenceInput,
    nowEpochMs,
  );
  const findings = bindToolEnvironmentProfiledVisualFindings(
    observation,
    profile,
    untrustedFindingEvidenceInput,
  );
  const dispositionById = new Map(
    profile.findings.map((finding) => [finding.id, finding.disposition]),
  );
  const evidence = {
    modality: observation.modality,
    artifactHash: observation.artifactHash,
    captureBindingHash: observation.captureBindingHash,
    annotationHash: observation.annotationHash,
    extractorId: observation.extractorId,
    extractorVersion: observation.extractorVersion,
    extractorProfileHash: observation.extractorProfileHash,
    findingBindingHash: findings.findingBindingHash,
    annotations: [...observation.annotations],
    findings: findings.findingIds.map((id) => {
      const disposition = dispositionById.get(id);
      if (disposition === undefined)
        fail("profiled visual finding lost its trusted disposition");
      return { id, disposition };
    }),
    trust: "untrusted_data_only" as const,
  };
  const capturedAt = Date.parse(observation.capturedAt);
  const base = {
    schemaVersion: "1" as const,
    purpose: "visual_evidence_triage_only" as const,
    advisoryOnly: true as const,
    execution: "NOT_SUPPORTED" as const,
    inputModality: "extractor_text_only" as const,
    providerReceivesImage: false as const,
    capturedAt: observation.capturedAt,
    validUntil: new Date(capturedAt + observation.maxAgeMs).toISOString(),
    evidence,
  };
  return freezePlain({
    ...base,
    stateBindingHash: sha256(
      `jev-fabric/visual-text-bridge/v1\0${JSON.stringify(base)}`,
    ),
  });
}

/** Revalidates a retained bridge against the exact trusted capture and clock. */
export function validateToolEnvironmentVisualTextBridgeState(
  stateInput: unknown,
  trustedBindingInput: unknown,
  trustedCaptureInput: unknown,
  trustedProfileInput: unknown,
  nowEpochMs: number,
): ToolEnvironmentVisualTextBridgeState {
  const state = toolEnvironmentVisualTextBridgeStateSchema.parse(
    copyPlainData(stateInput, "visual text bridge state"),
  );
  const rebuilt = bindToolEnvironmentVisualTextBridgeState(
    trustedBindingInput,
    trustedCaptureInput,
    trustedProfileInput,
    { annotations: state.evidence.annotations },
    { findingIds: state.evidence.findings.map((finding) => finding.id) },
    nowEpochMs,
  );
  if (state.evidence.captureBindingHash !== rebuilt.evidence.captureBindingHash)
    fail(
      "visual text bridge does not match the trusted snapshot capture binding",
    );
  if (JSON.stringify(state) !== JSON.stringify(rebuilt))
    fail("visual text bridge state binding is invalid");
  return rebuilt;
}

function parseProfile(input: unknown): ToolEnvironmentVisualExtractorProfile {
  return visualExtractorProfileSchema.parse(
    copyPlainData(input, "trusted visual extractor profile"),
  );
}

function parseProfiledBinding(
  input: unknown,
): TrustedToolEnvironmentProfiledVisualBinding {
  return profiledVisualBindingSchema.parse(
    copyPlainData(input, "trusted profiled visual binding"),
  );
}

function parseProfiledCapture(
  input: unknown,
): TrustedToolEnvironmentProfiledVisualCapture {
  return profiledVisualCaptureSchema.parse(
    copyPlainData(input, "trusted profiled visual capture"),
  );
}

function parseProfiledObservation(
  input: unknown,
): ToolEnvironmentProfiledVisualObservation {
  return profiledVisualObservationSchema.parse(
    copyPlainData(input, "profiled visual observation"),
  );
}

function parseUntrustedAnnotations(
  input: UntrustedToolEnvironmentProfiledVisualEvidence,
): readonly string[] {
  const evidence = copyPlainRecord(input, "untrusted profiled visual evidence");
  if (Object.keys(evidence).length !== 1 || !("annotations" in evidence))
    fail("untrusted profiled visual evidence must contain only annotations");
  if (!Array.isArray(evidence.annotations))
    fail("untrusted profiled visual annotations must be an array");
  const annotations = z
    .array(annotationSchema)
    .min(1)
    .max(32)
    .parse(
      copyPlainData(
        evidence.annotations,
        "untrusted profiled visual annotations",
      ),
    );
  return Object.freeze(annotations);
}

function assertFresh(
  binding: TrustedToolEnvironmentProfiledVisualBinding,
  capture: TrustedToolEnvironmentProfiledVisualCapture,
  nowEpochMs: number,
): void {
  const observedAt = Date.parse(binding.observedAt);
  const capturedAt = Date.parse(capture.capturedAt);
  if (capturedAt < observedAt)
    fail("profiled visual capture predates the trusted snapshot");
  if (capturedAt - observedAt > binding.observationFreshnessMs)
    fail(
      "profiled visual capture is outside the trusted snapshot freshness window",
    );
  if (nowEpochMs < capturedAt || nowEpochMs - capturedAt > capture.maxAgeMs)
    fail("profiled visual capture is stale");
}

function parseUntrustedFindingIds(
  input: UntrustedToolEnvironmentVisualFindingEvidence,
): readonly string[] {
  const evidence = copyPlainRecord(input, "untrusted visual finding evidence");
  if (Object.keys(evidence).length !== 1 || !("findingIds" in evidence))
    fail("untrusted visual finding evidence must contain only findingIds");
  if (!Array.isArray(evidence.findingIds))
    fail("untrusted visual finding ids must be an array");
  return Object.freeze(
    copyStringArray(evidence.findingIds, "untrusted visual finding ids"),
  );
}

function copyPlainRecord(
  input: unknown,
  label: string,
): Record<string, unknown> {
  const value = copyPlainData(input, label);
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label} must be a plain object`);
  return value as Record<string, unknown>;
}

function copyPlainData(
  input: unknown,
  label: string,
  depth = 0,
  budget = { nodes: 0 },
): unknown {
  budget.nodes += 1;
  if (budget.nodes > 4_096) fail(`${label} exceeds the validation node limit`);
  if (depth > 16) fail(`${label} exceeds the validation depth limit`);
  if (input === null || typeof input !== "object") return input;
  if (isProxy(input)) fail(`${label} must not contain proxies`);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string"))
    fail(`${label} must not contain symbols`);
  if (Array.isArray(input)) {
    if (Object.getPrototypeOf(input) !== Array.prototype)
      fail(`${label} arrays must use the default prototype`);
    const allowed = new Set(["length"]);
    const output: unknown[] = [];
    for (let index = 0; index < input.length; index += 1) {
      const key = String(index);
      allowed.add(key);
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !("value" in descriptor))
        fail(`${label} arrays must contain plain data`);
      output.push(copyPlainData(descriptor.value, label, depth + 1, budget));
    }
    if (Object.keys(descriptors).some((key) => !allowed.has(key)))
      fail(`${label} arrays must not contain extra properties`);
    return output;
  }
  const prototype = Object.getPrototypeOf(input) as unknown;
  if (prototype !== Object.prototype && prototype !== null)
    fail(`${label} must be a plain object`);
  const output: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !("value" in descriptor))
      fail(`${label} must contain only enumerable data properties`);
    output[key] = copyPlainData(descriptor.value, label, depth + 1, budget);
  }
  return output;
}

function copyStringArray(input: readonly unknown[], label: string): string[] {
  if (
    isProxy(input) ||
    Object.getPrototypeOf(input) !== Array.prototype ||
    input.length < 1 ||
    input.length > 32
  )
    fail(`${label} must be a bounded plain array`);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const allowed = new Set(["length"]);
  const output: string[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const key = String(index);
    allowed.add(key);
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor))
      fail(`${label} must contain only data values`);
    output.push(identifierSchema.parse(descriptor.value));
  }
  if (Reflect.ownKeys(descriptors).some((key) => !allowed.has(String(key))))
    fail(`${label} contains extra properties`);
  return output;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function freezePlain<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value as Record<string, unknown>))
    freezePlain(child);
  return Object.freeze(value);
}

function fail(message: string): never {
  throw new TypeError(
    `invalid tool-environment visual extractor profile: ${message}`,
  );
}

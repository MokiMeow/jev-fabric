import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";
import { z } from "zod";

/**
 * An offline, advisory binder for visual annotations. It has no image decoder,
 * browser, renderer, filesystem, network, command, or execution capability.
 */
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
const annotationSchema = z
  .string()
  .min(1)
  .max(240)
  .refine((value) => !hasControlCharacter(value), "must be one line");

const visualBindingSchema = z
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
    sessionRef: referenceSchema,
    workspaceRef: referenceSchema,
    stateHash: hashSchema,
    capabilityManifestHash: hashSchema,
    observedAt: z.string().datetime({ offset: true }),
    observationFreshnessMs: z.number().int().nonnegative().max(86_400_000),
  })
  .strict();
export type TrustedToolEnvironmentVisualBinding = z.infer<
  typeof visualBindingSchema
>;

const visualCaptureSchema = z
  .object({
    modality: z.enum(["chart", "browser_viewport", "dcc_viewport"]),
    artifactHash: hashSchema,
    extractorId: identifierSchema,
    extractorVersion: z.string().min(1).max(128),
    schemaVersion: z.literal("1"),
    capturedAt: z.string().datetime({ offset: true }),
    maxAgeMs: z.number().int().nonnegative().max(86_400_000),
  })
  .strict();
export type TrustedToolEnvironmentVisualCapture = z.infer<
  typeof visualCaptureSchema
>;

const visualObservationSchema = visualCaptureSchema
  .extend({
    captureBindingHash: hashSchema,
    annotationHash: hashSchema,
    annotations: z.array(annotationSchema).min(1).max(32),
    trust: z.literal("untrusted_data_only"),
  })
  .strict();
export type ToolEnvironmentVisualObservation = z.infer<
  typeof visualObservationSchema
>;

export interface UntrustedToolEnvironmentVisualEvidence {
  readonly annotations: unknown;
}

/**
 * Binds untrusted, bounded annotations to one trusted snapshot identity.
 * Callers append the result as `visualObservation` to their own snapshot.
 */
export function bindToolEnvironmentVisualObservation(
  trustedBindingInput: unknown,
  trustedCaptureInput: unknown,
  untrustedEvidenceInput: UntrustedToolEnvironmentVisualEvidence,
  nowEpochMs: number,
): ToolEnvironmentVisualObservation {
  const binding = parseBinding(trustedBindingInput);
  const capture = parseCapture(trustedCaptureInput);
  const annotations = parseUntrustedAnnotations(untrustedEvidenceInput);
  const observation = {
    ...capture,
    captureBindingHash: captureBindingHash(binding, capture),
    annotationHash: hashAnnotations(annotations),
    annotations,
    trust: "untrusted_data_only" as const,
  };
  return validateToolEnvironmentVisualObservation(
    observation,
    binding,
    nowEpochMs,
  );
}

/**
 * Rechecks an already-bound observation against a fresh trusted snapshot
 * projection. It does not interpret pixels or execute any environment action.
 */
export function validateToolEnvironmentVisualObservation(
  observationInput: unknown,
  trustedBindingInput: unknown,
  nowEpochMs: number,
): ToolEnvironmentVisualObservation {
  if (!Number.isSafeInteger(nowEpochMs) || nowEpochMs < 0)
    fail("nowEpochMs must be a non-negative safe integer");
  const binding = parseBinding(trustedBindingInput);
  const observation = parseObservation(observationInput);
  assertFresh(binding, observation, nowEpochMs);
  if (
    observation.captureBindingHash !== captureBindingHash(binding, observation)
  )
    fail("capture binding does not match the trusted snapshot");
  if (observation.annotationHash !== hashAnnotations(observation.annotations))
    fail("annotation binding is invalid");
  return {
    ...observation,
    annotations: [...observation.annotations],
  };
}

function assertFresh(
  binding: TrustedToolEnvironmentVisualBinding,
  capture: TrustedToolEnvironmentVisualCapture,
  nowEpochMs: number,
): void {
  const observedAt = Date.parse(binding.observedAt);
  const capturedAt = Date.parse(capture.capturedAt);
  if (capturedAt < observedAt) fail("capture predates the trusted snapshot");
  if (capturedAt - observedAt > binding.observationFreshnessMs)
    fail("capture is outside the trusted snapshot freshness window");
  if (nowEpochMs < capturedAt || nowEpochMs - capturedAt > capture.maxAgeMs)
    fail("visual capture is stale");
}

function captureBindingHash(
  binding: TrustedToolEnvironmentVisualBinding,
  capture: TrustedToolEnvironmentVisualCapture,
): string {
  return sha256(
    JSON.stringify({
      adapterId: binding.adapterId,
      adapterVersion: binding.adapterVersion,
      capabilityManifestHash: binding.capabilityManifestHash,
      capture: {
        artifactHash: capture.artifactHash,
        capturedAt: capture.capturedAt,
        extractorId: capture.extractorId,
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

function hashAnnotations(annotations: readonly string[]): string {
  return sha256(JSON.stringify(annotations));
}

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function parseBinding(input: unknown): TrustedToolEnvironmentVisualBinding {
  return visualBindingSchema.parse(copyPlainRecord(input, "trusted binding"));
}

function parseCapture(input: unknown): TrustedToolEnvironmentVisualCapture {
  return visualCaptureSchema.parse(copyPlainRecord(input, "trusted capture"));
}

function parseObservation(input: unknown): ToolEnvironmentVisualObservation {
  const record = copyPlainRecord(input, "visual observation");
  const annotations = record.annotations;
  if (Array.isArray(annotations))
    record.annotations = copyAnnotations(annotations);
  return visualObservationSchema.parse(record);
}

function parseUntrustedAnnotations(
  input: UntrustedToolEnvironmentVisualEvidence,
): readonly string[] {
  const evidence = copyPlainRecord(input, "untrusted visual evidence");
  if (Object.keys(evidence).length !== 1 || !("annotations" in evidence))
    fail("untrusted visual evidence must contain only annotations");
  if (!Array.isArray(evidence.annotations))
    fail("untrusted visual annotations must be an array");
  return Object.freeze(copyAnnotations(evidence.annotations));
}

function copyPlainRecord(
  input: unknown,
  label: string,
): Record<string, unknown> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    isProxy(input)
  )
    fail(`${label} must be a plain object`);
  const prototype = Object.getPrototypeOf(input) as unknown;
  if (prototype !== Object.prototype && prototype !== null)
    fail(`${label} must be a plain object`);
  if (Object.getOwnPropertySymbols(input).length > 0)
    fail(`${label} must not contain symbols`);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const output: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !("value" in descriptor))
      fail(`${label} must contain only enumerable data properties`);
    output[key] = descriptor.value;
  }
  return output;
}

function copyAnnotations(input: readonly unknown[]): readonly string[] {
  if (isProxy(input)) fail("untrusted visual annotations must not be a proxy");
  if (
    Object.getPrototypeOf(input) !== Array.prototype ||
    input.length < 1 ||
    input.length > 32
  )
    fail("untrusted visual annotations must be a bounded plain array");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const allowed = new Set(["length"]);
  const annotations: string[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const key = String(index);
    allowed.add(key);
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor))
      fail("untrusted visual annotations must contain only data values");
    annotations.push(annotationSchema.parse(descriptor.value));
  }
  if (Reflect.ownKeys(descriptors).some((key) => !allowed.has(String(key))))
    fail("untrusted visual annotations contain extra properties");
  return annotations;
}

function fail(message: string): never {
  throw new TypeError(
    `invalid tool-environment visual observation: ${message}`,
  );
}

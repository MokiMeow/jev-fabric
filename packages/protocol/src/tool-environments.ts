import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";
import { z } from "zod";
import { portableIdentifierSchema } from "./json.js";

/**
 * An advisory vocabulary for integrations with browsers, DCC applications,
 * engines, CAD tools, and comparable local tool environments. It deliberately
 * describes a bounded projection and never describes how to execute it.
 */
export const TOOL_ENVIRONMENT_CONTRACT_VERSION = "1" as const;

const hashSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/u, "must be a SHA-256 hash");
const boundedTextSchema = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (value) => !hasControlCharacter(value),
    "must not contain control characters",
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
const versionSchema = z.string().min(1).max(128);
const opaqueHandleSchema = z
  .string()
  .regex(
    /^ref:[A-Za-z][A-Za-z0-9._:-]{0,127}$/u,
    "must be an opaque reference",
  );

export const toolEnvironmentKindSchema = z.enum([
  "browser",
  "blender",
  "unreal",
  "unity",
  "godot",
  "freecad",
  "generic",
]);
export type ToolEnvironmentKind = z.infer<typeof toolEnvironmentKindSchema>;

export const actionSideEffectSchema = z.enum([
  "read_only",
  "reversible",
  "persistent",
  "external",
]);
export type ActionSideEffect = z.infer<typeof actionSideEffectSchema>;

export const toolEnvironmentTransportSchema = z.enum([
  "browser_webmcp",
  "browser_devtools",
  "native_api",
  "editor_plugin",
  "remote_control_preset",
  "document_transaction",
  "headless_job",
]);
export type ToolEnvironmentTransport = z.infer<
  typeof toolEnvironmentTransportSchema
>;

export const parameterTypeSchema = z.enum([
  "boolean",
  "integer",
  "number",
  "string",
  "enum",
]);
export type ParameterType = z.infer<typeof parameterTypeSchema>;

const enumValueSchema = z.union([
  z.string().max(120),
  z.number().finite(),
  z.boolean(),
]);

/**
 * A parameter declaration is descriptive only. Concrete argument values stay
 * in the trusted adapter and are represented to Jev only by a hash.
 */
export const toolEnvironmentParameterSchema = z
  .object({
    id: portableIdentifierSchema,
    type: parameterTypeSchema,
    required: z.boolean(),
    enumValues: z.array(enumValueSchema).min(1).max(32).optional(),
    minimum: z.number().finite().optional(),
    maximum: z.number().finite().optional(),
    maxLength: z.number().int().positive().max(4096).optional(),
  })
  .strict()
  .superRefine((parameter, context) => {
    if (parameter.type === "enum" && !parameter.enumValues)
      context.addIssue({
        code: "custom",
        message: "enum parameters require enumValues",
        path: ["enumValues"],
      });
    if (parameter.type !== "enum" && parameter.enumValues)
      context.addIssue({
        code: "custom",
        message: "only enum parameters may declare enumValues",
        path: ["enumValues"],
      });
    if (
      parameter.minimum !== undefined &&
      parameter.maximum !== undefined &&
      parameter.minimum > parameter.maximum
    )
      context.addIssue({
        code: "custom",
        message: "minimum must not exceed maximum",
        path: ["minimum"],
      });
    if (
      parameter.type !== "number" &&
      parameter.type !== "integer" &&
      (parameter.minimum !== undefined || parameter.maximum !== undefined)
    )
      context.addIssue({
        code: "custom",
        message: "only numeric parameters may declare bounds",
        path: [parameter.minimum !== undefined ? "minimum" : "maximum"],
      });
    if (
      parameter.type === "integer" &&
      ((parameter.minimum !== undefined &&
        !Number.isSafeInteger(parameter.minimum)) ||
        (parameter.maximum !== undefined &&
          !Number.isSafeInteger(parameter.maximum)))
    )
      context.addIssue({
        code: "custom",
        message: "integer parameter bounds must be safe integers",
        path: ["minimum"],
      });
    if (parameter.type !== "string" && parameter.maxLength !== undefined)
      context.addIssue({
        code: "custom",
        message: "only string parameters may declare maxLength",
        path: ["maxLength"],
      });
  });
export type ToolEnvironmentParameter = z.infer<
  typeof toolEnvironmentParameterSchema
>;

const reservedOperationTerms = [
  "command",
  "shell",
  "script",
  "eval",
  "execute",
  "http",
  "fetch",
  "network",
  "request",
  "url",
  "code",
] as const;

/*
 * Action identifiers are catalogue keys, not an extensibility mechanism. Match
 * reserved terms as substrings so punctuation and casing cannot disguise a
 * generic executor (for example, `executeScript` or `shell_command`). The
 * trusted adapter still owns the positive allowlist of exact action ids.
 */
const isSpecificNativeActionId = (value: string): boolean => {
  const folded = value.toLocaleLowerCase("en-US");
  return !reservedOperationTerms.some((term) => folded.includes(term));
};
const actionIdSchema = portableIdentifierSchema.refine(
  isSpecificNativeActionId,
  "generic command, script, network, and execution actions are forbidden",
);

export const toolEnvironmentCheckSchema = z
  .object({
    id: portableIdentifierSchema,
    description: boundedTextSchema,
  })
  .strict();
export type ToolEnvironmentCheck = z.infer<typeof toolEnvironmentCheckSchema>;

/**
 * A trusted description of a captured visual surface. It deliberately omits
 * image bytes, paths, URLs, selectors, coordinates, and control data. A
 * separate trusted adapter binds it to one exact environment snapshot.
 */
export const toolEnvironmentVisualCaptureSchema = z
  .object({
    modality: z.enum(["chart", "browser_viewport", "dcc_viewport"]),
    artifactHash: hashSchema,
    extractorId: portableIdentifierSchema,
    extractorVersion: versionSchema,
    schemaVersion: z.literal("1"),
    capturedAt: z.string().datetime({ offset: true }),
    maxAgeMs: z.number().int().nonnegative().max(86_400_000),
  })
  .strict();
export type ToolEnvironmentVisualCapture = z.infer<
  typeof toolEnvironmentVisualCaptureSchema
>;

/**
 * A source-bound visual observation. `annotations` are untrusted data only;
 * they cannot grant authority, declare actions, or carry execution details.
 */
export const toolEnvironmentVisualObservationSchema =
  toolEnvironmentVisualCaptureSchema
    .extend({
      captureBindingHash: hashSchema,
      annotationHash: hashSchema,
      annotations: z.array(boundedTextSchema).min(1).max(32),
      trust: z.literal("untrusted_data_only"),
    })
    .strict();
export type ToolEnvironmentVisualObservation = z.infer<
  typeof toolEnvironmentVisualObservationSchema
>;

/**
 * An allowlisted native operation. This is neither a command nor an RPC
 * request: it contains no code, URI, selector, machine path, or arguments.
 */
export const toolEnvironmentActionSchema = z
  .object({
    id: actionIdSchema,
    title: boundedTextSchema,
    sideEffect: actionSideEffectSchema,
    transport: toolEnvironmentTransportSchema,
    parameters: z.array(toolEnvironmentParameterSchema).max(16),
    preconditions: z.array(toolEnvironmentCheckSchema).max(16),
    postconditions: z.array(toolEnvironmentCheckSchema).min(1).max(16),
    requiresApproval: z.boolean(),
    supportsUndo: z.boolean(),
  })
  .strict()
  .superRefine((action, context) => {
    const ids = action.parameters.map((parameter) => parameter.id);
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: "custom",
        message: "parameter ids must be unique",
        path: ["parameters"],
      });
    if (action.sideEffect === "read_only" && action.supportsUndo)
      context.addIssue({
        code: "custom",
        message: "read-only actions cannot support undo",
        path: ["supportsUndo"],
      });
    if (
      (action.sideEffect === "persistent" ||
        action.sideEffect === "external") &&
      !action.requiresApproval
    )
      context.addIssue({
        code: "custom",
        message: "persistent and external actions require approval",
        path: ["requiresApproval"],
      });
  });
export type ToolEnvironmentAction = z.infer<typeof toolEnvironmentActionSchema>;

/**
 * Trusted, code-reviewed positive catalogue. It must be supplied by the host
 * adapter, never by a model, page, project file, or remote request.
 */
export const trustedToolEnvironmentCatalogueSchema = z
  .object({
    environment: toolEnvironmentKindSchema,
    adapterId: portableIdentifierSchema,
    adapterVersion: versionSchema,
    capabilityManifestHash: hashSchema,
    actions: z.array(toolEnvironmentActionSchema).min(1).max(64),
  })
  .strict()
  .superRefine((catalogue, context) => {
    const ids = catalogue.actions.map((action) => action.id);
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: "custom",
        message: "trusted catalogue action ids must be unique",
        path: ["actions"],
      });
  });
export type TrustedToolEnvironmentCatalogue = z.infer<
  typeof trustedToolEnvironmentCatalogueSchema
>;

/** A redacted, freshness-bound projection owned by a trusted adapter. */
export const toolEnvironmentSnapshotSchema = z
  .object({
    contractVersion: z.literal(TOOL_ENVIRONMENT_CONTRACT_VERSION),
    environment: toolEnvironmentKindSchema,
    adapterId: portableIdentifierSchema,
    adapterVersion: versionSchema,
    sessionRef: opaqueHandleSchema,
    workspaceRef: opaqueHandleSchema,
    stateHash: hashSchema,
    capabilityManifestHash: hashSchema,
    observedAt: z.string().datetime({ offset: true }),
    observationFreshnessMs: z.number().int().nonnegative().max(86_400_000),
    selectedRefs: z.array(opaqueHandleSchema).max(128),
    dirty: z.boolean(),
    undoAvailable: z.boolean(),
    actions: z.array(toolEnvironmentActionSchema).min(1).max(64),
    visualObservation: toolEnvironmentVisualObservationSchema.optional(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const ids = snapshot.actions.map((action) => action.id);
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: "custom",
        message: "action ids must be unique",
        path: ["actions"],
      });
  });
export type ToolEnvironmentSnapshot = z.infer<
  typeof toolEnvironmentSnapshotSchema
>;

/**
 * Computes the only valid capture binding for a visual observation. The tuple
 * intentionally includes the complete environment identity and freshness
 * projection so a visually valid artifact cannot be replayed onto another
 * browser frame, scene, document, or capability catalogue.
 */
export function toolEnvironmentVisualCaptureBindingHash(
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
  capture: ToolEnvironmentVisualCapture,
): string {
  return `sha256:${sha256Hex(
    JSON.stringify({
      adapterId: snapshot.adapterId,
      adapterVersion: snapshot.adapterVersion,
      capabilityManifestHash: snapshot.capabilityManifestHash,
      capture: {
        artifactHash: capture.artifactHash,
        capturedAt: capture.capturedAt,
        extractorId: capture.extractorId,
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
  )}`;
}

/** Hashes the exact bounded annotation array without retaining visual content. */
export function toolEnvironmentVisualAnnotationHash(
  annotations: readonly string[],
): string {
  return `sha256:${sha256Hex(JSON.stringify(annotations))}`;
}

/** Uses Node's vetted SHA-256 implementation at the protocol boundary. */
function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function assertVisualObservationBinding(
  snapshot: ToolEnvironmentSnapshot,
  observation: ToolEnvironmentVisualObservation,
  observedNowMs?: number,
): void {
  const observedAt = Date.parse(snapshot.observedAt);
  const capturedAt = Date.parse(observation.capturedAt);
  if (capturedAt < observedAt)
    throw new TypeError("visual capture predates the trusted snapshot");
  if (capturedAt - observedAt > snapshot.observationFreshnessMs)
    throw new TypeError(
      "visual capture is outside the trusted snapshot freshness window",
    );
  if (
    observation.captureBindingHash !==
    toolEnvironmentVisualCaptureBindingHash(snapshot, observation)
  )
    throw new TypeError(
      "visual capture binding does not match the trusted snapshot",
    );
  if (
    observation.annotationHash !==
    toolEnvironmentVisualAnnotationHash(observation.annotations)
  )
    throw new TypeError("visual annotation binding is invalid");
  if (observedNowMs === undefined)
    throw new TypeError(
      "observedNowMs is required for a visual observation freshness check",
    );
  if (!Number.isSafeInteger(observedNowMs) || observedNowMs < 0)
    throw new TypeError("observedNowMs must be a non-negative safe integer");
  if (
    observedNowMs < capturedAt ||
    observedNowMs - capturedAt > observation.maxAgeMs
  )
    throw new TypeError("visual capture is stale");
}

function assertTrustedVisualCapture(
  observation: ToolEnvironmentVisualObservation,
  trustedCapture: ToolEnvironmentVisualCapture,
): void {
  const projectedObservation = {
    modality: observation.modality,
    artifactHash: observation.artifactHash,
    extractorId: observation.extractorId,
    extractorVersion: observation.extractorVersion,
    schemaVersion: observation.schemaVersion,
    capturedAt: observation.capturedAt,
    maxAgeMs: observation.maxAgeMs,
  } satisfies ToolEnvironmentVisualCapture;
  if (JSON.stringify(projectedObservation) !== JSON.stringify(trustedCapture))
    throw new TypeError(
      "visual observation does not match the independently trusted capture",
    );
}

const MAX_VALIDATION_NODES = 4_096;
const MAX_VALIDATION_DEPTH = 16;

/**
 * Snapshots JSON-like validation input without invoking accessors or proxy
 * traps. Zod validation happens only after this descriptor-only copy.
 */
function snapshotPlainData(input: unknown, label: string): unknown {
  const budget = { nodes: 0 };
  return copyPlainData(input, label, 0, budget);
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
    if (input.length > MAX_VALIDATION_NODES)
      throw new TypeError(`${label} exceeds the validation array limit`);
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
  const keys = Object.keys(descriptors);
  if (keys.length > 256)
    throw new TypeError(`${label} exceeds the validation object-key limit`);
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor))
      throw new TypeError(`${label} must contain plain enumerable data`);
    output[key] = copyPlainData(descriptor.value, label, depth + 1, budget);
  }
  return output;
}

/**
 * Validates a snapshot against an independently supplied, exact positive
 * catalogue. The structural schema alone is never an authorization allowlist.
 */
export function validateToolEnvironmentSnapshot(
  input: unknown,
  trustedCatalogueInput: unknown,
  observedNowMs?: number,
  trustedVisualCaptureInput?: unknown,
): ToolEnvironmentSnapshot {
  const snapshot = toolEnvironmentSnapshotSchema.parse(
    snapshotPlainData(input, "tool environment snapshot"),
  );
  const catalogue = trustedToolEnvironmentCatalogueSchema.parse(
    snapshotPlainData(
      trustedCatalogueInput,
      "trusted tool environment catalogue",
    ),
  );
  if (
    snapshot.environment !== catalogue.environment ||
    snapshot.adapterId !== catalogue.adapterId ||
    snapshot.adapterVersion !== catalogue.adapterVersion ||
    snapshot.capabilityManifestHash !== catalogue.capabilityManifestHash
  )
    throw new TypeError(
      "tool environment snapshot does not match the trusted catalogue identity",
    );
  const trustedActions = new Map(
    catalogue.actions.map((action) => [action.id, JSON.stringify(action)]),
  );
  if (
    snapshot.actions.length !== trustedActions.size ||
    snapshot.actions.some(
      (action) => trustedActions.get(action.id) !== JSON.stringify(action),
    )
  )
    throw new TypeError(
      "tool environment snapshot action catalogue is not an exact trusted match",
    );
  const trustedVisualCapture =
    trustedVisualCaptureInput === undefined
      ? undefined
      : toolEnvironmentVisualCaptureSchema.parse(
          snapshotPlainData(
            trustedVisualCaptureInput,
            "trusted visual capture",
          ),
        );
  if (
    (snapshot.visualObservation === undefined) !==
    (trustedVisualCapture === undefined)
  )
    throw new TypeError(
      "visual observations require one independently trusted capture",
    );
  if (snapshot.visualObservation && trustedVisualCapture) {
    assertTrustedVisualCapture(
      snapshot.visualObservation,
      trustedVisualCapture,
    );
    assertVisualObservationBinding(
      snapshot,
      snapshot.visualObservation,
      observedNowMs,
    );
  }
  return snapshot;
}

/**
 * The only action-shaped value Jev may receive or return. `advisory: true`
 * makes clear that host policy and a trusted adapter remain in control.
 */
export const toolEnvironmentProposalSchema = z
  .object({
    advisory: z.literal(true),
    adapterId: portableIdentifierSchema,
    adapterVersion: versionSchema,
    sessionRef: opaqueHandleSchema,
    workspaceRef: opaqueHandleSchema,
    actionId: actionIdSchema,
    argumentsHash: hashSchema,
    stateHash: hashSchema,
    capabilityManifestHash: hashSchema,
    evidenceHash: hashSchema,
  })
  .strict();
export type ToolEnvironmentProposal = z.infer<
  typeof toolEnvironmentProposalSchema
>;

export interface ValidatedToolEnvironmentProposal {
  readonly snapshot: ToolEnvironmentSnapshot;
  readonly proposal: ToolEnvironmentProposal;
  readonly action: ToolEnvironmentAction;
}

/**
 * Performs the mandatory exact-catalogue, identity, state, capability, and
 * freshness checks. Authorization, approval, tickets, and argument resolution
 * remain responsibilities of the trusted host after this validation.
 */
export function validateToolEnvironmentProposal(
  proposalInput: unknown,
  snapshotInput: unknown,
  trustedCatalogueInput: unknown,
  observedNowMs: number,
  trustedVisualCaptureInput?: unknown,
): ValidatedToolEnvironmentProposal {
  if (!Number.isSafeInteger(observedNowMs) || observedNowMs < 0)
    throw new TypeError("observedNowMs must be a non-negative safe integer");
  const snapshot = validateToolEnvironmentSnapshot(
    snapshotInput,
    trustedCatalogueInput,
    observedNowMs,
    trustedVisualCaptureInput,
  );
  const proposal = toolEnvironmentProposalSchema.parse(
    snapshotPlainData(proposalInput, "tool environment proposal"),
  );
  if (
    proposal.adapterId !== snapshot.adapterId ||
    proposal.adapterVersion !== snapshot.adapterVersion ||
    proposal.sessionRef !== snapshot.sessionRef ||
    proposal.workspaceRef !== snapshot.workspaceRef ||
    proposal.stateHash !== snapshot.stateHash ||
    proposal.capabilityManifestHash !== snapshot.capabilityManifestHash
  )
    throw new TypeError(
      "tool environment proposal does not match its trusted snapshot binding",
    );
  const observedAtMs = Date.parse(snapshot.observedAt);
  if (
    observedNowMs < observedAtMs ||
    observedNowMs - observedAtMs > snapshot.observationFreshnessMs
  )
    throw new TypeError("tool environment snapshot observation is stale");
  const action = snapshot.actions.find(
    (candidate) => candidate.id === proposal.actionId,
  );
  if (!action)
    throw new TypeError(
      "tool environment proposal action is absent from the trusted catalogue",
    );
  return { snapshot, proposal, action };
}

export const toolEnvironmentVerificationSchema = z
  .object({
    actionId: actionIdSchema,
    stateHash: hashSchema,
    evidenceHash: hashSchema,
    outcome: z.enum(["observed", "not_observed", "indeterminate"]),
    undoOutcome: z.enum(["not_applicable", "available", "observed", "failed"]),
    redacted: z.literal(true),
  })
  .strict();
export type ToolEnvironmentVerification = z.infer<
  typeof toolEnvironmentVerificationSchema
>;

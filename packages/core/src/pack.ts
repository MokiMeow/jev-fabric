import type {
  DecisionQuestion,
  ProviderCapabilities,
} from "@mokimeow/jev-fabric-protocol";
import type { CandidateProvider } from "./candidates.js";
import type { StateLimits, StateProjector } from "./context.js";

export type PackRiskTier = "low" | "medium" | "high" | "critical";
export type EmptyCandidateBehavior = "no_match" | "abstain" | "unavailable";
export type PackFailureOutcome =
  | "abstain"
  | "unavailable"
  | "escalate"
  | "deny";

export interface PackLimits extends StateLimits {
  readonly maxCandidates: number;
  readonly maxCandidateIdLength: number;
  readonly maxCandidateDescriptionBytes: number;
}
export interface PackCapabilities {
  readonly questionTypes: readonly ("choice" | "noul" | "score")[];
  readonly probabilitySemantics: readonly (
    | "native_calibrated"
    | "normalized_logits"
    | "self_reported"
    | "synthetic"
    | "unknown"
  )[];
}
export interface PackManifest {
  readonly id: string;
  readonly version: string;
  readonly riskTier: PackRiskTier;
  readonly limits: PackLimits;
  readonly candidateBehavior: EmptyCandidateBehavior;
  readonly failure: {
    readonly outage: PackFailureOutcome;
    readonly providerFailure: PackFailureOutcome;
  };
  readonly requiredCapabilities: PackCapabilities;
  readonly evidence: {
    readonly projectorId: string;
    readonly revision: string;
  };
}
export interface DeterministicBypass {
  readonly outcome:
    | PackFailureOutcome
    | "allow"
    | "deny"
    | "ask"
    | "route"
    | "retry";
  readonly reasonCode: string;
}
export interface PackInterpretContext {
  readonly providerId: string;
  readonly model: string;
  readonly probabilitySemantics: import("@mokimeow/jev-fabric-protocol").ProbabilitySemantics;
}
export interface PackImplementations {
  readonly projector: StateProjector;
  readonly candidates: CandidateProvider;
  readonly bypass?: (state: unknown) => DeterministicBypass | undefined;
  readonly questions: (
    state: unknown,
    candidates: readonly {
      readonly id: string;
      readonly description: string;
    }[],
  ) => readonly DecisionQuestion[];
  readonly interpret: (
    answers: readonly import("@mokimeow/jev-fabric-protocol").DecisionAnswer[],
    candidates: readonly {
      readonly id: string;
      readonly description: string;
    }[],
    context?: PackInterpretContext,
  ) => PackSemanticResult;
}
export interface PackSemanticResult {
  readonly status: "decision" | "no_match" | "abstain" | "unavailable";
  readonly proposedOutcome:
    | "allow"
    | "route"
    | "ask"
    | "abstain"
    | "unavailable"
    | "escalate"
    | "deny";
  readonly selectedId?: string;
  readonly metadata: Readonly<
    Record<string, import("@mokimeow/jev-fabric-protocol").JsonValue>
  >;
}
export interface DecisionPack {
  readonly manifest: Readonly<PackManifest>;
  readonly implementations?: Readonly<PackImplementations>;
}

const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const allowed = new Set([
  "id",
  "version",
  "riskTier",
  "limits",
  "candidateBehavior",
  "failure",
  "requiredCapabilities",
  "evidence",
]);

/** Registers trusted code separately from a strict, portable data-only manifest. */
export function definePack(
  input: PackManifest,
  implementations?: PackImplementations,
): DecisionPack {
  const manifest = snapshotManifest(input);
  validateManifest(manifest);
  if (implementations !== undefined) validateImplementations(implementations);
  return Object.freeze({
    manifest: deepFreeze(manifest),
    ...(implementations === undefined
      ? {}
      : { implementations: Object.freeze(implementations) }),
  });
}

export function assertProviderCapabilities(
  pack: DecisionPack,
  capabilities: ProviderCapabilities,
): void {
  const required = pack.manifest.requiredCapabilities;
  if (
    required.questionTypes.some(
      (type) => !capabilities.questionTypes.includes(type),
    ) ||
    !required.probabilitySemantics.some((semantics) =>
      capabilities.probabilitySemantics.includes(semantics),
    )
  )
    throw new RangeError("provider capabilities are incompatible with pack");
}

/** Freezes a finite registry and rejects ambiguity from duplicate stable IDs. */
export function definePackRegistry(
  packs: readonly DecisionPack[],
): ReadonlyMap<string, DecisionPack> {
  const registry = new Map<string, DecisionPack>();
  for (const pack of packs) {
    if (registry.has(pack.manifest.id))
      throw new RangeError(`duplicate pack id: ${pack.manifest.id}`);
    registry.set(pack.manifest.id, pack);
  }
  return registry;
}

function snapshotManifest(input: PackManifest): PackManifest {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("pack manifest must be an object");
  const record = input as unknown as Record<string, unknown>;
  for (const key of Object.keys(record))
    if (!allowed.has(key))
      throw new TypeError(`unsupported field in pack manifest: ${key}`);
  rejectUnsafe(record);
  return JSON.parse(JSON.stringify(record)) as PackManifest;
}

function validateManifest(manifest: PackManifest): void {
  if (!/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u.test(manifest.id))
    throw new RangeError("pack id must be a portable identifier");
  if (!semver.test(manifest.version))
    throw new RangeError("pack version must be a semantic version");
  if (
    !(["low", "medium", "high", "critical"] as const).includes(
      manifest.riskTier,
    )
  )
    throw new RangeError("pack riskTier is invalid");
  if (
    !(["no_match", "abstain", "unavailable"] as const).includes(
      manifest.candidateBehavior,
    )
  )
    throw new RangeError("pack candidateBehavior is required");
  if (
    !exactKeys(manifest.failure, ["outage", "providerFailure"]) ||
    !validFailure(manifest.failure.outage) ||
    !validFailure(manifest.failure.providerFailure)
  )
    throw new RangeError("pack failure behavior is invalid");
  if (
    !exactKeys(manifest.evidence, ["projectorId", "revision"]) ||
    !portable(manifest.evidence.projectorId) ||
    !manifest.evidence.revision
  )
    throw new RangeError("pack evidence projection is invalid");
  if (
    !exactKeys(manifest.limits, [
      "maxStateBytes",
      "maxStateDepth",
      "maxStateItems",
      "maxStringBytes",
      "maxCandidates",
      "maxCandidateIdLength",
      "maxCandidateDescriptionBytes",
    ])
  )
    throw new RangeError("pack limits schema is invalid");
  for (const [key, value] of Object.entries(manifest.limits))
    if (!Number.isSafeInteger(value) || (value as number) <= 0)
      throw new RangeError(`pack limit ${key} must be a positive safe integer`);
  const caps = manifest.requiredCapabilities;
  if (
    !exactKeys(caps, ["questionTypes", "probabilitySemantics"]) ||
    !nonEmptyUnique(caps.questionTypes, ["choice", "noul", "score"]) ||
    !nonEmptyUnique(caps.probabilitySemantics, [
      "native_calibrated",
      "normalized_logits",
      "self_reported",
      "synthetic",
      "unknown",
    ])
  )
    throw new RangeError("pack requiredCapabilities are invalid");
}

function exactKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as object).length === keys.length &&
    keys.every((key) => Object.hasOwn(value as object, key))
  );
}
function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value as Record<string, unknown>))
    deepFreeze(child);
  return Object.freeze(value);
}

function validateImplementations(value: PackImplementations): void {
  if (
    !value ||
    typeof value.projector?.project !== "function" ||
    typeof value.candidates?.provide !== "function" ||
    typeof value.questions !== "function" ||
    typeof value.interpret !== "function" ||
    (value.bypass !== undefined && typeof value.bypass !== "function")
  )
    throw new TypeError("pack implementations must be trusted callbacks");
}
function rejectUnsafe(value: unknown): void {
  if (typeof value === "function")
    throw new TypeError(
      "external pack definitions cannot contain executable fields",
    );
  if (typeof value === "string") {
    if (
      /^(?:https?:|file:|data:|javascript:)/iu.test(value) ||
      /(?:-----BEGIN|api[_-]?key|secret|bearer\s)/iu.test(value)
    )
      throw new TypeError(
        "external pack definitions cannot contain URLs or secrets",
      );
    if (/(?:\bfunction\b|=>|\bimport\s|\brequire\s*\()/u.test(value))
      throw new TypeError(
        "external pack definitions cannot contain executable strings",
      );
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (
      /^(?:command|code|url|headers?|secret|authority|authorization|token)$/iu.test(
        key,
      )
    )
      throw new TypeError(
        "external pack definitions cannot contain executable or authority fields",
      );
    rejectUnsafe(child);
  }
}
function validFailure(value: unknown): value is PackFailureOutcome {
  return ["abstain", "unavailable", "escalate", "deny"].includes(
    value as string,
  );
}
function portable(value: unknown): value is string {
  return (
    typeof value === "string" && /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u.test(value)
  );
}
function nonEmptyUnique(
  value: unknown,
  allowedValues: readonly string[],
): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    new Set(value).size === value.length &&
    value.every((item) => allowedValues.includes(item))
  );
}

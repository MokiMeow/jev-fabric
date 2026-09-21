import { canonicalize } from "./canonical.js";
import { isRecognizableActionTicket } from "./ticket.js";
import type { JsonValue } from "@mokimeow/jev-fabric-protocol";

export interface StateLimits {
  readonly maxStateBytes: number;
  readonly maxStateDepth: number;
  readonly maxStateItems: number;
  readonly maxStringBytes: number;
}

export interface StateProjectContext {
  /** Trusted evaluation-start time supplied by the runtime. */
  readonly nowEpochMs: number;
}

export interface StateProjector<Input = unknown> {
  project(input: Input, context: StateProjectContext): unknown;
  /**
   * Optional trusted hash of host evidence intentionally omitted from the
   * provider state. The runtime commits this value into receipt and cache
   * identity without sending it to the provider.
   */
  bindingHash?(input: Input, context: StateProjectContext): unknown;
  /**
   * Deliberate, reviewed escape hatch for a trusted in-process projection.
   * Built-in packs never enable this: callers must never use it for MCP,
   * provider credentials, or host-supplied decision state. The default public
   * boundary accepts ASCII field names only; multilingual content belongs in
   * values. This opt-out is the sole exception to that key policy.
   */
  readonly unsafeAllowSecretState?: { readonly justification: string };
}

export interface ProjectedStateWithBinding {
  readonly state: JsonValue;
  readonly bindingHash?: `sha256:${string}`;
}

const sha256BindingHash = /^sha256:[a-f0-9]{64}$/u;

const protectedKeys = new Set([
  "principalid",
  "tenantid",
  "workspaceid",
  "resourcescopes",
  "actionscopes",
  "permissionepoch",
  "approvalreferences",
  "expiresat",
  "authorization",
  "authority",
  "ticket",
]);

const secretKeys = new Set([
  "apikey",
  "xapikey",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "credential",
  "credentials",
  "accesskey",
  "clientsecret",
  "privatekey",
  "privatekeypem",
  "password",
  "passphrase",
  "secret",
  "signingkey",
  "token",
  "ticket",
]);
// These are intentionally conservative format recognizers, not entropy tests:
// they reject only credential envelopes that have an unambiguous syntax.
const bearerPattern = /\bBearer\s+[^\s,;]{8,}/iu;
const jwtPattern =
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u;
const actionTicketPattern =
  /\bv1\.[A-Za-z][A-Za-z0-9_:-]{0,127}\.[A-Za-z0-9_-]{1,8143}\.[A-Za-z0-9_-]{43}\b/u;
const providerKeyPattern =
  /\b(?:sk|rk|pk|apikey|api[_-]?key|ghp|github_pat|xai)[_-][A-Za-z0-9_-]{12,}\b/iu;

export interface StateCompileOptions {
  /**
   * See StateProjector. This is the sole exception to the default ASCII public
   * key policy and must be a non-empty review justification.
   */
  readonly unsafeAllowSecretState?: { readonly justification: string };
}

/** Produces a bounded, JSON-only evidence snapshot; authority is never projectable. */
export function compileState(
  input: unknown,
  limits: StateLimits,
  options: StateCompileOptions = {},
): JsonValue {
  assertLimits(limits);
  const snapshot = JSON.parse(canonicalize(input)) as unknown;
  const measured = { items: 0 };
  const unsafe = options.unsafeAllowSecretState;
  if (unsafe !== undefined && !validUnsafeJustification(unsafe.justification))
    throw new TypeError(
      "unsafe secret-state opt-out requires a review justification",
    );
  inspect(snapshot, limits, measured, 0, unsafe !== undefined);
  if (Buffer.byteLength(canonicalize(snapshot), "utf8") > limits.maxStateBytes)
    throw new RangeError("projected state exceeds maxStateBytes");
  return freeze(snapshot) as JsonValue;
}

function freeze(value: unknown): unknown {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value as Record<string, unknown>))
    freeze(child);
  return Object.freeze(value);
}

export function projectState<Input>(
  projector: StateProjector<Input>,
  input: Input,
  limits: StateLimits,
  context: StateProjectContext,
): JsonValue {
  if (!projector || typeof projector.project !== "function")
    throw new TypeError("a trusted state projector is required");
  if (!Number.isFinite(context.nowEpochMs))
    throw new TypeError("state projection time must be finite");
  const trustedContext = Object.freeze({ nowEpochMs: context.nowEpochMs });
  return compileState(projector.project(input, trustedContext), limits, {
    ...(projector.unsafeAllowSecretState === undefined
      ? {}
      : { unsafeAllowSecretState: projector.unsafeAllowSecretState }),
  });
}

export function projectStateWithBinding<Input>(
  projector: StateProjector<Input>,
  input: Input,
  limits: StateLimits,
  context: StateProjectContext,
): Readonly<ProjectedStateWithBinding> {
  const state = projectState(projector, input, limits, context);
  if (projector.bindingHash === undefined) return Object.freeze({ state });
  const trustedContext = Object.freeze({ nowEpochMs: context.nowEpochMs });
  const bindingHash = projector.bindingHash(input, trustedContext);
  if (typeof bindingHash !== "string" || !sha256BindingHash.test(bindingHash))
    throw new TypeError(
      "trusted state projection binding hash must be canonical SHA-256",
    );
  return Object.freeze({
    state,
    bindingHash: bindingHash as `sha256:${string}`,
  });
}

/**
 * Rejects credential-bearing public decision state without mutating or
 * redacting it. Public field names are bounded ASCII schema keys; multilingual
 * content belongs in values, not field names.
 */
export function assertSafeDecisionState(value: unknown): void {
  inspectSecretState(value);
}

function inspect(
  value: unknown,
  limits: StateLimits,
  measured: { items: number },
  depth: number,
  allowSecrets: boolean,
): void {
  if (depth > limits.maxStateDepth)
    throw new RangeError("projected state exceeds maxStateDepth");
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") > limits.maxStringBytes)
      throw new RangeError("projected state string exceeds maxStringBytes");
    if (!allowSecrets && isSecretValue(value))
      throw new TypeError(
        "projected state cannot contain credentials or action tickets",
      );
    return;
  }
  if (value === null || typeof value !== "object") return;
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value);
  for (const [key, child] of entries) {
    measured.items += 1;
    if (measured.items > limits.maxStateItems)
      throw new RangeError("projected state exceeds maxStateItems");
    if (!allowSecrets) assertPublicStateKey(key);
    if (protectedKeys.has(normalizeStateKey(key)))
      throw new TypeError("projected state cannot contain authority fields");
    if (!allowSecrets && isSecretKey(key))
      throw new TypeError(
        "projected state cannot contain secret-bearing fields",
      );
    inspect(child, limits, measured, depth + 1, allowSecrets);
  }
}

function inspectSecretState(value: unknown): void {
  const pending: unknown[] = [value];
  const seen = new WeakSet<object>();
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "string") {
      if (isSecretValue(current))
        throw new TypeError(
          "decision state cannot contain credentials or action tickets",
        );
      continue;
    }
    if (!current || typeof current !== "object") continue;
    if (seen.has(current))
      throw new TypeError("decision state must be acyclic");
    seen.add(current);
    for (const [key, child] of Object.entries(current)) {
      visited += 1;
      // This guard is finite even when called before a pack's own limits.
      if (visited > 10_000)
        throw new RangeError("decision state exceeds inspection limit");
      assertPublicStateKey(key);
      if (protectedKeys.has(normalizeStateKey(key)))
        throw new TypeError("decision state cannot contain authority fields");
      if (isSecretKey(key))
        throw new TypeError(
          "decision state cannot contain secret-bearing fields",
        );
      pending.push(child);
    }
  }
}

function isSecretKey(key: string): boolean {
  return secretKeys.has(normalizeStateKey(key));
}

const maxPublicStateKeyBytes = 128;
// Public state is schema-like data, not a free-form localization surface. This
// allows common JSON naming conventions while keeping normalization finite and
// removing the Unicode confusable class from the default trust boundary.
const publicStateKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:/ -]{0,127}$/u;

function assertPublicStateKey(key: string): void {
  if (
    Buffer.byteLength(key, "utf8") > maxPublicStateKeyBytes ||
    !publicStateKeyPattern.test(key)
  )
    throw new TypeError("decision state contains invalid field names");
}

/** Canonicalizes a bounded ASCII schema key for boundary comparisons. */
function normalizeStateKey(key: string): string {
  return key.replace(/[^A-Za-z0-9]/gu, "").toLowerCase();
}

function isSecretValue(value: string): boolean {
  return (
    bearerPattern.test(value) ||
    jwtPattern.test(value) ||
    providerKeyPattern.test(value) ||
    actionTicketPattern.test(value) ||
    isRecognizableActionTicket(value)
  );
}

function validUnsafeJustification(value: string): boolean {
  return (
    Buffer.byteLength(value, "utf8") >= 12 &&
    Buffer.byteLength(value, "utf8") <= 256
  );
}

function assertLimits(limits: StateLimits): void {
  for (const [key, value] of Object.entries(limits))
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new RangeError(`${key} must be a positive safe integer`);
}

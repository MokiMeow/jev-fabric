import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { canonicalize } from "./canonical.js";

const TICKET_VERSION = "v1";
const MAX_TICKET_BYTES = 8192;
const MAC_BYTES = 32;
const NONCE_BYTES = 16;
const DEFAULT_MAX_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_OUTSTANDING_NONCES = 1024;
const ABSOLUTE_MAX_TTL_MS = 24 * 60 * 60 * 1000;
const ABSOLUTE_MAX_OUTSTANDING_NONCES = 4096;
const MAX_CLAIM_FIELD_BYTES = 8192;
const MAX_ARGUMENT_BYTES = 4096;

export interface TicketSigningKey {
  readonly id: string;
  /** Host-provided random 256-bit HMAC key; this material must never be telemetered. */
  readonly secret: Uint8Array;
}

export interface ReplayStore {
  /** Atomically returns true only for the first successful claim of a nonce before expiry. */
  claim(nonce: string, expiresAt: number, now: number): Promise<boolean>;
}

export interface TicketBinding {
  readonly principalId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly action: string;
  readonly capability?: string;
  readonly arguments?: unknown;
  readonly scope?: string;
  readonly stateHash: string;
  readonly evidenceHash: string;
  readonly permissionEpoch: string;
  readonly policyEpoch: string;
  /** A host-selected approval reference, or null when policy explicitly allows no approval. */
  readonly approvalReference: string | null;
  readonly audience: string;
}

export interface ActionTicketRequest extends TicketBinding {
  readonly expiresAt: number;
}

export interface ActionTicketIssuerOptions {
  readonly keys: readonly TicketSigningKey[];
  readonly activeKeyId: string;
  readonly clock: () => number;
  readonly nonceSource: () => Uint8Array;
  readonly maxTtlMs?: number;
  readonly maxOutstandingNonces?: number;
}

export interface ActionTicketVerifierOptions {
  readonly keys: readonly TicketSigningKey[];
  readonly clock: () => number;
  readonly replayStore: ReplayStore;
}

interface TicketClaims extends TicketBinding {
  readonly actionArgumentsHash?: string;
  readonly expiresAt: number;
  readonly issuedAt: number;
  readonly keyId: string;
  readonly nonce: string;
}

export type TicketVerification =
  | { readonly ok: true; readonly claims: Readonly<TicketClaims> }
  | {
      readonly ok: false;
      readonly reasonCode:
        | "MALFORMED_TICKET"
        | "UNKNOWN_KEY"
        | "INVALID_SIGNATURE"
        | "EXPIRED"
        | "BINDING_MISMATCH"
        | "REPLAYED";
    };

/**
 * Identifies the canonical public envelope emitted by ActionTicketIssuer without
 * checking its signature. Consumers such as telemetry redaction use this to
 * recognize tickets without receiving signing keys.
 */
export function isRecognizableActionTicket(ticket: string): boolean {
  const parsed = parseTicket(ticket);
  return (
    parsed !== undefined &&
    parseClaims(parsed.payload, parsed.keyId) !== undefined
  );
}

/** Issues canonical HMAC-SHA-256 tickets from injected host key, clock, and nonce sources. */
export class ActionTicketIssuer {
  private readonly keys: Map<string, TicketSigningKey>;
  private readonly issuedNonces = new Map<string, number>();
  private readonly expiryHeap: NonceExpiry[] = [];
  private readonly maxTtlMs: number;
  private readonly maxOutstandingNonces: number;

  constructor(private readonly options: ActionTicketIssuerOptions) {
    this.keys = indexKeys(options.keys);
    if (!this.keys.has(options.activeKeyId))
      throw new TypeError("active key is unknown");
    this.maxTtlMs = boundedPositiveInteger(
      options.maxTtlMs ?? DEFAULT_MAX_TTL_MS,
      "invalid maximum ticket ttl",
      ABSOLUTE_MAX_TTL_MS,
    );
    this.maxOutstandingNonces = boundedPositiveInteger(
      options.maxOutstandingNonces ?? DEFAULT_MAX_OUTSTANDING_NONCES,
      "invalid outstanding nonce capacity",
      ABSOLUTE_MAX_OUTSTANDING_NONCES,
    );
  }

  issue(request: ActionTicketRequest): string {
    const issuedAt = validTime(
      this.options.clock(),
      "clock returned invalid time",
    );
    if (
      !Number.isSafeInteger(request.expiresAt) ||
      request.expiresAt <= issuedAt
    )
      throw new TypeError("ticket expiry must be an absolute future time");
    if (request.expiresAt - issuedAt > this.maxTtlMs)
      throw new TypeError("ticket ttl exceeds maximum");
    assertBinding(request);
    const nonceBytes = this.options.nonceSource();
    if (
      !(nonceBytes instanceof Uint8Array) ||
      nonceBytes.byteLength !== NONCE_BYTES
    )
      throw new TypeError("nonce source must provide 128 bits");
    this.removeExpiredNonces(issuedAt);
    const nonce = Buffer.from(nonceBytes).toString("base64url");
    if (this.issuedNonces.has(nonce)) throw new TypeError("duplicate nonce");
    if (this.issuedNonces.size >= this.maxOutstandingNonces)
      throw new TypeError("outstanding nonce capacity exceeded");
    const key = this.keys.get(this.options.activeKeyId);
    if (!key) throw new TypeError("active key is unknown");
    const claims: TicketClaims = {
      ...withoutArguments(request),
      ...(request.arguments === undefined
        ? {}
        : { actionArgumentsHash: hashActionArguments(request.arguments) }),
      expiresAt: request.expiresAt,
      issuedAt,
      keyId: key.id,
      nonce,
    };
    const payload = Buffer.from(canonicalize(claims), "utf8").toString(
      "base64url",
    );
    const signingInput = `${TICKET_VERSION}.${key.id}.${payload}`;
    const mac = sign(key.secret, signingInput);
    const ticket = `${signingInput}.${mac.toString("base64url")}`;
    if (Buffer.byteLength(ticket, "utf8") > MAX_TICKET_BYTES)
      throw new TypeError("ticket exceeds maximum size");
    this.issuedNonces.set(nonce, request.expiresAt);
    pushExpiry(this.expiryHeap, { nonce, expiresAt: request.expiresAt });
    return ticket;
  }

  private removeExpiredNonces(now: number): void {
    while ((this.expiryHeap[0]?.expiresAt ?? Number.POSITIVE_INFINITY) <= now) {
      const expired = popExpiry(this.expiryHeap);
      if (expired && this.issuedNonces.get(expired.nonce) === expired.expiresAt)
        this.issuedNonces.delete(expired.nonce);
    }
  }
}

interface NonceExpiry {
  readonly nonce: string;
  readonly expiresAt: number;
}

/** Purely verifies a ticket until claim performs the final injected atomic one-use transition. */
export class ActionTicketVerifier {
  private readonly keys: Map<string, TicketSigningKey>;

  constructor(private readonly options: ActionTicketVerifierOptions) {
    this.keys = indexKeys(options.keys);
  }

  verify(ticket: string, expected: TicketBinding): TicketVerification {
    const parsed = parseTicket(ticket);
    if (!parsed) return failed("MALFORMED_TICKET");
    const key = this.keys.get(parsed.keyId);
    if (!key) return failed("UNKNOWN_KEY");
    const actualMac = decodeMac(parsed.mac);
    const expectedMac = sign(key.secret, parsed.signingInput);
    if (!timingSafeEqual(expectedMac, actualMac))
      return failed("INVALID_SIGNATURE");
    const claims = parseClaims(parsed.payload, parsed.keyId);
    if (!claims) return failed("MALFORMED_TICKET");
    if (
      claims.expiresAt <=
      validTime(this.options.clock(), "clock returned invalid time")
    )
      return failed("EXPIRED");
    if (!matchesBinding(claims, expected)) return failed("BINDING_MISMATCH");
    return { ok: true, claims: Object.freeze(claims) };
  }

  async claim(
    ticket: string,
    expected: TicketBinding,
  ): Promise<TicketVerification> {
    const verified = this.verify(ticket, expected);
    if (!verified.ok) return verified;
    const now = validTime(this.options.clock(), "clock returned invalid time");
    const claimed = await this.options.replayStore.claim(
      verified.claims.nonce,
      verified.claims.expiresAt,
      now,
    );
    return claimed ? verified : failed("REPLAYED");
  }
}

function indexKeys(
  keys: readonly TicketSigningKey[],
): Map<string, TicketSigningKey> {
  const indexed = new Map<string, TicketSigningKey>();
  for (const key of keys) {
    if (!/^[A-Za-z][A-Za-z0-9_:-]{0,127}$/u.test(key.id))
      throw new TypeError("invalid key id");
    if (
      !(key.secret instanceof Uint8Array) ||
      key.secret.byteLength !== MAC_BYTES
    )
      throw new TypeError("HMAC keys must contain exactly 256 bits");
    if (indexed.has(key.id)) throw new TypeError("duplicate key id");
    indexed.set(key.id, { id: key.id, secret: new Uint8Array(key.secret) });
  }
  if (indexed.size === 0)
    throw new TypeError("at least one signing key is required");
  return indexed;
}

function withoutArguments(
  request: ActionTicketRequest,
): Omit<
  TicketClaims,
  "actionArgumentsHash" | "expiresAt" | "issuedAt" | "keyId" | "nonce"
> {
  const { arguments: _arguments, ...binding } = request;
  return binding;
}

function assertBinding(binding: TicketBinding): void {
  const identifiers = [
    binding.principalId,
    binding.tenantId,
    binding.workspaceId,
    binding.action,
    binding.permissionEpoch,
    binding.policyEpoch,
    binding.audience,
  ];
  if (
    identifiers.some(
      (value) => !/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u.test(value),
    )
  )
    throw new TypeError("ticket binding contains an invalid identifier");
  if (
    (binding.capability !== undefined && !isBoundedText(binding.capability)) ||
    (binding.scope !== undefined && !isBoundedText(binding.scope)) ||
    !isBoundedText(binding.stateHash) ||
    !isBoundedText(binding.evidenceHash) ||
    (binding.approvalReference !== null &&
      !isBoundedText(binding.approvalReference))
  )
    throw new TypeError("ticket binding contains an invalid bounded field");
  if (
    !binding.stateHash ||
    !binding.evidenceHash ||
    (binding.arguments === undefined && binding.scope === undefined) ||
    (binding.arguments !== undefined && binding.scope !== undefined)
  )
    throw new TypeError(
      "ticket must bind either arguments or scope plus state and evidence",
    );
}

function sign(secret: Uint8Array, signingInput: string): Buffer {
  return createHmac("sha256", secret).update(signingInput, "utf8").digest();
}

function parseTicket(
  ticket: string,
):
  | { keyId: string; payload: string; mac: string; signingInput: string }
  | undefined {
  if (
    typeof ticket !== "string" ||
    Buffer.byteLength(ticket, "utf8") > MAX_TICKET_BYTES
  )
    return undefined;
  const parts = ticket.split(".");
  const [version, keyId, payload, mac] = parts;
  if (
    parts.length !== 4 ||
    version !== TICKET_VERSION ||
    !keyId ||
    !payload ||
    !mac ||
    !/^[A-Za-z][A-Za-z0-9_:-]{0,127}$/u.test(keyId) ||
    !/^[A-Za-z0-9_-]+$/u.test(payload) ||
    !isCanonicalMac(mac)
  )
    return undefined;
  return {
    keyId,
    payload,
    mac,
    signingInput: `${version}.${keyId}.${payload}`,
  };
}

function decodeMac(value: string): Buffer {
  if (isCanonicalMac(value)) return Buffer.from(value, "base64url");
  return Buffer.alloc(MAC_BYTES);
}

function isCanonicalMac(value: string): boolean {
  try {
    const decoded = Buffer.from(value, "base64url");
    return (
      decoded.byteLength === MAC_BYTES &&
      decoded.toString("base64url") === value
    );
  } catch {
    return false;
  }
}

function parseClaims(
  payload: string,
  expectedKeyId: string,
): TicketClaims | undefined {
  let parsed: unknown;
  try {
    const json = Buffer.from(payload, "base64url").toString("utf8");
    parsed = JSON.parse(json);
    if (
      Buffer.from(canonicalize(parsed), "utf8").toString("base64url") !==
      payload
    )
      return undefined;
  } catch {
    return undefined;
  }
  if (!isTicketClaims(parsed) || parsed.keyId !== expectedKeyId)
    return undefined;
  if (!hasValidClaimBinding(parsed)) return undefined;
  return parsed;
}

function isTicketClaims(value: unknown): value is TicketClaims {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    "principalId",
    "tenantId",
    "workspaceId",
    "action",
    "capability",
    "scope",
    "stateHash",
    "evidenceHash",
    "permissionEpoch",
    "policyEpoch",
    "approvalReference",
    "audience",
    "actionArgumentsHash",
    "expiresAt",
    "issuedAt",
    "keyId",
    "nonce",
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) return false;
  const requiredStrings = [
    "principalId",
    "tenantId",
    "workspaceId",
    "action",
    "stateHash",
    "evidenceHash",
    "permissionEpoch",
    "policyEpoch",
    "audience",
    "keyId",
    "nonce",
  ];
  if (requiredStrings.some((key) => typeof record[key] !== "string"))
    return false;
  if (
    record.approvalReference !== null &&
    typeof record.approvalReference !== "string"
  )
    return false;
  if (record.capability !== undefined && typeof record.capability !== "string")
    return false;
  if (record.scope !== undefined && typeof record.scope !== "string")
    return false;
  if (
    record.actionArgumentsHash !== undefined &&
    typeof record.actionArgumentsHash !== "string"
  )
    return false;
  return (
    typeof record.expiresAt === "number" &&
    Number.isSafeInteger(record.expiresAt) &&
    typeof record.issuedAt === "number" &&
    Number.isSafeInteger(record.issuedAt) &&
    typeof record.nonce === "string" &&
    Buffer.from(record.nonce, "base64url").byteLength === NONCE_BYTES &&
    (record.scope === undefined) !== (record.actionArgumentsHash === undefined)
  );
}

function hasValidClaimBinding(claims: TicketClaims): boolean {
  try {
    assertBinding({
      principalId: claims.principalId,
      tenantId: claims.tenantId,
      workspaceId: claims.workspaceId,
      action: claims.action,
      ...(claims.capability === undefined
        ? {}
        : { capability: claims.capability }),
      ...(claims.scope === undefined
        ? { arguments: {} }
        : { scope: claims.scope }),
      stateHash: claims.stateHash,
      evidenceHash: claims.evidenceHash,
      permissionEpoch: claims.permissionEpoch,
      policyEpoch: claims.policyEpoch,
      approvalReference: claims.approvalReference,
      audience: claims.audience,
    });
    return true;
  } catch {
    return false;
  }
}

function matchesBinding(
  claims: TicketClaims,
  expected: TicketBinding,
): boolean {
  try {
    assertBinding(expected);
    const expectedArgumentsHash =
      expected.arguments === undefined
        ? undefined
        : hashActionArguments(expected.arguments);
    return (
      claims.principalId === expected.principalId &&
      claims.tenantId === expected.tenantId &&
      claims.workspaceId === expected.workspaceId &&
      claims.action === expected.action &&
      claims.capability === expected.capability &&
      claims.scope === expected.scope &&
      claims.actionArgumentsHash === expectedArgumentsHash &&
      claims.stateHash === expected.stateHash &&
      claims.evidenceHash === expected.evidenceHash &&
      claims.permissionEpoch === expected.permissionEpoch &&
      claims.policyEpoch === expected.policyEpoch &&
      claims.approvalReference === expected.approvalReference &&
      claims.audience === expected.audience
    );
  } catch {
    return false;
  }
}

function isBoundedText(value: string): boolean {
  return (
    value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= MAX_CLAIM_FIELD_BYTES &&
    !Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && codePoint < 0x20;
    })
  );
}

function hashActionArguments(value: unknown): string {
  const canonical = canonicalize(value);
  if (Buffer.byteLength(canonical, "utf8") > MAX_ARGUMENT_BYTES)
    throw new TypeError("ticket arguments exceed maximum size");
  return createHash("sha256")
    .update(`jev-fabric/action-arguments/v1\u0000${canonical}`, "utf8")
    .digest("hex");
}

function boundedPositiveInteger(
  value: number,
  message: string,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum)
    throw new TypeError(message);
  return value;
}

function pushExpiry(heap: NonceExpiry[], item: NonceExpiry): void {
  heap.push(item);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    const parentItem = heap[parent];
    if (!parentItem || parentItem.expiresAt <= item.expiresAt) break;
    heap[index] = parentItem;
    index = parent;
  }
  heap[index] = item;
}

function popExpiry(heap: NonceExpiry[]): NonceExpiry | undefined {
  const first = heap[0];
  const last = heap.pop();
  if (!first || !last || heap.length === 0) return first;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    const child =
      right < heap.length &&
      heap[right] !== undefined &&
      heap[left] !== undefined &&
      heap[right].expiresAt < heap[left].expiresAt
        ? right
        : left;
    const childItem = heap[child];
    if (!childItem || childItem.expiresAt >= last.expiresAt) break;
    heap[index] = childItem;
    index = child;
  }
  heap[index] = last;
  return first;
}

function validTime(value: number, message: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(message);
  return value;
}

function failed(
  reasonCode: Extract<TicketVerification, { ok: false }>["reasonCode"],
): TicketVerification {
  return { ok: false, reasonCode };
}

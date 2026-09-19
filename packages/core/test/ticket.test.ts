import { describe, expect, it } from "vitest";
import {
  ActionTicketIssuer,
  ActionTicketVerifier,
  type ReplayStore,
} from "../src/index.js";

class AtomicReplayStore implements ReplayStore {
  readonly claimed = new Set<string>();
  async claim(nonce: string): Promise<boolean> {
    if (this.claimed.has(nonce)) return false;
    this.claimed.add(nonce);
    return true;
  }
}

const keyOne = { id: "key-1", secret: new Uint8Array(32).fill(1) };
const keyTwo = { id: "key-2", secret: new Uint8Array(32).fill(2) };
const clock = () => 1_700_000_000_000;
let nonceNumber = 0;
const nonceSource = () => new Uint8Array(16).fill(++nonceNumber);
const claim = {
  principalId: "user-1",
  tenantId: "tenant-1",
  workspaceId: "workspace-1",
  action: "deploy",
  capability: "deploy-production",
  arguments: { region: "us-east-1", dryRun: false },
  stateHash: "sha256:state",
  evidenceHash: "sha256:evidence",
  permissionEpoch: "permission-1",
  policyEpoch: "policy-1",
  approvalReference: "approval-1",
  audience: "executor-1",
  expiresAt: 1_700_000_060_000,
};

function issuer(keys = [keyOne], activeKeyId = "key-1") {
  return new ActionTicketIssuer({ keys, activeKeyId, clock, nonceSource });
}

function verifier(
  store = new AtomicReplayStore(),
  keys = [keyOne],
  now = clock,
) {
  return new ActionTicketVerifier({ keys, replayStore: store, clock: now });
}

describe("HMAC action tickets", () => {
  it("verifies only the exact audience and complete authorization binding", () => {
    const ticket = issuer().issue(claim);
    const valid = verifier();
    expect(valid.verify(ticket, claim)).toMatchObject({ ok: true });

    for (const [field, value] of Object.entries({
      audience: "executor-2",
      principalId: "user-2",
      tenantId: "tenant-2",
      action: "read",
      capability: "read-only",
      stateHash: "sha256:other-state",
      evidenceHash: "sha256:other-evidence",
      permissionEpoch: "permission-2",
      policyEpoch: "policy-2",
      approvalReference: "approval-2",
    })) {
      expect(valid.verify(ticket, { ...claim, [field]: value })).toEqual({
        ok: false,
        reasonCode: "BINDING_MISMATCH",
      });
    }
    expect(
      valid.verify(ticket, {
        ...claim,
        arguments: { dryRun: false, region: "eu" },
      }),
    ).toEqual({ ok: false, reasonCode: "BINDING_MISMATCH" });

    const scopedClaim = { ...claim, scope: "production", arguments: undefined };
    const scopedTicket = issuer().issue(scopedClaim);
    expect(
      valid.verify(scopedTicket, { ...scopedClaim, scope: "staging" }),
    ).toEqual({ ok: false, reasonCode: "BINDING_MISMATCH" });
  });

  it("rejects approval replacement or revocation before replay at unchanged epochs", async () => {
    const ticket = issuer().issue(claim);
    const store = new AtomicReplayStore();
    const valid = verifier(store);
    expect(
      valid.verify(ticket, { ...claim, approvalReference: "approval-2" }),
    ).toEqual({
      ok: false,
      reasonCode: "BINDING_MISMATCH",
    });
    expect(valid.verify(ticket, { ...claim, approvalReference: null })).toEqual(
      {
        ok: false,
        reasonCode: "BINDING_MISMATCH",
      },
    );
    expect(store.claimed).toHaveLength(0);
  });

  it("rejects encoding, signature, unknown-key, and expiry tampering without claiming", async () => {
    const ticket = issuer().issue(claim);
    const store = new AtomicReplayStore();
    const valid = verifier(store);
    const tampered = `${ticket.slice(0, -1)}${ticket.endsWith("A") ? "B" : "A"}`;
    expect(valid.verify(tampered, claim)).toEqual({
      ok: false,
      reasonCode: "INVALID_SIGNATURE",
    });
    expect(valid.verify(ticket.replace("key-1", "key-x"), claim)).toEqual({
      ok: false,
      reasonCode: "UNKNOWN_KEY",
    });
    expect(
      verifier(store, [keyOne], () => claim.expiresAt).verify(ticket, claim),
    ).toEqual({
      ok: false,
      reasonCode: "EXPIRED",
    });
    expect(await valid.claim(ticket, claim)).toMatchObject({ ok: true });
  });

  it("allows only one concurrent final atomic replay claim", async () => {
    const ticket = issuer().issue(claim);
    const store = new AtomicReplayStore();
    const valid = verifier(store);
    const results = await Promise.all([
      valid.claim(ticket, claim),
      valid.claim(ticket, claim),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, reasonCode: "REPLAYED" },
    ]);
  });

  it("supports verification during key rotation and emits a unique 128-bit nonce per issue", () => {
    const oldTicket = issuer([keyOne], "key-1").issue(claim);
    const rotated = verifier(new AtomicReplayStore(), [keyOne, keyTwo]);
    expect(rotated.verify(oldTicket, claim)).toMatchObject({ ok: true });
    expect(
      verifier(new AtomicReplayStore(), [keyTwo]).verify(oldTicket, claim),
    ).toEqual({
      ok: false,
      reasonCode: "UNKNOWN_KEY",
    });
    const currentIssuer = issuer([keyOne, keyTwo], "key-2");
    expect(currentIssuer.issue(claim)).not.toEqual(currentIssuer.issue(claim));
  });

  it("refuses a duplicate nonce from a defective injected source", () => {
    const duplicateNonce = () => new Uint8Array(16).fill(7);
    const deterministicIssuer = new ActionTicketIssuer({
      keys: [keyOne],
      activeKeyId: "key-1",
      clock,
      nonceSource: duplicateNonce,
    });
    deterministicIssuer.issue(claim);
    expect(() => deterministicIssuer.issue(claim)).toThrow(/duplicate nonce/u);
  });

  it("rejects malformed and oversized ticket input", () => {
    expect(verifier().verify("not-a-ticket", claim)).toEqual({
      ok: false,
      reasonCode: "MALFORMED_TICKET",
    });
    expect(verifier().verify("x".repeat(8193), claim)).toEqual({
      ok: false,
      reasonCode: "MALFORMED_TICKET",
    });
  });

  it("rejects delimiter-bearing key identifiers but round-trips supported key identifier characters", () => {
    expect(
      () =>
        new ActionTicketIssuer({
          keys: [{ id: "key.1", secret: new Uint8Array(32).fill(1) }],
          activeKeyId: "key.1",
          clock,
          nonceSource,
        }),
    ).toThrow(/invalid key id/u);
    const supported = { id: "Key_:-1", secret: new Uint8Array(32).fill(3) };
    const ticket = issuer([supported], supported.id).issue(claim);
    expect(
      verifier(new AtomicReplayStore(), [supported]).verify(ticket, claim),
    ).toMatchObject({
      ok: true,
    });
  });

  it("never emits a self-unverifiable oversized ticket or consumes its nonce", () => {
    const oversized = {
      ...claim,
      scope: "x".repeat(8000),
      arguments: undefined,
    };
    let phase = 0;
    const sameNonce = () => new Uint8Array(16).fill(9);
    const bounded = new ActionTicketIssuer({
      keys: [keyOne],
      activeKeyId: "key-1",
      clock,
      nonceSource: sameNonce,
    });
    expect(() => bounded.issue(oversized)).toThrow(
      /ticket exceeds maximum size/u,
    );
    phase += 1;
    expect(() =>
      bounded.issue({ ...claim, arguments: { phase } }),
    ).not.toThrow();
  });

  it("fails closed instead of throwing for oversized expected arguments", () => {
    const ticket = issuer().issue(claim);
    const valid = verifier();
    expect(() =>
      valid.verify(ticket, {
        ...claim,
        arguments: { payload: "x".repeat(5000) },
      }),
    ).not.toThrow();
    expect(
      valid.verify(ticket, {
        ...claim,
        arguments: { payload: "x".repeat(5000) },
      }),
    ).toEqual({ ok: false, reasonCode: "BINDING_MISMATCH" });
  });

  it("enforces short TTL and bounded outstanding nonce capacity", () => {
    const bounded = new ActionTicketIssuer({
      keys: [keyOne],
      activeKeyId: "key-1",
      clock,
      nonceSource,
      maxTtlMs: 1000,
      maxOutstandingNonces: 1,
    });
    expect(() =>
      bounded.issue({ ...claim, expiresAt: clock() + 1001 }),
    ).toThrow(/ticket ttl exceeds maximum/u);
    bounded.issue({ ...claim, expiresAt: clock() + 1000 });
    expect(() =>
      bounded.issue({
        ...claim,
        arguments: { another: true },
        expiresAt: clock() + 1000,
      }),
    ).toThrow(/outstanding nonce capacity/u);
  });

  it("rejects unbounded issuer configuration", () => {
    expect(
      () =>
        new ActionTicketIssuer({
          keys: [keyOne],
          activeKeyId: "key-1",
          clock,
          nonceSource,
          maxTtlMs: Number.MAX_SAFE_INTEGER,
        }),
    ).toThrow(/invalid maximum ticket ttl/u);
    expect(
      () =>
        new ActionTicketIssuer({
          keys: [keyOne],
          activeKeyId: "key-1",
          clock,
          nonceSource,
          maxOutstandingNonces: Number.MAX_SAFE_INTEGER,
        }),
    ).toThrow(/invalid outstanding nonce capacity/u);
  });
});

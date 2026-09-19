import { describe, expect, it } from "vitest";
import {
  ActionTicketIssuer,
  ActionTicketVerifier,
  JsonlTelemetrySink,
  MAX_TELEMETRY_RECORD_BYTES,
  MAX_TELEMETRY_STRING_BYTES,
  Redactor,
  ReceiptBuilder,
} from "../src/index.js";

const receipt = {
  schemaVersion: "0.1",
  decisionId: "decision-1",
  stateHash: "sha256:state",
  scopeHash: "sha256:scope",
  packVersion: "route@0.1.0",
  policyVersion: "policy@0.1.0",
  providerId: "test-provider",
  model: "test-model",
  probabilitySemantics: "synthetic" as const,
  answers: [],
  outcome: "ask" as const,
  reasonCodes: ["NEEDS_REVIEW"],
  cache: "miss" as const,
  fallback: "none" as const,
  latencyMs: 12,
};

describe("redacted receipts and JSONL telemetry", () => {
  it("builds a receipt from hashes and rejects raw state, ticket, and key material", () => {
    expect(new ReceiptBuilder().build(receipt)).toMatchObject({
      ...receipt,
      redacted: true,
    });
    for (const forbidden of [
      "state",
      "rawState",
      "ticket",
      "signingKey",
      "apiKey",
    ]) {
      expect(() =>
        new ReceiptBuilder().build({ ...receipt, [forbidden]: "secret" }),
      ).toThrow();
    }
  });

  it("redacts secret and action-ticket values in real receipt fields before setting redacted", () => {
    const ticket = issueTicket();
    const built = new ReceiptBuilder().build({
      ...receipt,
      providerId: "provider-safe",
      model: "Bearer model-secret",
      reasonCodes: ["Bearer reason-secret", ticket],
    });

    expect(built.redacted).toBe(true);
    expect(JSON.stringify(built)).not.toContain("model-secret");
    expect(JSON.stringify(built)).not.toContain("reason-secret");
    expect(JSON.stringify(built)).not.toContain(ticket);
  });

  it("emits a single JSONL record with redaction and no injected record", () => {
    const lines: string[] = [];
    const sink = new JsonlTelemetrySink({
      write: (line) => {
        lines.push(line);
      },
    });
    sink.emit({
      event: "decision\nforged",
      headers: { authorization: "Bearer secret" },
      nested: { token: "secret" },
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(
      '{"event":"decision\\\\u000aforged","headers":{"authorization":"[REDACTED]"},"nested":{"token":"[REDACTED]"}}\n',
    );
  });

  it("redacts actual action tickets and standard credential aliases in the public JSONL sink", () => {
    const ticket = issueTicket();
    const lines: string[] = [];
    new JsonlTelemetrySink({
      write: (line) => {
        lines.push(line);
      },
    }).emit({
      message: ticket,
      access_token: "access-secret",
      headers: {
        "set-cookie": "session=cookie-secret",
        "proxy-authorization": "Basic proxy-secret",
      },
      url: "https://user:password@example.test/path?access_token=url-secret&visible=ok",
    });

    expect(lines).toHaveLength(1);
    const emitted = lines[0] ?? "";
    expect(emitted).not.toContain(ticket);
    expect(emitted).not.toContain("access-secret");
    expect(emitted).not.toContain("cookie-secret");
    expect(emitted).not.toContain("proxy-secret");
    expect(emitted).not.toContain("url-secret");
    expect(emitted).toContain("visible=ok");
  });

  it("recognizes issued tickets before URL parsing and inside encoded URL components", () => {
    const redactor = new Redactor();
    const safeIdentifier = "v1.api.response.json";
    const lines: string[] = [];
    expect(redactor.redact(safeIdentifier)).toBe(safeIdentifier);
    const tickets = [issueTicket("key:1"), issueTicket("Key_:-1")];
    for (const ticket of tickets) {
      const encoded = encodeURIComponent(ticket);
      expect(redactor.redact(`prefix ${ticket} suffix`)).toBe(
        "prefix [REDACTED] suffix",
      );
      new JsonlTelemetrySink({
        write: (line) => {
          lines.push(line);
        },
      }).emit({
        plain: ticket,
        embedded: `prefix ${ticket} suffix`,
        url: `https://example.test/${encoded}?message=${encoded}&safe=${safeIdentifier}`,
        userinfoUrl: `https://${encoded}:ignored@example.test/path`,
      });
    }
    for (const [index, ticket] of tickets.entries()) {
      const emitted = lines[index] ?? "";
      expect(emitted).not.toContain(ticket);
      expect(emitted).not.toContain(encodeURIComponent(ticket));
      expect(emitted).toContain(safeIdentifier);
    }
  });

  it("redacts every supported issued-ticket form without changing safe duplicate URLs", () => {
    const redactor = new Redactor();
    const safeUrl = "https://example.test/?tag=a&tag=b";
    expect(redactor.redact(safeUrl)).toBe(safeUrl);
    expect(redactor.redact("v1.api.response.json")).toBe(
      "v1.api.response.json",
    );

    const keyIds = [
      "key-1",
      "key:1",
      "Key_:-1",
      "key:",
      "key_",
      "key-",
      "Z0",
      `K${"a".repeat(126)}:`,
    ];
    const lines: string[] = [];
    const sink = new JsonlTelemetrySink({
      write: (line) => {
        lines.push(line);
      },
    });
    for (const keyId of keyIds) {
      const ticket = issueTicket(keyId);
      expect(verifyTicket(ticket, keyId)).toMatchObject({ ok: true });
      const encoded = encodeURIComponent(ticket);
      sink.emit({
        plain: ticket,
        embedded: `before${ticket}after`,
        hyphen: `record-${ticket}`,
        dotted: `record.${ticket}.tail`,
        wholeUrlRaw: `https://${ticket}:ignored@example.test/${ticket}?tag=a&tag=b&message=${ticket}&note=visible&note=${ticket}#message=${ticket}`,
        wholeUrlEncoded: `https://${encoded}:ignored@example.test/${encoded}?message=${encoded}&note=visible&note=${encoded}#message=${encoded}`,
        prose: `request failed https://example.test/?message=${encoded}#message=${encoded}`,
      });
    }

    for (const [index, keyId] of keyIds.entries()) {
      const ticket = issueTicket(keyId);
      const emitted = lines[index] ?? "";
      expectNoRecoverableTicket(emitted, ticket);
      const record = JSON.parse(emitted) as Record<string, string>;
      const rawUrl = new URL(record.wholeUrlRaw ?? "");
      expect(rawUrl.searchParams.getAll("tag")).toEqual(["a", "b"]);
      expect(rawUrl.searchParams.getAll("note")).toEqual([
        "visible",
        "[REDACTED]",
      ]);
    }

    expect(() =>
      redactor.redact(`https://example.test/#${"%25".repeat(20_000)}`),
    ).not.toThrow();
  });

  it("fails closed at byte caps while preserving safe encoded URL components", () => {
    const ticket = issueTicket("key:1");
    const encoded = encodeURIComponent(ticket);
    const ticketBytes = Buffer.byteLength(ticket, "utf8");
    const below = `${"x".repeat(MAX_TELEMETRY_STRING_BYTES - ticketBytes - 1)}${ticket}`;
    const at = `${"x".repeat(MAX_TELEMETRY_STRING_BYTES - ticketBytes)}${ticket}`;
    const after = `${"x".repeat(MAX_TELEMETRY_STRING_BYTES - ticketBytes + 1)}${ticket}`;
    const redactor = new Redactor();
    const safeEncoded =
      "https://example.test/keep%2Fslash?safe=keep%2Fvalue#fragment%2Fvalue";

    expect(redactor.redact(safeEncoded)).toBe(safeEncoded);
    expectNoRecoverableTicket(String(redactor.redact(below)), ticket);
    expectNoRecoverableTicket(String(redactor.redact(at)), ticket);
    expect(redactor.redact(after)).toBe("[REDACTED:OVERSIZED]");
    expect(redactor.redact("😀".repeat(MAX_TELEMETRY_STRING_BYTES / 2))).toBe(
      "[REDACTED:OVERSIZED]",
    );

    const malformed = `https://example.test/keep%2Fslash/${encoded}?safe=keep%2Fvalue&message=%ZZ${encoded}#${encoded}`;
    const sanitized = String(redactor.redact(malformed));
    expectNoRecoverableTicket(sanitized, ticket);
    expect(sanitized).toContain("keep%2Fslash");
    expect(sanitized).toContain("safe=keep%2Fvalue");

    const malformedLines: string[] = [];
    new JsonlTelemetrySink({
      write: (line) => {
        malformedLines.push(line);
      },
    }).emit({ url: malformed });
    expectNoRecoverableTicket(malformedLines[0] ?? "", ticket);
    expect(malformedLines[0] ?? "").toContain("safe=keep%2Fvalue");

    expect(() =>
      expectNoRecoverableTicket(encodeURIComponent(ticket), ticket),
    ).toThrow();
    const lines: string[] = [];
    new JsonlTelemetrySink({
      write: (line) => {
        lines.push(line);
      },
    }).emit({
      first: "x".repeat(MAX_TELEMETRY_STRING_BYTES - 1),
      second: "y".repeat(MAX_TELEMETRY_STRING_BYTES - 1),
    });
    const line = lines[0] ?? "";
    expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(
      MAX_TELEMETRY_RECORD_BYTES,
    );
    expect(line).toContain("[REDACTED:OVERSIZED_RECORD]");
    expectNoRecoverableTicket(line, ticket);

    const boundaryLines: string[] = [];
    new JsonlTelemetrySink({
      write: (line) => {
        boundaryLines.push(line);
      },
    }).emit({ message: after, [after]: "safe" });
    expect(boundaryLines[0]).toContain("[REDACTED:OVERSIZED]");
    expectNoRecoverableTicket(boundaryLines[0] ?? "", ticket);
  });

  it("redacts effective input and configured schema versions before strict receipt validation", () => {
    const ticket = issueTicket();
    const fromInput = new ReceiptBuilder().build({
      ...receipt,
      schemaVersion: ticket,
    });
    const fromOption = new ReceiptBuilder({
      schemaVersion: `Bearer ${ticket}`,
    }).build(receipt);

    for (const built of [fromInput, fromOption]) {
      expect(built.redacted).toBe(true);
      expect(built.schemaVersion).not.toContain(ticket);
      expect(built.schemaVersion).toContain("[REDACTED]");
    }
  });
});

function issueTicket(keyId = "key-1"): string {
  return new ActionTicketIssuer({
    keys: [{ id: keyId, secret: new Uint8Array(32).fill(1) }],
    activeKeyId: keyId,
    clock: () => 1_700_000_000_000,
    nonceSource: () => new Uint8Array(16).fill(7),
  }).issue({
    principalId: "user-1",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    action: "deploy",
    arguments: { target: "safe" },
    stateHash: "sha256:state",
    evidenceHash: "sha256:evidence",
    permissionEpoch: "permission-1",
    policyEpoch: "policy-1",
    approvalReference: "approval-1",
    audience: "executor-1",
    expiresAt: 1_700_000_060_000,
  });
}

function verifyTicket(ticket: string, keyId: string) {
  return new ActionTicketVerifier({
    keys: [{ id: keyId, secret: new Uint8Array(32).fill(1) }],
    clock: () => 1_700_000_000_000,
    replayStore: { claim: async () => true },
  }).verify(ticket, {
    principalId: "user-1",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    action: "deploy",
    arguments: { target: "safe" },
    stateHash: "sha256:state",
    evidenceHash: "sha256:evidence",
    permissionEpoch: "permission-1",
    policyEpoch: "policy-1",
    approvalReference: "approval-1",
    audience: "executor-1",
  });
}

function expectNoRecoverableTicket(value: string, ticket: string): void {
  expect(value).not.toContain(ticket);
  expect(value).not.toContain(encodeURIComponent(ticket));
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // An invalid escape sequence cannot be decoded into a recoverable ticket.
    return;
  }
  expect(decoded).not.toContain(ticket);
}

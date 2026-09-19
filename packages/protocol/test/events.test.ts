import { describe, expect, it } from "vitest";
import { normalizedEventSchema } from "../src/index.js";

const event = {
  id: "event-1",
  type: "tool_proposal",
  sessionId: "session-1",
  timestamp: "2026-09-19T10:00:00.000Z",
  host: "codex",
  goal: "Review a change.",
  evidence: [],
  trust: "untrusted",
  sensitivity: "internal",
  freshness: "current",
  contentHash: "sha256:abc",
};

describe("normalized events", () => {
  it("keeps authorization outside generic events", () => {
    expect(() =>
      normalizedEventSchema.parse({ ...event, tenantId: "forged" }),
    ).toThrow();
  });

  it("rejects unknown fields at the event trust boundary", () => {
    expect(() =>
      normalizedEventSchema.parse({ ...event, unknown: true }),
    ).toThrow();
  });

  it("rejects protected authorization names nested in generic event content", () => {
    expect(() =>
      normalizedEventSchema.parse({
        ...event,
        content: { evidence: { tenantId: "forged" } },
      }),
    ).toThrow();
    expect(() =>
      normalizedEventSchema.parse({
        ...event,
        content: [{ safe: true }, { scopes: [{ workspaceId: "forged" }] }],
      }),
    ).toThrow();
  });

  it("rejects prototype-backed and prototype-polluting generic content", () => {
    const inheritedAuthorization = Object.create({ principalId: "forged" });
    inheritedAuthorization.evidence = "untrusted";

    expect(() =>
      normalizedEventSchema.parse({
        ...event,
        content: inheritedAuthorization,
      }),
    ).toThrow();
    expect(() =>
      normalizedEventSchema.parse({
        ...event,
        content: JSON.parse('{"__proto__":{"tenantId":"forged"}}'),
      }),
    ).toThrow();
  });

  it("materializes generic content into an inert snapshot", () => {
    const source = {
      second: { observed: "before" },
      first: ["stable"],
    };

    const parsed = normalizedEventSchema.parse({ ...event, content: source });
    source.second.observed = "after";
    source.first[0] = "mutated";
    Object.assign(source.second, { tenantId: "forged" });

    expect(parsed.content).toEqual({
      second: { observed: "before" },
      first: ["stable"],
    });
    expect(Object.keys(parsed.content as object)).toEqual(["second", "first"]);
    expect(
      (parsed.content as { second: Record<string, unknown> }).second.tenantId,
    ).toBeUndefined();
  });

  it("does not retain a Proxy that reveals authorization after parsing", () => {
    const source = new Proxy(
      {},
      {
        get: (_, key) => (key === "tenantId" ? "forged" : undefined),
        getOwnPropertyDescriptor: (_, key) =>
          key === "safe"
            ? {
                configurable: true,
                enumerable: true,
                value: "observed",
                writable: true,
              }
            : undefined,
        getPrototypeOf: () => Object.prototype,
        ownKeys: () => ["safe"],
      },
    );

    const parsed = normalizedEventSchema.parse({ ...event, content: source });

    expect(parsed.content).toEqual({ safe: "observed" });
    expect(
      (parsed.content as Record<string, unknown>).tenantId,
    ).toBeUndefined();
  });

  it("fails closed when Proxy reflection traps throw", () => {
    const source = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("do not leak this trap error");
        },
      },
    );

    expect(() =>
      normalizedEventSchema.parse({ ...event, content: source }),
    ).toThrow("event content cannot be safely inspected");
  });
});

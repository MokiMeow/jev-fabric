import { describe, expect, it } from "vitest";
import {
  assertSafeDecisionState,
  compileState,
  projectState,
  projectStateWithBinding,
} from "../src/context.js";

const limits = {
  maxStateBytes: 4096,
  maxStateDepth: 8,
  maxStateItems: 100,
  maxStringBytes: 1024,
};

describe("decision-state credential boundary", () => {
  it("rejects secret keys and credential-shaped values before a projector result can leave core", () => {
    for (const state of [
      { apiKey: "not-used" },
      { note: "Bearer credential-123456789" },
      { note: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature-part" },
      { note: "apikey_1234567890abcdef" },
      { note: `v1.key.${"a".repeat(20)}.${"a".repeat(43)}` },
      { nested: { ticket: "never" } },
    ])
      expect(() => compileState(state, limits)).toThrow(/state/i);
  });

  it("requires a narrow explicit reviewed opt-out for a trusted custom projector", () => {
    const input = { note: "Bearer credential-123456789" };
    expect(() =>
      projectState({ project: () => input }, input, limits, { nowEpochMs: 0 }),
    ).toThrow(/credentials/i);
    expect(
      projectState(
        {
          project: () => input,
          unsafeAllowSecretState: {
            justification: "legacy local-only migration reviewed",
          },
        },
        input,
        limits,
        { nowEpochMs: 0 },
      ),
    ).toEqual(input);
  });

  it("keeps a trusted evidence binding separate from provider-visible state", () => {
    const projected = projectStateWithBinding(
      {
        project: () => ({ semantic: "bounded" }),
        bindingHash: () => `sha256:${"a".repeat(64)}`,
      },
      { source: "private-host-evidence" },
      limits,
      { nowEpochMs: 0 },
    );

    expect(projected).toEqual({
      state: { semantic: "bounded" },
      bindingHash: `sha256:${"a".repeat(64)}`,
    });
    expect(JSON.stringify(projected.state)).not.toContain("binding");
    expect(Object.isFrozen(projected)).toBe(true);
    expect(() =>
      projectStateWithBinding(
        {
          project: () => ({ semantic: "bounded" }),
          bindingHash: () => "not-a-hash",
        },
        {},
        limits,
        { nowEpochMs: 0 },
      ),
    ).toThrow(/binding hash/u);
  });

  it("rejects sensitive keys after bounded ASCII separator normalization", () => {
    for (const key of [
      "api key",
      "api.key",
      "api/key",
      "api..__//key",
      "API_KEY",
      "client.secret",
      "x api key",
    ]) {
      const state = { nested: { [key]: "opaque-custom-credential" } };
      expect(() => compileState(state, limits), key).toThrow(/state/i);
      expect(() => assertSafeDecisionState(state), key).toThrow(/state/i);
    }
  });

  it("rejects non-ASCII, unsupported-symbol, and overlong public field names without echoing them", () => {
    for (const key of [
      "api⁄key",
      "api∕key",
      "api⧸key",
      "client∕secret",
      "ɑpi key",
      "ＡＰＩ　ＫＥＹ",
      "аpi\u200bkey",
      "ordinary@value",
      "ordinary!value",
      "こんにちは",
      "a".repeat(129),
    ]) {
      const state = { nested: { [key]: "opaque-custom-credential" } };
      for (const inspect of [
        () => compileState(state, limits),
        () => assertSafeDecisionState(state),
      ]) {
        expect(inspect, key).toThrow(/state/i);
        try {
          inspect();
        } catch (error) {
          expect(
            error instanceof Error ? error.message : String(error),
            key,
          ).not.toContain(key);
          expect(
            error instanceof Error ? error.message : String(error),
            key,
          ).not.toContain("opaque-custom-credential");
        }
      }
    }
  });

  it("keeps ordinary textual keys distinct from sensitive credential labels", () => {
    const state = {
      apiDocumentation: "safe",
      tokenizedStatus: "complete",
      clientSecretary: "safe",
      ordinary_thing: "safe",
      "dotted.value": "safe",
      "kebab-value": "safe",
      "slash/value": "safe",
      spacedValue: "مرحبا 你好 🔒",
    };
    expect(() => compileState(state, limits)).not.toThrow();
    expect(() => assertSafeDecisionState(state)).not.toThrow();
  });

  it("requires the reviewed in-process opt-out to accept non-ASCII field names", () => {
    const state = { legacy_日本語: "safe Unicode value" };
    expect(() => compileState(state, limits)).toThrow(/state/i);
    expect(() =>
      compileState(state, limits, {
        unsafeAllowSecretState: {
          justification: "reviewed legacy in-process migration only",
        },
      }),
    ).not.toThrow();
  });
});

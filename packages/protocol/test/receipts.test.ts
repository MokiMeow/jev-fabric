import { describe, expect, it } from "vitest";
import { decisionReceiptSchema } from "../src/index.js";

describe("decision receipts", () => {
  it("accepts metadata hashes without raw state", () => {
    expect(
      decisionReceiptSchema.parse({
        schemaVersion: "0.1",
        decisionId: "decision-1",
        stateHash: "sha256:state",
        scopeHash: "sha256:scope",
        packVersion: "route@0.1.0",
        policyVersion: "policy@0.1.0",
        providerId: "test-provider",
        model: "test-model",
        probabilitySemantics: "synthetic",
        answers: [],
        outcome: "ask",
        reasonCodes: ["needs-review"],
        cache: "miss",
        fallback: "none",
        latencyMs: 12,
        redacted: true,
      }),
    ).toMatchObject({ redacted: true });
  });

  it("rejects raw state and unknown receipt fields", () => {
    expect(() =>
      decisionReceiptSchema.parse({
        schemaVersion: "0.1",
        decisionId: "decision-1",
        stateHash: "sha256:state",
        scopeHash: "sha256:scope",
        packVersion: "route@0.1.0",
        policyVersion: "policy@0.1.0",
        providerId: "test-provider",
        model: "test-model",
        probabilitySemantics: "synthetic",
        answers: [],
        outcome: "ask",
        reasonCodes: [],
        cache: "miss",
        fallback: "none",
        latencyMs: 12,
        redacted: true,
        state: { secret: "not stored" },
      }),
    ).toThrow();
  });

  it("preserves explicit zero usage and cost while leaving omitted metadata unknown", () => {
    const baseReceipt = {
      schemaVersion: "0.1",
      decisionId: "decision-1",
      stateHash: "sha256:state",
      scopeHash: "sha256:scope",
      packVersion: "route@0.1.0",
      policyVersion: "policy@0.1.0",
      providerId: "test-provider",
      model: "test-model",
      probabilitySemantics: "synthetic",
      answers: [],
      outcome: "ask",
      reasonCodes: [],
      cache: "miss",
      fallback: "none",
      latencyMs: 12,
      redacted: true,
    };

    expect(decisionReceiptSchema.parse(baseReceipt)).not.toHaveProperty(
      "usage",
    );
    expect(
      decisionReceiptSchema.parse({
        ...baseReceipt,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        cost: { currency: "USD", amountMicros: "0" },
      }),
    ).toMatchObject({
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      cost: { currency: "USD", amountMicros: "0" },
    });
  });

  it("rejects non-integral usage and fragile cost values", () => {
    const receipt = {
      schemaVersion: "0.1",
      decisionId: "decision-1",
      stateHash: "sha256:state",
      scopeHash: "sha256:scope",
      packVersion: "route@0.1.0",
      policyVersion: "policy@0.1.0",
      providerId: "test-provider",
      model: "test-model",
      probabilitySemantics: "synthetic",
      answers: [],
      outcome: "ask",
      reasonCodes: [],
      cache: "miss",
      fallback: "none",
      latencyMs: 12,
      redacted: true,
    };

    expect(() =>
      decisionReceiptSchema.parse({ ...receipt, usage: { inputTokens: 1.5 } }),
    ).toThrow();
    expect(() =>
      decisionReceiptSchema.parse({
        ...receipt,
        cost: { currency: "USD", amountMicros: "0.1" },
      }),
    ).toThrow();
  });
});

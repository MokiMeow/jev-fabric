import { describe, expect, it } from "vitest";
import { TypeSafeProvider, type TypeSafeProviderError } from "../src/index.js";
import type { DecisionRequest } from "@mokimeow/jev-fabric-protocol";

const request: DecisionRequest = {
  id: "d1",
  state: null,
  questions: [{ id: "q1", type: "noul", instructions: "yes?", criteria: null }],
};

describe("TypeSafeProvider errors", () => {
  it("sanitizes provider exceptions and preserves only safe retry metadata", async () => {
    const provider = new TypeSafeProvider({
      id: "typesafe",
      model: "jev-1.13.0",
      client: {
        systemOne: async () => {
          throw Object.assign(
            new Error(
              "Bearer secret-value https://api.example.test/?token=secret",
            ),
            { status: 429, retryAfterMs: 100 },
          );
        },
      },
    });
    await expect(provider.evaluate(request)).rejects.toEqual(
      expect.objectContaining<TypeSafeProviderError>({
        category: "rate_limited",
        retryable: true,
        status: 429,
        retryAfterMs: 100,
      }),
    );
    await provider.evaluate(request).catch((error: unknown) => {
      expect((error as Error).message).not.toContain("secret");
      expect((error as Error).message).not.toContain("https:");
    });
  });

  it("turns malformed direct answers into a typed invalid-response error", async () => {
    const provider = new TypeSafeProvider({
      id: "typesafe",
      model: "jev-1.13.0",
      client: {
        systemOne: async () => ({
          model: "jev",
          usage: { input_tokens: 1, output_tokens: 1 },
          answers: { q1: { type: "noul", noul: 2 } },
        }),
      },
    });
    await expect(provider.evaluate(request)).rejects.toEqual(
      expect.objectContaining({
        category: "invalid_response",
        retryable: false,
      }),
    );
  });
});

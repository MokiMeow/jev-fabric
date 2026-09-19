import { describe, expect, it } from "vitest";
import {
  NATIVE_JEV_MODEL,
  createNativeJevProvider,
  TypeSafeProvider,
} from "../src/index.js";
import type { DecisionRequest } from "@mokimeow/jev-fabric-protocol";

const request: DecisionRequest = {
  id: "d1",
  state: { text: "hello" },
  questions: [
    {
      id: "choice_1",
      type: "choice",
      instructions: "Choose",
      criteria: { a: "A", b: "B" },
      options: ["a", "b"],
    },
  ],
};

describe("TypeSafeProvider", () => {
  it("pins the native factory without ambient credential or model escape hatches", () => {
    expect(NATIVE_JEV_MODEL).toBe("jev-1.13.0");
    expect(() => createNativeJevProvider({ apiKey: "" })).toThrow(
      /configuration/,
    );
    expect(
      () => new TypeSafeProvider({ id: "typesafe", model: "jev-1.13.0" }),
    ).toThrow(/configuration/);
  });
  it("uses an injected client and passes cancellation/deadline without reading ambient credentials", async () => {
    let received: unknown;
    const signal = new AbortController().signal;
    const provider = new TypeSafeProvider({
      id: "typesafe",
      model: "jev-1.13.0",
      client: {
        systemOne: async (_request, options) => {
          received = options;
          return {
            model: "jev-1.13.0",
            usage: { input_tokens: 1, output_tokens: 2 },
            answers: {
              choice_1: {
                type: "choice",
                choice: "a",
                probabilities: { a: 0.8, b: 0.2 },
                confidence: 0.9,
              },
            },
          };
        },
      },
    });
    await expect(
      provider.evaluate(request, { signal, deadlineMs: 345 }),
    ).resolves.toMatchObject({
      probabilitySemantics: "native_calibrated",
    });
    expect(received).toEqual({
      signal,
      timeout: 345,
      retry: { maxRetries: 0 },
    });
  });

  it("requires an explicitly approved Jev requested/returned model and a positive deadline", async () => {
    expect(
      () =>
        new TypeSafeProvider({
          id: "typesafe",
          model: "other",
          client: { systemOne: async () => ({}) },
        }),
    ).toThrow(/configuration/);
    const provider = new TypeSafeProvider({
      id: "typesafe",
      model: "jev-1.13.0",
      client: { systemOne: async () => ({}) },
    });
    await expect(
      provider.evaluate(request, { deadlineMs: 0 }),
    ).rejects.toMatchObject({ category: "configuration", retryable: false });
  });
});

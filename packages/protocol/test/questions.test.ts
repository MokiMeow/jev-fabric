import { describe, expect, it } from "vitest";
import { decisionQuestionSchema } from "../src/index.js";

describe("decision questions", () => {
  it("accepts a choice question with portable unique options", () => {
    expect(
      decisionQuestionSchema.parse({
        id: "route-primary",
        type: "choice",
        instructions: "Choose the safest route.",
        criteria: { goal: "safety" },
        options: ["allow", "ask", "deny"],
      }),
    ).toMatchObject({ type: "choice", id: "route-primary" });
  });

  it("rejects duplicate or malformed choice options", () => {
    expect(() =>
      decisionQuestionSchema.parse({
        id: "route-primary",
        type: "choice",
        instructions: "Choose.",
        criteria: {},
        options: ["allow", "allow"],
      }),
    ).toThrow();
    expect(() =>
      decisionQuestionSchema.parse({
        id: "route primary",
        type: "choice",
        instructions: "Choose.",
        criteria: {},
        options: ["allow", "deny"],
      }),
    ).toThrow();
  });
});

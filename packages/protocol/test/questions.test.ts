import { describe, expect, it } from "vitest";
import { decisionQuestionSchema } from "../src/index.js";

describe("decision questions", () => {
  it("accepts a choice question with portable unique options", () => {
    expect(
      decisionQuestionSchema.parse({
        id: "route-primary",
        type: "choice",
        instructions: "Choose the safest route.",
        criteria: {
          allow: "Evidence supports the bounded route.",
          ask: "Evidence requires clarification.",
          deny: "Evidence fails the bounded route.",
        },
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

  it("rejects criteria that omit or add Choice options", () => {
    for (const criteria of [
      { allow: "Allow" },
      { allow: "Allow", deny: "Deny", other: "Other" },
    ])
      expect(() =>
        decisionQuestionSchema.parse({
          id: "route-primary",
          type: "choice",
          instructions: "Choose.",
          criteria,
          options: ["allow", "deny"],
        }),
      ).toThrow(/criteria must match choice options exactly/u);
  });

  it("requires at least two ordered Score levels", () => {
    expect(() =>
      decisionQuestionSchema.parse({
        id: "quality",
        type: "score",
        instructions: "Rate bounded quality.",
        criteria: ["only-level"],
      }),
    ).toThrow();
  });

  it("accepts only the native true/false Noul criteria shape or null", () => {
    expect(
      decisionQuestionSchema.parse({
        id: "urgent",
        type: "noul",
        instructions: "Does the note explicitly describe urgent harm?",
        criteria: { true: "Explicit urgent harm", false: "No explicit harm" },
      }),
    ).toMatchObject({ type: "noul", id: "urgent" });
    expect(
      decisionQuestionSchema.parse({
        id: "urgent",
        type: "noul",
        instructions: "Does the note explicitly describe urgent harm?",
        criteria: null,
      }),
    ).toMatchObject({ criteria: null });
    expect(() =>
      decisionQuestionSchema.parse({
        id: "urgent",
        type: "noul",
        instructions: "Does the note explicitly describe urgent harm?",
        criteria: { yes: "Explicit urgent harm", no: "No explicit harm" },
      }),
    ).toThrow();
  });
});

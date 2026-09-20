import { compileTypeSafeRequest } from "../../packages/provider-typesafe/src/mapping.js";
import { financeSurveillancePack } from "../../packs/finance-surveillance/pack.js";
import { describe, expect, it } from "vitest";

describe("finance pack native TypeSafe compatibility", () => {
  it("compiles every bounded choice with criteria matching its options", () => {
    const implementation = financeSurveillancePack.implementations;
    expect(implementation).toBeDefined();
    const candidates = [
      { id: "observe", description: "Record the advisory observation only" },
      {
        id: "investigate",
        description: "Route to bounded analyst investigation",
      },
      {
        id: "escalate",
        description: "Escalate to an authorized human reviewer",
      },
    ];
    const questions = implementation?.questions({}, candidates) ?? [];
    expect(() =>
      compileTypeSafeRequest(
        { id: "finance-native-compile", state: {}, questions },
        "jev-1.13.0",
      ),
    ).not.toThrow();
    for (const question of questions) {
      expect(question.type).toBe("choice");
      if (question.type === "choice")
        expect(Object.keys(question.criteria).sort()).toEqual(
          [...question.options].sort(),
        );
    }
  });
});

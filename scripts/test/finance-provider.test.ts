import { compileTypeSafeRequest } from "../../packages/provider-typesafe/src/mapping.js";
import { builtinPacks } from "../../packs/index.js";
import { financeResearchRouterPack } from "../../packs/finance-research-router/pack.js";
import { financeSurveillancePack } from "../../packs/finance-surveillance/pack.js";
import { fintechExceptionPack } from "../../packs/fintech-exception/pack.js";
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

  it("compiles the fintech pack with exact native Noul criteria", () => {
    const implementation = fintechExceptionPack.implementations;
    if (!implementation) throw new Error("fintech implementation missing");
    const questions = implementation.questions({}, []);
    expect(() =>
      compileTypeSafeRequest(
        { id: "fintech-native-compile", state: {}, questions },
        "jev-1.13.0",
      ),
    ).not.toThrow();
    for (const question of questions) {
      expect(question.type).toBe("noul");
      if (question.type === "noul")
        expect(Object.keys(question.criteria ?? {}).sort()).toEqual([
          "false",
          "true",
        ]);
    }
  });

  it("compiles the read-only finance research router as one native batch", () => {
    const implementation = financeResearchRouterPack.implementations;
    if (!implementation)
      throw new Error("finance research implementation missing");
    const candidates = [
      ["plot_price", "Propose a read-only historical price chart"],
      [
        "compare_returns",
        "Propose a read-only comparison of historical returns",
      ],
      [
        "rolling_correlation",
        "Propose a read-only rolling-correlation calculation",
      ],
      ["summary_stats", "Propose read-only descriptive statistics"],
      ["market_summary", "Propose a read-only market summary"],
      ["list_symbols", "List the host-declared research symbols"],
      [
        "investigate",
        "Route an unsafe, unsupported, or ambiguous request to review",
      ],
    ].map(([id, description]) => ({
      id: id ?? "",
      description: description ?? "",
    }));
    const state = {
      request: { text: "Show AAPL price history." },
      symbols: [
        {
          id: "AAPL",
          displayName: "Apple Inc.",
          available: true as const,
          freshness: "current" as const,
        },
      ],
    };
    const questions = implementation.questions(state, candidates);
    expect(questions).toHaveLength(6);
    expect(() =>
      compileTypeSafeRequest(
        { id: "finance-research-native-compile", state, questions },
        "jev-1.13.0",
      ),
    ).not.toThrow();
  });

  it("compiles every generic built-in pack through the native TypeSafe mapper", () => {
    const candidates = [
      { id: "candidate-one", description: "First bounded candidate" },
      { id: "candidate-two", description: "Second bounded candidate" },
    ];
    for (const pack of builtinPacks) {
      if (
        pack.manifest.id === "finance-research-router" ||
        pack.manifest.id === "finance-surveillance" ||
        pack.manifest.id === "fintech-exception"
      )
        continue;
      const implementation = pack.implementations;
      if (!implementation)
        throw new Error(`${pack.manifest.id}: implementation missing`);
      const state = { candidates, absoluteFit: true };
      const questions = implementation.questions(state, candidates);
      expect(
        () =>
          compileTypeSafeRequest(
            {
              id: `${pack.manifest.id}-native-compile`,
              state,
              questions,
            },
            "jev-1.13.0",
          ),
        pack.manifest.id,
      ).not.toThrow();
    }
  });
});

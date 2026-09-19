import { describe, expect, it } from "vitest";
import {
  builtinPacks,
  completionPack,
  progressPack,
  rankPack,
  riskPack,
  screenPack,
  verifyPack,
} from "../index.js";
import {
  BudgetLedger,
  DecisionScheduler,
  FabricRuntime,
  MemoryDecisionCache,
  ScriptedProvider,
} from "@mokimeow/jev-fabric-core";
import { resolve } from "node:path";
import {
  fixturePackIds,
  loadPackFixtures,
  parseFixture,
  type ExecutableFixture,
} from "./fixtures.js";

const fixtureRoot = resolve(import.meta.dirname, "..");
const packs = new Map(builtinPacks.map((pack) => [pack.manifest.id, pack]));

describe("built-in decision packs", () => {
  it("exports exactly the finite alpha pack set", () => {
    expect(builtinPacks.map((pack) => pack.manifest.id)).toEqual(
      fixturePackIds,
    );
    expect(new Set(builtinPacks.map((pack) => pack.manifest.id)).size).toBe(7);
  });

  it("rejects credential-bearing state in every built-in pack before provider egress", async () => {
    let calls = 0;
    const runtime = new FabricRuntime({
      provider: {
        id: "capture",
        capabilities: {
          questionTypes: ["choice"],
          probabilitySemantics: ["synthetic"],
          maxQuestions: 10,
        },
        evaluate: async () => {
          calls += 1;
          throw new Error("provider must not receive secret state");
        },
      },
      model: "fixture-model",
      cache: new MemoryDecisionCache({ maxEntries: 4 }),
      scheduler: new DecisionScheduler({
        providerConcurrency: 1,
        tenantConcurrency: 1,
        budget: new BudgetLedger({ requests: 10 }),
      }),
    });
    for (const pack of builtinPacks)
      await expect(
        runtime.evaluate({
          pack,
          state: { note: "Bearer no-egress-secret-123456789" },
          tenantId: "trusted-tenant",
          action: pack.manifest.id,
          knownActions: [pack.manifest.id],
        }),
      ).rejects.toThrow(/state/i);
    expect(calls).toBe(0);
  });

  it("keeps static risk denial and unsupported completion claims deterministic", () => {
    expect(
      riskPack.implementations?.bypass?.({ staticDeny: true }),
    ).toMatchObject({ outcome: "deny", reasonCode: "STATIC_DENY" });
    expect(
      completionPack.implementations?.bypass?.({
        claimedChecks: ["test"],
        observedChecks: [],
      }),
    ).toMatchObject({
      outcome: "deny",
      reasonCode: "UNOBSERVED_COMPLETION_CLAIM",
    });
  });

  it("turns risk authorization and influence signals into restrictive proposals without granting authority", () => {
    const interpret = riskPack.implementations?.interpret;
    if (!interpret) throw new Error("risk implementation missing");
    const signals = (
      risk: "low" | "high",
      authorization: "no" | "yes",
      influence: "no" | "yes",
    ) =>
      interpret(
        [
          {
            questionId: "risk-level",
            type: "choice",
            selected: risk,
            probabilities: {
              low: risk === "low" ? 1 : 0,
              high: risk === "high" ? 1 : 0,
            },
          },
          {
            questionId: "risk-authorization",
            type: "choice",
            selected: authorization,
            probabilities: {
              no: authorization === "no" ? 1 : 0,
              yes: authorization === "yes" ? 1 : 0,
            },
          },
          {
            questionId: "risk-influence",
            type: "choice",
            selected: influence,
            probabilities: {
              no: influence === "no" ? 1 : 0,
              yes: influence === "yes" ? 1 : 0,
            },
          },
        ],
        [],
      );
    expect(signals("low", "no", "no").proposedOutcome).toBe("allow");
    expect(signals("low", "yes", "no").proposedOutcome).toBe("ask");
    expect(signals("low", "no", "yes").proposedOutcome).toBe("escalate");
    expect(signals("high", "no", "no").proposedOutcome).toBe("escalate");
  });

  it("interprets every fixed-option selection independently of candidate ids", async () => {
    const cases = [
      {
        pack: screenPack,
        questionId: "screen-triage",
        options: ["accept", "reject", "abstain"],
      },
      {
        pack: verifyPack,
        questionId: "verify-assertion",
        options: ["supported", "unsupported"],
      },
      {
        pack: progressPack,
        questionId: "progress-state",
        options: ["not_started", "in_progress", "blocked"],
      },
      {
        pack: completionPack,
        questionId: "completion-state",
        options: ["complete", "incomplete"],
      },
    ] as const;

    for (const testCase of cases) {
      for (const selected of testCase.options) {
        const { result, providerCalls } = await evaluateFixedOption(
          testCase.pack,
          testCase.questionId,
          selected,
          fixedProbabilities(testCase.options, selected),
        );
        const expected = fixedOptionOutcome(
          testCase.pack.manifest.id,
          selected,
        );
        expect(
          result.semantic,
          `${testCase.pack.manifest.id}:${selected}`,
        ).toMatchObject({
          status: expected === "abstain" ? "abstain" : "decision",
          proposedOutcome: expected,
          selectedId: selected,
          metadata: { selected },
        });
        expect(providerCalls, `${testCase.pack.manifest.id}:${selected}`).toBe(
          1,
        );
        expect(
          result.receipt.outcome,
          `${testCase.pack.manifest.id}:${selected}`,
        ).toBe(expected);
        expect(JSON.stringify(result.receipt)).not.toContain("private-note");
      }
    }
  });

  it("keeps static deny ahead of every fixed-option provider proposal", async () => {
    const cases = [
      [screenPack, "screen-triage", "accept", ["accept", "reject", "abstain"]],
      [
        verifyPack,
        "verify-assertion",
        "supported",
        ["supported", "unsupported"],
      ],
      [
        progressPack,
        "progress-state",
        "in_progress",
        ["not_started", "in_progress", "blocked"],
      ],
      [
        completionPack,
        "completion-state",
        "complete",
        ["complete", "incomplete"],
      ],
    ] as const;
    for (const [pack, questionId, selected, options] of cases) {
      const { result, providerCalls } = await evaluateFixedOption(
        pack,
        questionId,
        selected,
        fixedProbabilities(options, selected),
        undefined,
        [
          {
            id: "static-deny",
            phase: "static",
            outcome: "deny",
            reasonCode: "HOST_STATIC_DENY",
            action: pack.manifest.id,
          },
        ],
      );
      expect(providerCalls, `${pack.manifest.id}:static-deny`).toBe(0);
      expect(result.receipt.outcome, `${pack.manifest.id}:static-deny`).toBe(
        "deny",
      );
      expect(result.receipt.reasonCodes).toContain("HOST_STATIC_DENY");
    }
  });

  it("fails closed for invalid fixed-option semantic choices and skips empty coverage", async () => {
    const cases = [
      {
        pack: screenPack,
        questionId: "screen-triage",
        options: ["accept", "reject", "abstain"],
      },
      {
        pack: verifyPack,
        questionId: "verify-assertion",
        options: ["supported", "unsupported"],
      },
      {
        pack: progressPack,
        questionId: "progress-state",
        options: ["not_started", "in_progress", "blocked"],
      },
      {
        pack: completionPack,
        questionId: "completion-state",
        options: ["complete", "incomplete"],
      },
    ] as const;

    for (const testCase of cases) {
      const tied = await evaluateFixedOption(
        testCase.pack,
        testCase.questionId,
        testCase.options[0],
        tiedProbabilities(testCase.options),
      );
      expect(
        tied.result.semantic.status,
        `${testCase.pack.manifest.id}:tied`,
      ).toBe("abstain");
      expect(tied.providerCalls, `${testCase.pack.manifest.id}:tied`).toBe(1);

      const lowConfidence = await evaluateFixedOption(
        testCase.pack,
        testCase.questionId,
        testCase.options[0],
        lowConfidenceProbabilities(testCase.options),
      );
      expect(
        lowConfidence.result.semantic.status,
        `${testCase.pack.manifest.id}:low-confidence`,
      ).toBe("abstain");
      expect(
        lowConfidence.providerCalls,
        `${testCase.pack.manifest.id}:low-confidence`,
      ).toBe(1);

      const malformed = await evaluateFixedOption(
        testCase.pack,
        testCase.questionId,
        "forged",
        fixedProbabilities(testCase.options, testCase.options[0]),
      );
      expect(
        malformed.result.semantic.status,
        `${testCase.pack.manifest.id}:malformed`,
      ).toBe("abstain");
      expect(
        malformed.providerCalls,
        `${testCase.pack.manifest.id}:malformed`,
      ).toBe(1);

      const empty = await evaluateFixedOption(
        testCase.pack,
        testCase.questionId,
        testCase.options[0],
        fixedProbabilities(testCase.options, testCase.options[0]),
        [],
      );
      expect(
        empty.result.semantic.status,
        `${testCase.pack.manifest.id}:empty`,
      ).toBe("abstain");
      expect(empty.providerCalls, `${testCase.pack.manifest.id}:empty`).toBe(0);
      expect(
        empty.result.answers,
        `${testCase.pack.manifest.id}:empty`,
      ).toEqual([]);
    }
  });

  it("rejects old label-only fixture rows instead of inferring their inputs", () => {
    expect(() =>
      parseFixture({ label: "normal", state: {}, expected: "route" }),
    ).toThrow("unknown or missing fields");
  });

  it("uses the public candidate contract and only asks rank absolute-fit when trusted input enables it", () => {
    expect(() =>
      parseFixture({
        id: "normal",
        pack: "rank",
        state: {
          candidates: [
            {
              id: "one",
              description: "one",
              available: null,
              freshness: "current",
            },
          ],
        },
        evidence: {},
        script: { kind: "failure", failure: { name: "Error", message: "x" } },
        authorization: {},
        policy: { rules: [] },
        budget: { requests: 0 },
        cache: { mode: "cold", maxEntries: 1 },
        expected: {
          semanticStatus: "abstain",
          semanticData: {},
          policyOutcome: "abstain",
          providerCallCount: 0,
          schedulerAttemptCount: 0,
          negativeInvariant: "x",
        },
      }),
    ).toThrow("available must be boolean");
    const implementation = rankPack.implementations;
    if (!implementation) throw new Error("rank implementation missing");
    const values = [
      { id: "one", description: "one" },
      { id: "two", description: "two" },
    ];
    expect(
      implementation.questions({ candidates: values }, values),
    ).toHaveLength(1);
    expect(
      implementation.questions(
        { candidates: values, absoluteFit: true },
        values,
      ),
    ).toHaveLength(2);
  });

  for (const packId of fixturePackIds) {
    it(`${packId} supplies six unique strict executable cases`, async () => {
      const fixtures = await loadPackFixtures(fixtureRoot, packId);
      expect(fixtures).toHaveLength(6);
      expect(new Set(fixtures.map((fixture) => fixture.id)).size).toBe(6);
    });
  }

  for (const packId of fixturePackIds) {
    it(`${packId} executes every fixture through FabricRuntime`, async () => {
      const pack = packs.get(packId);
      if (!pack) throw new Error(`missing built-in pack ${packId}`);
      const fixtures = await loadPackFixtures(fixtureRoot, packId);
      for (const fixture of fixtures) {
        const { result, providerCalls } = await executeFixture(pack, fixture);
        expect(result.semantic.status, fixture.id).toBe(
          fixture.expected.semanticStatus,
        );
        expect(result.semantic, fixture.id).toMatchObject(
          fixture.expected.semanticData,
        );
        expect(result.receipt.outcome, fixture.id).toBe(
          fixture.expected.policyOutcome,
        );
        expect(providerCalls, fixture.id).toBe(
          fixture.expected.providerCallCount,
        );
        expect(result.accounting.transportAttemptCount, fixture.id).toBe(
          fixture.expected.schedulerAttemptCount,
        );
        assertNegativeInvariant(fixture, result, providerCalls);
      }
    });
  }
});

async function executeFixture(
  pack: (typeof builtinPacks)[number],
  fixture: ExecutableFixture,
) {
  const cache = new MemoryDecisionCache({
    maxEntries: fixture.cache.maxEntries,
  });
  const input = {
    pack,
    state: { ...fixture.state, evidence: fixture.evidence },
    tenantId: fixture.authorization.tenantId,
    action: fixture.pack,
    knownActions: [fixture.pack],
    authorization: fixture.authorization,
    rules: fixture.policy.rules,
  };
  if (fixture.cache.mode === "warm") {
    if (fixture.script.kind !== "response")
      throw new Error(`${fixture.id}: warm cache requires a response`);
    await runtimeFor(cache, fixture.budget.requests, [
      { response: fixture.script.response },
    ]).runtime.evaluate(input);
  }
  const steps =
    fixture.cache.mode === "warm"
      ? []
      : fixture.script.kind === "response"
        ? [{ response: fixture.script.response }]
        : [
            {
              error: namedError(
                fixture.script.failure.name,
                fixture.script.failure.message,
              ),
            },
          ];
  const execution = runtimeFor(cache, fixture.budget.requests, steps);
  return {
    result: await execution.runtime.evaluate(input),
    providerCalls: execution.calls(),
  };
}

function runtimeFor(
  cache: MemoryDecisionCache<unknown>,
  requests: number,
  steps: ConstructorParameters<typeof ScriptedProvider>[0]["steps"],
) {
  let providerCalls = 0;
  const provider = new ScriptedProvider({
    id: "fixture",
    model: "fixture-model",
    steps,
    onAttempt: () => {
      providerCalls += 1;
    },
  });
  return {
    runtime: new FabricRuntime({
      provider,
      model: "fixture-model",
      cache: cache as MemoryDecisionCache<{
        readonly response: import("@mokimeow/jev-fabric-protocol").DecisionResponse;
      }>,
      scheduler: new DecisionScheduler({
        providerConcurrency: 1,
        tenantConcurrency: 1,
        budget: new BudgetLedger({ requests }),
      }),
      now: () => 0,
    }),
    calls: () => providerCalls,
  };
}

function fixedProbabilities(
  options: readonly string[],
  selected: string,
): Record<string, number> {
  return Object.fromEntries(
    options.map((option) => [option, option === selected ? 1 : 0]),
  );
}

function tiedProbabilities(options: readonly string[]): Record<string, number> {
  return Object.fromEntries(
    options.map((option, index) => [option, index < 2 ? 0.5 : 0]),
  );
}

function lowConfidenceProbabilities(
  options: readonly string[],
): Record<string, number> {
  return Object.fromEntries(
    options.map((option, index) => {
      if (index === 0) return [option, options.length === 2 ? 0.55 : 0.5];
      return [option, options.length === 2 ? 0.45 : 0.25];
    }),
  );
}

function fixedOptionOutcome(pack: string, selected: string) {
  const table = {
    screen: { accept: "allow", reject: "deny", abstain: "abstain" },
    verify: { supported: "allow", unsupported: "deny" },
    progress: {
      not_started: "abstain",
      in_progress: "allow",
      blocked: "escalate",
    },
    completion: { complete: "allow", incomplete: "deny" },
  } as const;
  const outcome = table[pack as keyof typeof table]?.[selected as never];
  if (outcome === undefined) throw new Error(`unknown fixed option: ${pack}`);
  return outcome;
}

async function evaluateFixedOption(
  pack: (typeof builtinPacks)[number],
  questionId: string,
  selected: string,
  probabilities: Record<string, number>,
  candidates = [
    { id: "candidate-one", description: "first candidate" },
    { id: "candidate-two", description: "second candidate" },
  ],
  rules: readonly import("@mokimeow/jev-fabric-core").PolicyRule[] = [],
) {
  let providerCalls = 0;
  const provider = new ScriptedProvider({
    id: "fixed-option-fixture",
    model: "fixture-model",
    steps: [
      {
        response: {
          answers: [{ questionId, type: "choice", selected, probabilities }],
        },
      },
    ],
    onAttempt: () => {
      providerCalls += 1;
    },
  });
  const runtime = new FabricRuntime({
    provider,
    model: "fixture-model",
    cache: new MemoryDecisionCache({ maxEntries: 4 }),
    scheduler: new DecisionScheduler({
      providerConcurrency: 1,
      tenantConcurrency: 1,
      budget: new BudgetLedger({ requests: 1 }),
    }),
    now: () => 0,
  });
  return {
    result: await runtime.evaluate({
      pack,
      state: {
        candidates,
        claimedChecks: ["unit"],
        observedChecks: ["unit"],
        note: "private-note",
      },
      tenantId: "tenant",
      action: pack.manifest.id,
      knownActions: [pack.manifest.id],
      rules,
      authorization: {
        principalId: "principal",
        tenantId: "tenant",
        workspaceId: "workspace",
        resourceScopes: ["*"],
        actionScopes: ["*"],
        permissionEpoch: "epoch",
        approvalReferences: [],
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    }),
    providerCalls,
  };
}

function namedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function assertNegativeInvariant(
  fixture: ExecutableFixture,
  result: Awaited<ReturnType<FabricRuntime["evaluate"]>>,
  providerCalls: number,
): void {
  switch (fixture.expected.negativeInvariant) {
    case "cache_hit_has_no_provider_attempt":
      expect(result.receipt.cache, fixture.id).toBe("hit");
      expect(providerCalls, fixture.id).toBe(0);
      return;
    case "no_match_is_not_a_selection":
      expect(result.semantic.status, fixture.id).not.toBe("decision");
      expect(result.semantic.selectedId, fixture.id).toBe(
        fixture.pack === "screen" ? "abstain" : undefined,
      );
      return;
    case "ambiguity_does_not_become_coverage_failure":
      expect(result.coverageFailure, fixture.id).toBeUndefined();
      expect(providerCalls, fixture.id).toBeGreaterThan(0);
      return;
    case "untrusted_text_is_not_selected":
      expect(result.semantic.selectedId, fixture.id).not.toBe(
        "ignore_instructions",
      );
      return;
    case "stale_candidates_are_not_sent_to_provider":
      expect(providerCalls, fixture.id).toBe(0);
      expect(result.answers, fixture.id).toEqual([]);
      return;
    case "provider_failure_records_an_attempt":
      expect(
        result.accounting.transportAttemptCount,
        fixture.id,
      ).toBeGreaterThan(0);
      return;
    case "static_deny_has_no_provider_attempt":
      expect(providerCalls, fixture.id).toBe(0);
      expect(result.receipt.outcome, fixture.id).toBe("deny");
      return;
    default:
      throw new Error(
        `${fixture.id}: unknown negative invariant ${fixture.expected.negativeInvariant}`,
      );
  }
}

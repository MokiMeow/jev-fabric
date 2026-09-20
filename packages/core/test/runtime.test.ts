import { validateDecisionResponse } from "@mokimeow/jev-fabric-protocol";
import { describe, expect, it } from "vitest";
import { BudgetLedger } from "../src/budget.js";
import { MemoryDecisionCache } from "../src/cache.js";
import { definePack } from "../src/pack.js";
import {
  FabricRuntime,
  type FabricRuntimeOptions,
  ProviderOutageError,
} from "../src/runtime.js";
import { DecisionScheduler } from "../src/scheduler.js";

const limits = {
  maxStateBytes: 1024,
  maxStateDepth: 4,
  maxStateItems: 10,
  maxStringBytes: 128,
  maxCandidates: 3,
  maxCandidateIdLength: 20,
  maxCandidateDescriptionBytes: 128,
};
const pack = definePack(
  {
    id: "route",
    version: "1.0.0",
    riskTier: "low",
    limits,
    candidateBehavior: "no_match",
    failure: { outage: "unavailable", providerFailure: "abstain" },
    requiredCapabilities: {
      questionTypes: ["choice"],
      probabilitySemantics: ["synthetic"],
    },
    evidence: { projectorId: "route-state", revision: "1" },
  },
  {
    projector: { project: (input) => input },
    candidates: {
      provide: () => [
        { id: "go", description: "Go" },
        { id: "stay", description: "Stay" },
      ],
    },
    bypass: () => ({ outcome: "deny", reasonCode: "STATIC_DENY" }),
    questions: () => [],
    interpret: () => ({
      status: "abstain",
      proposedOutcome: "abstain",
      metadata: {},
    }),
  },
);

describe("FabricRuntime", () => {
  const livePack = () => {
    const implementations = pack.implementations;
    if (!implementations) throw new Error("test pack implementations missing");
    return definePack(
      { ...pack.manifest, id: "live-route" },
      {
        projector: implementations.projector,
        candidates: implementations.candidates,
        questions: () => [
          {
            id: "q",
            type: "choice",
            instructions: {},
            criteria: {},
            options: ["go", "stay"],
          },
        ],
        interpret: () => ({
          status: "decision",
          proposedOutcome: "allow",
          metadata: {},
        }),
      },
    );
  };
  const response = (requestId: string) => ({
    requestId,
    providerId: "test",
    model: "synthetic-model",
    probabilitySemantics: "synthetic" as const,
    answers: [
      {
        questionId: "q",
        type: "choice" as const,
        selected: "go",
        probabilities: { go: 1, stay: 0 },
      },
    ],
  });
  const input = () => ({
    pack: livePack(),
    state: { purpose: "go" },
    tenantId: "tenant",
    action: "route",
    knownActions: ["route"],
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
  });
  it("rejects any runtime missing its mandatory live-call scheduler", () => {
    expect(
      () =>
        new FabricRuntime({
          provider: {
            id: "test",
            capabilities: {
              questionTypes: ["choice"],
              probabilitySemantics: ["synthetic"],
              maxQuestions: 1,
            },
            evaluate: async () => {
              throw new Error("unused");
            },
          },
          model: "synthetic-model",
          cache: new MemoryDecisionCache({ maxEntries: 2 }),
        } as unknown as FabricRuntimeOptions),
    ).toThrow("scheduler");
  });

  it("bypasses before cache and provider with an honest zero-attempt receipt", async () => {
    let calls = 0;
    const runtime = new FabricRuntime({
      provider: {
        id: "test",
        capabilities: {
          questionTypes: ["choice"],
          probabilitySemantics: ["synthetic"],
          maxQuestions: 1,
        },
        evaluate: async () => {
          calls += 1;
          throw new Error("must not run");
        },
      },
      model: "synthetic-model",
      cache: new MemoryDecisionCache({ maxEntries: 2 }),
      scheduler: new DecisionScheduler({
        providerConcurrency: 1,
        tenantConcurrency: 1,
        budget: new BudgetLedger({ requests: 1 }),
      }),
      now: () => 0,
    });
    const result = await runtime.evaluate({
      pack,
      state: { purpose: "block" },
      tenantId: "tenant",
      action: "route",
      knownActions: ["route"],
    });
    expect(calls).toBe(0);
    expect(result.receipt.cache).toBe("bypass");
    expect(result.accounting.transportAttemptCount).toBe(0);
    expect(result.receipt.outcome).toBe("deny");
  });

  it("rejects credential-bearing projected state before provider request construction", async () => {
    const seen: unknown[] = [];
    const runtime = new FabricRuntime({
      provider: {
        id: "capturing-provider",
        capabilities: {
          questionTypes: ["choice"],
          probabilitySemantics: ["synthetic"],
          maxQuestions: 1,
        },
        evaluate: async (request) => {
          seen.push(request);
          return response(request.id);
        },
      },
      model: "synthetic-model",
      cache: new MemoryDecisionCache({ maxEntries: 2 }),
      scheduler: new DecisionScheduler({
        providerConcurrency: 1,
        tenantConcurrency: 1,
        budget: new BudgetLedger({ requests: 1 }),
      }),
    });
    for (const state of [
      { apiKey: "apikey_1234567890abcdef" },
      { note: "Bearer attackersecret-123456789" },
      {
        nested: {
          note: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature-part",
        },
      },
    ])
      await expect(runtime.evaluate({ ...input(), state })).rejects.toThrow(
        /state/i,
      );
    expect(seen).toEqual([]);
  });

  it("preserves a deterministic pack denial under high-risk policy", async () => {
    const implementations = pack.implementations;
    if (!implementations) throw new Error("test pack implementations missing");
    const denyPack = definePack(
      { ...pack.manifest, id: "risk", riskTier: "high" },
      {
        ...implementations,
        bypass: () => ({ outcome: "deny", reasonCode: "PACK_DENY" }),
      },
    );
    const runtime = new FabricRuntime({
      provider: {
        id: "test",
        capabilities: {
          questionTypes: ["choice"],
          probabilitySemantics: ["synthetic"],
          maxQuestions: 1,
        },
        evaluate: async () => {
          throw new Error("must not run");
        },
      },
      model: "synthetic-model",
      cache: new MemoryDecisionCache({ maxEntries: 2 }),
      scheduler: new DecisionScheduler({
        providerConcurrency: 1,
        tenantConcurrency: 1,
        budget: new BudgetLedger({ requests: 1 }),
      }),
      now: () => 0,
    });
    const result = await runtime.evaluate({
      pack: denyPack,
      state: { purpose: "block" },
      tenantId: "tenant",
      action: "risk",
      knownActions: ["risk"],
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
    });
    expect(result.receipt.outcome).toBe("deny");
    expect(result.accounting.transportAttemptCount).toBe(0);
  });

  it("finds an outage through RetryExhaustedError cause chains and keeps each attempt", async () => {
    const attempts: unknown[] = [];
    const runtime = new FabricRuntime({
      provider: {
        id: "test",
        capabilities: {
          questionTypes: ["choice"],
          probabilitySemantics: ["synthetic"],
          maxQuestions: 1,
        },
        evaluate: async () => {
          throw new ProviderOutageError("down");
        },
      },
      model: "synthetic-model",
      cache: new MemoryDecisionCache({ maxEntries: 2 }),
      scheduler: new DecisionScheduler({
        providerConcurrency: 1,
        tenantConcurrency: 1,
        budget: new BudgetLedger({ requests: 2 }),
        sleep: async () => {},
      }),
      retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 },
      now: () => 0,
    });
    const result = await runtime.evaluate(input());
    expect(result.receipt.reasonCodes).toContain("PROVIDER_OUTAGE");
    expect(result.receipt.outcome).toBe("unavailable");
    expect(result.accounting.transportAttemptCount).toBe(2);
    expect(attempts).toHaveLength(0);
  });

  it("retries success, records exhaustion, and never starts an unfunded second attempt", async () => {
    let calls = 0;
    let validationFailure: string | undefined;
    const make = (requests: number, steps: readonly ("fail" | "ok")[]) =>
      new FabricRuntime({
        provider: {
          id: "test",
          capabilities: {
            questionTypes: ["choice"],
            probabilitySemantics: ["synthetic"],
            maxQuestions: 1,
          },
          evaluate: async (request) => {
            const step = steps[calls++];
            if (step === "fail") throw new Error("retry");
            try {
              return validateDecisionResponse(request, response(request.id));
            } catch (error) {
              validationFailure =
                error instanceof Error ? error.message : String(error);
              throw error;
            }
          },
        },
        model: "synthetic-model",
        cache: new MemoryDecisionCache({ maxEntries: 2 }),
        scheduler: new DecisionScheduler({
          providerConcurrency: 1,
          tenantConcurrency: 1,
          budget: new BudgetLedger({ requests }),
          sleep: async () => {},
        }),
        retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 },
        now: () => 0,
      });
    const succeeded = await make(2, ["fail", "ok"]).evaluate(input());
    expect(calls).toBe(2);
    expect(validationFailure).toBeUndefined();
    expect(succeeded.receipt.reasonCodes).toEqual([
      "PACK_DEFAULT",
      "NO_POLICY_MATCH",
    ]);
    expect(succeeded.accounting.transportAttemptCount).toBe(2);
    calls = 0;
    const exhausted = await make(2, ["fail", "fail"]).evaluate(input());
    expect(exhausted.accounting.transportAttemptCount).toBe(2);
    expect(exhausted.receipt.reasonCodes).toContain("PROVIDER_FAILURE");
    calls = 0;
    const unfunded = await make(1, ["fail", "ok"]).evaluate(input());
    expect(calls).toBe(1);
    expect(unfunded.accounting.transportAttemptCount).toBe(1);
  });

  it("passes immutable provider semantics to pack interpretation on live and cached responses", async () => {
    const contexts: import("../src/pack.js").PackInterpretContext[] = [];
    const implementations = pack.implementations;
    if (!implementations) throw new Error("test pack implementations missing");
    const contextPack = definePack(
      { ...pack.manifest, id: "interpret-context" },
      {
        ...implementations,
        bypass: () => undefined,
        questions: () => [
          {
            id: "q",
            type: "choice",
            instructions: {},
            criteria: {},
            options: ["go", "stay"],
          },
        ],
        interpret: (_answers, _candidates, context) => {
          if (!context) throw new Error("interpret context missing");
          contexts.push(context);
          return {
            status: "decision",
            proposedOutcome: "allow",
            metadata: {},
          };
        },
      },
    );
    const cache = new MemoryDecisionCache<{
      readonly response: import("@mokimeow/jev-fabric-protocol").DecisionResponse;
    }>({ maxEntries: 2 });
    const runtime = new FabricRuntime({
      provider: {
        id: "test",
        capabilities: {
          questionTypes: ["choice"],
          probabilitySemantics: ["synthetic"],
          maxQuestions: 1,
        },
        evaluate: async (request) => response(request.id),
      },
      model: "synthetic-model",
      cache,
      scheduler: new DecisionScheduler({
        providerConcurrency: 1,
        tenantConcurrency: 1,
        budget: new BudgetLedger({ requests: 1 }),
      }),
    });
    const request = { ...input(), pack: contextPack };

    await runtime.evaluate(request);
    await runtime.evaluate(request);

    expect(contexts).toHaveLength(2);
    expect(contexts).toEqual([
      {
        providerId: "test",
        model: "synthetic-model",
        probabilitySemantics: "synthetic",
      },
      {
        providerId: "test",
        model: "synthetic-model",
        probabilitySemantics: "synthetic",
      },
    ]);
    expect(Object.isFrozen(contexts[0])).toBe(true);
  });

  it("keeps a validated result when persistence fails and reports caller cancellation/deadline separately", async () => {
    const cache = new MemoryDecisionCache<{
      readonly response: import("@mokimeow/jev-fabric-protocol").DecisionResponse;
    }>({ maxEntries: 2 });
    cache.set = async () => {
      throw new Error("disk unavailable");
    };
    const runtime = new FabricRuntime({
      provider: {
        id: "test",
        capabilities: {
          questionTypes: ["choice"],
          probabilitySemantics: ["synthetic"],
          maxQuestions: 1,
        },
        evaluate: async (request) =>
          validateDecisionResponse(request, response(request.id)),
      },
      model: "synthetic-model",
      cache,
      scheduler: new DecisionScheduler({
        providerConcurrency: 1,
        tenantConcurrency: 1,
        budget: new BudgetLedger({ requests: 1 }),
      }),
      retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
      now: () => 0,
    });
    const stored = await runtime.evaluate(input());
    expect(stored.semantic.status).toBe("decision");
    expect(stored.receipt.cacheWrite).toBe("failed");
    expect(stored.cacheWriteFailure).toBe("disk unavailable");
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    const cancelled = await runtime.evaluate({
      ...input(),
      signal: controller.signal,
    });
    expect(cancelled.termination).toBe("cancelled");
    expect(cancelled.receipt.reasonCodes).toContain("CALLER_ABORTED");
    const deadlineRuntime = new FabricRuntime({
      provider: {
        id: "test",
        capabilities: {
          questionTypes: ["choice"],
          probabilitySemantics: ["synthetic"],
          maxQuestions: 1,
        },
        evaluate: async (request) =>
          validateDecisionResponse(request, response(request.id)),
      },
      model: "synthetic-model",
      cache: new MemoryDecisionCache({ maxEntries: 2 }),
      scheduler: new DecisionScheduler({
        providerConcurrency: 1,
        tenantConcurrency: 1,
        budget: new BudgetLedger({ requests: 1 }),
      }),
      retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
      now: () => 0,
    });
    const deadline = await deadlineRuntime.evaluate({
      ...input(),
      deadlineMs: 0,
    });
    expect(deadline.termination).toBe("deadline");
    expect(deadline.receipt.reasonCodes).toContain("DEADLINE_EXCEEDED");
    expect(deadline.accounting.transportAttemptCount).toBe(0);
  });
});

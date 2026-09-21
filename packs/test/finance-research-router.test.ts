import { createHash } from "node:crypto";
import {
  BudgetLedger,
  DecisionScheduler,
  FabricRuntime,
  MemoryDecisionCache,
  ScriptedProvider,
} from "@mokimeow/jev-fabric-core";
import { decisionRequestSchema } from "@mokimeow/jev-fabric-protocol";
import { describe, expect, it } from "vitest";
import {
  financeResearchRouterPack,
  financeResearchRouterQuestionSetHash,
} from "../finance-research-router/pack.js";

const candidates = [
  {
    id: "plot_price",
    description: "Propose a read-only historical price chart",
    available: true,
    freshness: "current",
  },
  {
    id: "compare_returns",
    description: "Propose a read-only comparison of historical returns",
    available: true,
    freshness: "current",
  },
  {
    id: "rolling_correlation",
    description: "Propose a read-only rolling-correlation calculation",
    available: true,
    freshness: "current",
  },
  {
    id: "summary_stats",
    description: "Propose read-only descriptive statistics",
    available: true,
    freshness: "current",
  },
  {
    id: "market_summary",
    description: "Propose a read-only market summary",
    available: true,
    freshness: "current",
  },
  {
    id: "list_symbols",
    description: "List the host-declared research symbols",
    available: true,
    freshness: "current",
  },
  {
    id: "investigate",
    description: "Route an unsafe, unsupported, or ambiguous request to review",
    available: true,
    freshness: "current",
  },
] as const;

const sha256 = (value: string): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

function state(text = "Show AAPL price history for one month.") {
  return {
    contractVersion: "1",
    advisoryOnly: true,
    execution: "NOT_SUPPORTED",
    purpose: "read_only_market_research",
    requestRef: "ref:research-1",
    observedAt: "1970-01-01T00:00:00.000Z",
    validUntil: "1970-01-01T00:01:00.000Z",
    maxAgeMs: 60_000,
    request: {
      text,
      textHash: sha256(text),
      trust: "untrusted_data_only",
      redaction: "host_redacted",
    },
    symbols: [
      {
        id: "AAPL",
        displayName: "Apple Inc.",
        available: true,
        freshness: "current",
      },
      {
        id: "MSFT",
        displayName: "Microsoft Corp.",
        available: true,
        freshness: "current",
      },
    ],
    candidates,
  } as const;
}

function distribution(options: readonly string[], selected: string) {
  return Object.fromEntries(
    options.map((option) => [option, option === selected ? 1 : 0]),
  );
}

function answers(
  options: {
    prohibited?: boolean;
    influence?: boolean;
    tool?: string;
    primary?: string;
    secondary?: string;
    window?: string;
  } = {},
) {
  const symbolOptions = ["AAPL", "MSFT", "not_applicable", "not_listed"];
  const toolOptions = candidates.map(({ id }) => id);
  const windowOptions = [
    "one_day",
    "five_days",
    "one_month",
    "three_months",
    "six_months",
    "one_year",
    "not_specified",
  ];
  const prohibited = options.prohibited ?? false;
  const influence = options.influence ?? false;
  const tool = options.tool ?? "plot_price";
  const primary = options.primary ?? "AAPL";
  const secondary = options.secondary ?? "not_applicable";
  const window = options.window ?? "one_month";
  return [
    {
      questionId: "finance-research-prohibited-intent",
      type: "noul" as const,
      value: prohibited,
      probabilityYes: prohibited ? 0.9 : 0.1,
    },
    {
      questionId: "finance-research-untrusted-influence",
      type: "noul" as const,
      value: influence,
      probabilityYes: influence ? 0.9 : 0.1,
    },
    {
      questionId: "finance-research-tool",
      type: "choice" as const,
      selected: tool,
      probabilities: distribution(toolOptions, tool),
    },
    {
      questionId: "finance-research-primary-symbol",
      type: "choice" as const,
      selected: primary,
      probabilities: distribution(symbolOptions, primary),
    },
    {
      questionId: "finance-research-secondary-symbol",
      type: "choice" as const,
      selected: secondary,
      probabilities: distribution(symbolOptions, secondary),
    },
    {
      questionId: "finance-research-window",
      type: "choice" as const,
      selected: window,
      probabilities: distribution(windowOptions, window),
    },
  ];
}

async function evaluate(responseAnswers = answers()) {
  const provider = new ScriptedProvider({
    id: "fixture",
    model: "fixture-model",
    steps: [{ response: { answers: responseAnswers } }],
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
  return runtime.evaluate({
    pack: financeResearchRouterPack,
    state: state(),
    tenantId: "tenant",
    action: "finance-research-router",
    knownActions: ["finance-research-router"],
    authorization: {
      principalId: "principal",
      tenantId: "tenant",
      workspaceId: "workspace",
      resourceScopes: ["market-research"],
      actionScopes: ["finance-research-router"],
      permissionEpoch: "epoch",
      approvalReferences: [],
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
  });
}

describe("finance research router", () => {
  it("emits one native-compatible batch over only projected read-only state", () => {
    const implementation = financeResearchRouterPack.implementations;
    if (!implementation) throw new Error("implementation missing");
    const input = state();
    const projectionContext = { nowEpochMs: 0 };
    const projected = implementation.projector.project(input, {
      nowEpochMs: 0,
    }) as Record<string, unknown>;
    const bindingHash = implementation.projector.bindingHash?.(
      input,
      projectionContext,
    );
    const provided = implementation.candidates.provide(projected);
    const questions = implementation.questions(projected, provided);

    expect(questions).toHaveLength(6);
    expect(financeResearchRouterQuestionSetHash).toBe(
      "sha256:9ba17108b674b519bf763763db63c9b9c123db0c737554165b7a6180c6a1a2fa",
    );
    expect(() =>
      decisionRequestSchema.parse({
        id: "finance-research-test",
        state: projected,
        questions,
      }),
    ).not.toThrow();
    expect(projected).not.toHaveProperty("observedAt");
    expect(projected).not.toHaveProperty("validUntil");
    expect(projected).not.toHaveProperty("evidenceEnvelopeHash");
    expect(projected.request).not.toHaveProperty("textHash");
    expect(JSON.stringify(projected)).not.toContain("sha256:");
    expect(bindingHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(questions)).not.toContain(state().request.text);
  });

  it("returns only a revalidated read-only proposal for a supported request", async () => {
    const result = await evaluate();

    expect(result.receipt.outcome).toBe("route");
    expect(result.semantic).toMatchObject({
      status: "decision",
      selectedId: "plot_price",
      proposedOutcome: "route",
      metadata: {
        advisoryOnly: true,
        readOnly: true,
        execution: "NOT_SUPPORTED",
        authority: "NONE",
        tool: "plot_price",
        arguments: { symbol: "AAPL", window: "1mo" },
        requiresHostRevalidation: true,
      },
    });
    expect(JSON.stringify(result.semantic)).not.toMatch(
      /\b(?:buy|sell|hold|trade|order|execute)\b/iu,
    );
  });

  it("routes prohibited advice and unsupported symbols to review", async () => {
    const implementation = financeResearchRouterPack.implementations;
    if (!implementation) throw new Error("implementation missing");
    const provided = candidates.map(({ id, description }) => ({
      id,
      description,
    }));
    const prohibited = implementation.interpret(
      answers({ prohibited: true }),
      provided,
      {
        providerId: "typesafe-jev",
        model: "jev-1.13.0",
        probabilitySemantics: "native_calibrated",
      },
    );
    const missing = implementation.interpret(
      answers({
        tool: "compare_returns",
        primary: "not_listed",
        secondary: "AAPL",
      }),
      provided,
      {
        providerId: "typesafe-jev",
        model: "jev-1.13.0",
        probabilitySemantics: "native_calibrated",
      },
    );

    expect(prohibited).toMatchObject({
      selectedId: "investigate",
      proposedOutcome: "ask",
      metadata: { reason: "prohibited_financial_intent" },
    });
    expect(missing).toMatchObject({
      selectedId: "investigate",
      proposedOutcome: "ask",
      metadata: { reason: "missing_or_ambiguous_symbol" },
    });
  });

  it("escalates influence and malformed provider answers", () => {
    const implementation = financeResearchRouterPack.implementations;
    if (!implementation) throw new Error("implementation missing");
    const provided = candidates.map(({ id, description }) => ({
      id,
      description,
    }));

    expect(
      implementation.interpret(answers({ influence: true }), provided),
    ).toMatchObject({
      selectedId: "investigate",
      proposedOutcome: "escalate",
      metadata: { reason: "untrusted_influence" },
    });
    expect(
      implementation.interpret(answers().slice(0, 5), provided),
    ).toMatchObject({
      selectedId: "investigate",
      proposedOutcome: "escalate",
      metadata: { reason: "malformed_provider_answer" },
    });

    const tiedTool = answers().map((answer) =>
      answer.questionId === "finance-research-tool"
        ? {
            ...answer,
            selected: "plot_price",
            probabilities: {
              plot_price: 0.5,
              compare_returns: 0,
              rolling_correlation: 0,
              summary_stats: 0,
              market_summary: 0,
              list_symbols: 0,
              investigate: 0.5,
            },
          }
        : answer,
    );
    const tiedSymbol = answers().map((answer) =>
      answer.questionId === "finance-research-primary-symbol"
        ? {
            ...answer,
            selected: "AAPL",
            probabilities: {
              AAPL: 0.5,
              MSFT: 0.5,
              not_applicable: 0,
              not_listed: 0,
            },
          }
        : answer,
    );
    for (const tied of [tiedTool, tiedSymbol])
      expect(implementation.interpret(tied, provided)).toMatchObject({
        selectedId: "investigate",
        proposedOutcome: "escalate",
        metadata: { reason: "malformed_provider_answer" },
      });
  });

  it("rejects stale, tampered, execution-capable, and hostile state before egress", () => {
    const project = (value: unknown, nowEpochMs = 0) =>
      financeResearchRouterPack.implementations?.projector.project(value, {
        nowEpochMs,
      });

    expect(() => project(state(), 60_001)).toThrow(/stale/u);
    expect(() =>
      project({
        ...state(),
        request: { ...state().request, textHash: `sha256:${"0".repeat(64)}` },
      }),
    ).toThrow(/hash binding/u);
    expect(() => project({ ...state(), execution: "ENABLED" })).not.toThrow();
    expect(
      financeResearchRouterPack.implementations?.bypass?.({
        advisoryOnly: true,
        execution: "ENABLED",
        purpose: "read_only_market_research",
      }),
    ).toMatchObject({ outcome: "deny" });
    expect(() => project({ ...state(), command: "place-order" })).toThrow(
      /unsupported field/u,
    );
    expect(() =>
      project({
        ...state(),
        symbols: [...state().symbols].reverse(),
      }),
    ).toThrow(/unique and sorted/u);
    const proxied = new Proxy(state(), {});
    expect(() => project(proxied)).toThrow(/plain data/u);
  });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import type { FinanceAdvisoryState } from "../../../packages/adapters/src/index.js";
import type {
  DecisionAnswer,
  DecisionRequest,
  EvaluateOptions,
  ProbabilitySemantics,
} from "../../../packages/protocol/src/index.js";
import { OpenAICompatibleProvider } from "../../../packages/provider-openai-compatible/src/index.js";
import {
  createOpenAICompatibleFinanceInvoker,
  createTrustedFinanceDriverBundle,
  createTypeSafeFinanceInvoker,
  type FinanceMeasuredProviderInvoker,
  type FinanceMeasuredProviderResult,
  type FinanceProviderArmOptions,
  type FinanceProviderPricing,
} from "./drivers.mjs";
import type { FinanceDriverContext } from "./run.mjs";
import type { ArchitectureRuntimeModelVersionEvidence } from "./run.mjs";

const hash = (character: string) => `sha256:${character.repeat(64)}`;
const candidates = [
  {
    id: "observe",
    description: "Record the advisory observation only",
    available: true,
    freshness: "current",
  },
  {
    id: "investigate",
    description: "Route to bounded analyst investigation",
    available: true,
    freshness: "current",
  },
  {
    id: "escalate",
    description: "Escalate to an authorized human reviewer",
    available: true,
    freshness: "current",
  },
] as const;

function financeState(
  bucket: "low" | "normal" | "elevated" | "extreme" | "unknown" = "normal",
  instrumentRef = "ref:instrument.fixture",
): FinanceAdvisoryState {
  return {
    contractVersion: "1",
    advisoryOnly: true,
    execution: "NOT_SUPPORTED",
    instrumentRef,
    assetClass: "equity",
    venue: "fixture.venue",
    sourceId: "fixture.source",
    sourceHash: hash("a"),
    featureSetId: "fixture.features",
    featureSetVersion: "1",
    featureSetHash: hash("b"),
    observedAt: "2026-02-15T12:00:00.000Z",
    cutoffAt: "2026-02-15T11:50:00.000Z",
    windowStart: "2026-02-15T11:00:00.000Z",
    windowEnd: "2026-02-15T11:30:00.000Z",
    temporalIntegrity: "verified_no_lookahead",
    signals: [
      {
        id: "volatility.bucket",
        bucket,
        definitionHash: hash("c"),
        evidenceHash: hash("d"),
        asOf: "2026-02-15T11:40:00.000Z",
      },
    ],
    candidates,
  };
}

function context(
  architecture: FinanceDriverContext["architecture"],
  signal = new AbortController().signal,
): FinanceDriverContext {
  return { architecture, signal, track: "market_surveillance" };
}

interface AnswerSelections {
  readonly route?: "observe" | "investigate" | "escalate";
  readonly anomaly?: "routine" | "concerning" | "unclear";
  readonly quality?: "sufficient" | "conflicted" | "insufficient";
  readonly influence?: "absent" | "present";
}

function measuredResponse(
  request: DecisionRequest,
  identity: {
    readonly providerId: string;
    readonly modelVersion: string;
    readonly probabilitySemantics: ProbabilitySemantics;
  },
  selections: AnswerSelections = {},
  accounting: Omit<FinanceMeasuredProviderResult, "response"> = {
    inputTokens: 100,
    outputTokens: 20,
  },
): FinanceMeasuredProviderResult {
  const route = selections.route ?? "observe";
  const anomaly = selections.anomaly ?? "routine";
  const quality = selections.quality ?? "sufficient";
  const influence = selections.influence ?? "absent";
  const distribution = <T extends string>(
    selected: T,
    options: readonly T[],
  ): Record<T, number> =>
    Object.fromEntries(
      options.map((option) => [
        option,
        option === selected ? 0.8 : 0.2 / (options.length - 1),
      ]),
    ) as Record<T, number>;
  const answers: DecisionAnswer[] = [
    {
      questionId: "finance-route",
      type: "choice",
      selected: route,
      probabilities: distribution(route, [
        "observe",
        "investigate",
        "escalate",
      ]),
      confidence: 0.8,
    },
    {
      questionId: "finance-anomaly",
      type: "choice",
      selected: anomaly,
      probabilities: distribution(anomaly, [
        "routine",
        "concerning",
        "unclear",
      ]),
      confidence: 0.8,
    },
    {
      questionId: "finance-evidence-quality",
      type: "choice",
      selected: quality,
      probabilities: distribution(quality, [
        "sufficient",
        "conflicted",
        "insufficient",
      ]),
      confidence: 0.8,
    },
    {
      questionId: "finance-untrusted-influence",
      type: "choice",
      selected: influence,
      probabilities: distribution(influence, ["absent", "present"]),
      confidence: 0.8,
    },
  ];
  return {
    response: {
      requestId: request.id,
      providerId: identity.providerId,
      model: identity.modelVersion,
      probabilitySemantics: identity.probabilitySemantics,
      answers,
    },
    ...accounting,
  };
}

interface TestInvokerOptions {
  readonly providerId: string;
  readonly modelId?: string;
  readonly modelVersion: string;
  readonly responseModel?: string;
  readonly modelVersionEvidence?: ArchitectureRuntimeModelVersionEvidence;
  readonly probabilitySemantics?: ProbabilitySemantics;
  readonly pricing?: FinanceProviderPricing | null;
  readonly evaluate?: (
    request: DecisionRequest,
    options?: EvaluateOptions,
  ) => Promise<FinanceMeasuredProviderResult> | FinanceMeasuredProviderResult;
}

function testInvoker(
  options: TestInvokerOptions,
): FinanceMeasuredProviderInvoker & {
  readonly calls: number;
} {
  let calls = 0;
  const probabilitySemantics = options.probabilitySemantics ?? "self_reported";
  const pricing =
    options.pricing === null
      ? undefined
      : (options.pricing ?? {
          inputNanoUsdPerToken: "1",
          outputNanoUsdPerToken: "1",
          sourceUrl: "https://pricing.example.test/models",
          observedAt: "2026-09-20T00:00:00.000Z",
          priceVersion: "2026-09-20",
          priceHash: hash("9"),
        });
  return {
    providerId: options.providerId,
    modelId: options.modelId ?? options.modelVersion,
    modelVersion: options.modelVersion,
    responseModel: options.responseModel ?? options.modelVersion,
    modelVersionEvidence:
      options.modelVersionEvidence ?? ({ kind: "response_exact" } as const),
    probabilitySemantics,
    capabilities: {
      questionTypes: ["choice"],
      probabilitySemantics: [probabilitySemantics],
      maxQuestions: 100,
    },
    ...(pricing === undefined ? {} : { pricing }),
    get calls() {
      return calls;
    },
    async evaluate(request, evaluateOptions) {
      calls += 1;
      return options.evaluate
        ? options.evaluate(request, evaluateOptions)
        : measuredResponse(request, {
            providerId: options.providerId,
            modelVersion: options.responseModel ?? options.modelVersion,
            probabilitySemantics,
          });
    },
  };
}

const limits = {
  maxCalls: 20,
  maxReservedInputTokens: 20_000,
  estimatedInputTokensPerCall: 1_000,
  concurrency: 4,
  maxQueue: 20,
  deadlineMs: 1_000,
} as const;

function arm(
  invoker: FinanceMeasuredProviderInvoker,
  overrides: Partial<FinanceProviderArmOptions["limits"]> = {},
): FinanceProviderArmOptions {
  return { invoker, limits: { ...limits, ...overrides } };
}

function bundle(
  host: FinanceMeasuredProviderInvoker,
  jev: FinanceMeasuredProviderInvoker = testInvoker({
    providerId: "jev-provider",
    modelId: "jev",
    modelVersion: "jev-1.13.0",
    probabilitySemantics: "native_calibrated",
  }),
  hostLimits: Partial<FinanceProviderArmOptions["limits"]> = {},
  jevLimits: Partial<FinanceProviderArmOptions["limits"]> = {},
) {
  return createTrustedFinanceDriverBundle({
    tenantId: "finance-benchmark",
    policyVersion: "finance-policy-1",
    host: arm(host, hostLimits),
    jev: arm(jev, jevLimits),
  });
}

test("deterministic driver applies only the trusted signal lattice and derives provenance", async () => {
  const host = testInvoker({
    providerId: "host-provider",
    modelVersion: "host-2026-09-01",
  });
  const jev = testInvoker({
    providerId: "jev-provider",
    modelVersion: "jev-1.13.0",
    probabilitySemantics: "native_calibrated",
  });
  const created = bundle(host, jev);
  const driver = created.drivers.deterministic_only;

  for (const [bucket, expected] of [
    ["normal", "observe"],
    ["elevated", "investigate"],
    ["unknown", "escalate"],
    ["extreme", "escalate"],
  ] as const) {
    const result = await driver(
      financeState(bucket),
      context("deterministic_only"),
    );
    assert.equal(result.predictedRoute, expected);
    assert.equal(result.routeQuestionProbabilities, null);
    assert.equal(result.inputTokens, 0);
    assert.equal(result.outputTokens, 0);
    assert.equal(result.costNanoUsd, "0");
  }

  assert.equal(host.calls, 0);
  assert.equal(jev.calls, 0);
  assert.deepEqual(
    created.architectures.deterministic_only.components.map(({ role }) => role),
    ["deterministic"],
  );
  assert.deepEqual(
    created.architectures.host_plus_jev.components.map(({ role }) => role),
    ["host", "jev"],
  );
  assert.equal(created.budgetSnapshots().host.settled.requests, 0);
  assert.throws(
    () =>
      bundle(
        testInvoker({
          providerId: "latest-host",
          modelVersion: "host-latest",
        }),
      ),
    /pinned modelVersion/,
  );
});

test("provider driver bypasses caches, records one attempt, and keeps raw route probabilities separate from the semantic route", async () => {
  const host = testInvoker({
    providerId: "host-provider",
    modelVersion: "host-2026-09-01",
    evaluate: (request) =>
      measuredResponse(
        request,
        {
          providerId: "host-provider",
          modelVersion: "host-2026-09-01",
          probabilitySemantics: "self_reported",
        },
        { route: "observe", anomaly: "concerning" },
      ),
  });
  const created = bundle(host);
  const state = financeState();

  const first = await created.drivers.host_model_only(
    state,
    context("host_model_only"),
  );
  const second = await created.drivers.host_model_only(
    state,
    context("host_model_only"),
  );

  assert.equal(first.predictedRoute, "escalate");
  assert.equal(first.routeQuestionProbabilities?.observe, 0.8);
  assert.deepEqual(second, first);
  assert.equal(host.calls, 2);
  assert.deepEqual(created.budgetSnapshots().host.settled, {
    requests: 2,
    tokens: 2_000,
  });
});

test("finite shared provider budgets fail closed before an extra invocation", async () => {
  const host = testInvoker({
    providerId: "host-provider",
    modelVersion: "host-2026-09-01",
  });
  const created = bundle(host, undefined, {
    maxCalls: 1,
    maxReservedInputTokens: 1_000,
  });
  const driver = created.drivers.host_model_only;

  await driver(financeState(), context("host_model_only"));
  await assert.rejects(
    async () => driver(financeState(), context("host_model_only")),
    /provider-backed finance decision unavailable/,
  );
  assert.equal(host.calls, 1);
  assert.deepEqual(created.budgetSnapshots().host.settled, {
    requests: 1,
    tokens: 1_000,
  });
});

test("provider driver honors caller cancellation and its bounded deadline", async () => {
  const host = testInvoker({
    providerId: "host-provider",
    modelVersion: "host-2026-09-01",
    evaluate: (_request, options) =>
      new Promise((_resolve, reject) => {
        const fail = () => reject(new Error("transport aborted"));
        if (options?.signal?.aborted) fail();
        else options?.signal?.addEventListener("abort", fail, { once: true });
      }),
  });
  const created = bundle(host, undefined, { deadlineMs: 10 });

  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    async () =>
      created.drivers.host_model_only(
        financeState(),
        context("host_model_only", cancelled.signal),
      ),
    /cancelled/,
  );
  assert.equal(host.calls, 0);

  await assert.rejects(
    async () =>
      created.drivers.host_model_only(
        financeState(),
        context("host_model_only"),
      ),
    /deadline/,
  );
  assert.equal(host.calls, 1);
});

test("concurrent calls retain their own provider accounting", async () => {
  const host = testInvoker({
    providerId: "host-provider",
    modelVersion: "host-2026-09-01",
    evaluate: async (request) => {
      const ref = (request.state as { instrumentRef: string }).instrumentRef;
      const first = ref.endsWith(".one");
      await new Promise((resolve) => setTimeout(resolve, first ? 20 : 1));
      return measuredResponse(
        request,
        {
          providerId: "host-provider",
          modelVersion: "host-2026-09-01",
          probabilitySemantics: "self_reported",
        },
        {},
        first
          ? { inputTokens: 11, outputTokens: 3 }
          : { inputTokens: 22, outputTokens: 4 },
      );
    },
  });
  const driver = bundle(host).drivers.host_model_only;

  const [first, second] = await Promise.all([
    driver(
      financeState("normal", "ref:instrument.one"),
      context("host_model_only"),
    ),
    driver(
      financeState("normal", "ref:instrument.two"),
      context("host_model_only"),
    ),
  ]);

  assert.deepEqual(
    [first.inputTokens, first.outputTokens, first.costNanoUsd],
    [11, 3, "14"],
  );
  assert.deepEqual(
    [second.inputTokens, second.outputTokens, second.costNanoUsd],
    [22, 4, "26"],
  );
});

test("provider identity, model version, and probability semantics must match exactly", async (t) => {
  for (const mismatch of ["provider", "model", "semantics"] as const) {
    await t.test(mismatch, async () => {
      const host = testInvoker({
        providerId: "host-provider",
        modelVersion: "host-2026-09-01",
        evaluate: (request) =>
          measuredResponse(request, {
            providerId:
              mismatch === "provider" ? "other-provider" : "host-provider",
            modelVersion:
              mismatch === "model" ? "host-2026-09-02" : "host-2026-09-01",
            probabilitySemantics:
              mismatch === "semantics" ? "normalized_logits" : "self_reported",
          }),
      });

      await assert.rejects(
        async () =>
          bundle(host).drivers.host_model_only(
            financeState(),
            context("host_model_only"),
          ),
        new RegExp(mismatch === "model" ? "model" : mismatch),
      );
    });
  }
});

test("gateway response routes stay separate from immutable upstream model provenance", async () => {
  const gateway = testInvoker({
    providerId: "typesafe-vercel-gateway",
    modelId: "typesafe-ai/jev",
    modelVersion: "jev-1.13.0",
    responseModel: "typesafe-ai/jev",
    modelVersionEvidence: {
      kind: "external_attestation",
      sourceUrl: "https://docs.typesafe.ai/models",
      observedAt: "2026-09-20T00:00:00.000Z",
      evidenceHash: hash("6"),
    },
    probabilitySemantics: "native_calibrated",
  });
  const created = bundle(
    testInvoker({
      providerId: "host-provider",
      modelVersion: "host-2026-09-01",
    }),
    gateway,
  );

  const result = await created.drivers.jev_advisory(
    financeState(),
    context("jev_advisory"),
  );
  assert.equal(result.predictedRoute, "observe");
  assert.equal(
    created.architectures.jev_advisory.components[0]?.modelVersion,
    "jev-1.13.0",
  );
  assert.equal(
    created.architectures.jev_advisory.components[0]?.responseModel,
    "typesafe-ai/jev",
  );
  assert.equal(
    created.architectures.jev_advisory.components[0]?.modelVersionEvidence.kind,
    "external_attestation",
  );
  assert.throws(
    () =>
      bundle(
        testInvoker({
          providerId: "unattested-gateway",
          modelVersion: "jev-1.13.0",
          responseModel: "typesafe-ai/jev",
        }),
      ),
    /response-exact version evidence/u,
  );
  assert.throws(
    () =>
      bundle(
        testInvoker({
          providerId: "moving-route",
          modelVersion: "typesafe-ai/jev",
          responseModel: "typesafe-ai/jev",
        }),
      ),
    /pinned modelVersion/,
  );
});

test("pricing is snapshotted and cost uses exact nano-USD integer arithmetic", async () => {
  const mutablePricing: FinanceProviderPricing = {
    inputNanoUsdPerToken: "2",
    outputNanoUsdPerToken: "3",
    sourceUrl: "https://pricing.example.test/models",
    observedAt: "2026-09-20T00:00:00.000Z",
    priceVersion: "2026-09-20",
    priceHash: hash("8"),
  };
  const host = testInvoker({
    providerId: "host-provider",
    modelVersion: "host-2026-09-01",
    pricing: mutablePricing,
  });
  const created = bundle(host);
  (mutablePricing as { inputNanoUsdPerToken: string }).inputNanoUsdPerToken =
    "999";

  const result = await created.drivers.host_model_only(
    financeState(),
    context("host_model_only"),
  );

  assert.equal(result.costNanoUsd, "260");
  assert.equal(created.pricing.host?.inputNanoUsdPerToken, "2");
  assert.equal(Object.isFrozen(created.pricing.host), true);
  assert.deepEqual(
    created.architectures.host_model_only.components[0]?.pricing,
    created.pricing.host,
  );
  assert.deepEqual(
    created.architectures.host_plus_jev.components[0]?.pricing,
    created.pricing.host,
  );
  assert.equal(
    created.architectures.deterministic_only.components[0]?.pricing,
    null,
  );
});

test("pricing provenance requires canonical public evidence metadata", () => {
  const base: FinanceProviderPricing = {
    inputNanoUsdPerToken: "2",
    outputNanoUsdPerToken: "0",
    sourceUrl: "https://pricing.example.test/models",
    observedAt: "2026-09-20T00:00:00.000Z",
    priceVersion: "2026-09-20",
    priceHash: hash("8"),
  };
  for (const pricing of [
    { ...base, sourceUrl: "https://user:secret@pricing.example.test/models" },
    { ...base, sourceUrl: "https://pricing.example.test/models?moving=1" },
    { ...base, observedAt: "2026-09-20" },
  ])
    assert.throws(
      () =>
        bundle(
          testInvoker({
            providerId: "host-provider",
            modelVersion: "host-2026-09-01",
            pricing,
          }),
        ),
      /pricing/u,
    );
});

test("metadata helpers adapt injected TypeSafe and compatible providers without constructing transports", async () => {
  let returnedCompatibleModel = "host-2026-09-01";
  const compatibleProvider = new OpenAICompatibleProvider({
    id: "compatible-provider",
    endpoint: "https://models.example.test/v1/chat/completions",
    model: "host-2026-09-01",
    maxRedirects: 0,
    repairAttempts: 0,
    resolve: async () => ["8.8.8.8"],
    transport: {
      execute: async (_plan, init) => {
        const body = JSON.parse(String(init.body)) as {
          messages: Array<{ content: string }>;
        };
        assert.match(body.messages[0]?.content ?? "", /finance-route/u);
        return new Response(
          JSON.stringify({
            model: returnedCompatibleModel,
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    answers: [
                      {
                        questionId: "finance-route",
                        type: "choice",
                        selected: "observe",
                        probabilities: {
                          observe: 0.8,
                          investigate: 0.1,
                          escalate: 0.1,
                        },
                      },
                      {
                        questionId: "finance-anomaly",
                        type: "choice",
                        selected: "routine",
                        probabilities: {
                          routine: 0.8,
                          concerning: 0.1,
                          unclear: 0.1,
                        },
                      },
                      {
                        questionId: "finance-evidence-quality",
                        type: "choice",
                        selected: "sufficient",
                        probabilities: {
                          sufficient: 0.8,
                          conflicted: 0.1,
                          insufficient: 0.1,
                        },
                      },
                      {
                        questionId: "finance-untrusted-influence",
                        type: "choice",
                        selected: "absent",
                        probabilities: { absent: 0.8, present: 0.2 },
                      },
                    ],
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
    },
  });
  const compatible = createOpenAICompatibleFinanceInvoker(compatibleProvider, {
    modelId: "host-model",
    modelVersion: "host-2026-09-01",
    responseModel: "host-2026-09-01",
  });
  const typesafe = createTypeSafeFinanceInvoker(
    {
      id: "typesafe-provider",
      capabilities: {
        questionTypes: ["choice", "noul", "score"],
        probabilitySemantics: ["native_calibrated"],
        maxQuestions: 100,
      },
      async evaluateWithMetadata(request) {
        return {
          response: measuredResponse(request, {
            providerId: "typesafe-provider",
            modelVersion: "jev-1.13.0",
            probabilitySemantics: "native_calibrated",
          }).response,
          usage: { inputTokens: 8, outputTokens: 3, totalTokens: 11 },
        };
      },
    },
    {
      modelId: "jev",
      modelVersion: "jev-1.13.0",
      responseModel: "jev-1.13.0",
      pricing: {
        inputNanoUsdPerToken: "2",
        outputNanoUsdPerToken: "3",
        sourceUrl: "https://pricing.example.test/typesafe",
        observedAt: "2026-09-20T00:00:00.000Z",
        priceVersion: "2026-09-20",
        priceHash: hash("7"),
      },
    },
  );
  const created = bundle(compatible, typesafe);

  const [hostResult, jevResult] = await Promise.all([
    created.drivers.host_model_only(financeState(), context("host_model_only")),
    created.drivers.jev_advisory(financeState(), context("jev_advisory")),
  ]);

  assert.deepEqual(
    [hostResult.inputTokens, hostResult.outputTokens, hostResult.costNanoUsd],
    [7, 2, null],
  );
  assert.deepEqual(
    [jevResult.inputTokens, jevResult.outputTokens, jevResult.costNanoUsd],
    [8, 3, "25"],
  );
  returnedCompatibleModel = "different-model-2026-09-20";
  await assert.rejects(
    created.drivers.host_model_only(financeState(), context("host_model_only")),
    /model mismatch/u,
  );
  const redirectingProvider = new OpenAICompatibleProvider({
    id: "compatible-provider",
    endpoint: "https://models.example.test/v1/chat/completions",
    model: "host-2026-09-01",
    maxRedirects: 1,
    repairAttempts: 0,
    resolve: async () => ["8.8.8.8"],
    transport: {
      execute: async () => {
        throw new Error("must not run");
      },
    },
  });
  assert.throws(() => {
    (
      redirectingProvider as unknown as { executionPolicy: object }
    ).executionPolicy = { maxRedirects: 0, repairAttempts: 0 };
  }, TypeError);
  assert.throws(
    () =>
      createOpenAICompatibleFinanceInvoker(redirectingProvider, {
        modelId: "host-model",
        modelVersion: "host-2026-09-01",
        responseModel: "host-2026-09-01",
      }),
    /zero compatible-provider redirects and repairs/u,
  );
  assert.throws(
    () =>
      createOpenAICompatibleFinanceInvoker(
        {
          executionPolicy: { maxRedirects: 0, repairAttempts: 0 },
        } as unknown as OpenAICompatibleProvider,
        {
          modelId: "host-model",
          modelVersion: "host-2026-09-01",
          responseModel: "host-2026-09-01",
        },
      ),
    TypeError,
  );
});

test("composite evaluates both arms concurrently and selects the more restrictive semantic route", async () => {
  let active = 0;
  let maximumActive = 0;
  const make = (
    providerId: string,
    modelVersion: string,
    semantics: ProbabilitySemantics,
    selections: AnswerSelections,
    accounting: Omit<FinanceMeasuredProviderResult, "response">,
  ) =>
    testInvoker({
      providerId,
      modelVersion,
      probabilitySemantics: semantics,
      evaluate: async (request) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return measuredResponse(
          request,
          { providerId, modelVersion, probabilitySemantics: semantics },
          selections,
          accounting,
        );
      },
    });
  const host = make(
    "host-provider",
    "host-2026-09-01",
    "self_reported",
    { route: "investigate" },
    { inputTokens: 10, outputTokens: 2 },
  );
  const jev = make(
    "jev-provider",
    "jev-1.13.0",
    "native_calibrated",
    { route: "observe", influence: "present" },
    { inputTokens: 20, outputTokens: 3 },
  );
  const created = bundle(host, jev);

  const result = await created.drivers.host_plus_jev(
    financeState(),
    context("host_plus_jev"),
  );

  assert.equal(maximumActive, 2);
  assert.equal(result.predictedRoute, "escalate");
  assert.equal(result.routeQuestionProbabilities, null);
  assert.equal(result.calibrationStatus, "unavailable");
  assert.deepEqual(
    [result.inputTokens, result.outputTokens, result.costNanoUsd],
    [30, 5, "35"],
  );
  assert.equal(created.budgetSnapshots().host.settled.requests, 1);
  assert.equal(created.budgetSnapshots().jev.settled.requests, 1);
});

test("accounting keeps token pairs and sourced pricing independent and rejects overflow", async () => {
  const unpriced = testInvoker({
    providerId: "host-provider",
    modelVersion: "host-2026-09-01",
    pricing: null,
    evaluate: (request) =>
      measuredResponse(
        request,
        {
          providerId: "host-provider",
          modelVersion: "host-2026-09-01",
          probabilitySemantics: "self_reported",
        },
        {},
        { inputTokens: 9, outputTokens: 2 },
      ),
  });
  const known = await bundle(unpriced).drivers.host_model_only(
    financeState(),
    context("host_model_only"),
  );
  assert.deepEqual(
    [known.inputTokens, known.outputTokens, known.costNanoUsd],
    [9, 2, null],
  );

  const invalidPair = testInvoker({
    providerId: "invalid-accounting",
    modelVersion: "host-2026-09-01",
    evaluate: (request) =>
      measuredResponse(
        request,
        {
          providerId: "invalid-accounting",
          modelVersion: "host-2026-09-01",
          probabilitySemantics: "self_reported",
        },
        {},
        { inputTokens: null, outputTokens: 1 },
      ),
  });
  await assert.rejects(
    async () =>
      bundle(invalidPair).drivers.host_model_only(
        financeState(),
        context("host_model_only"),
      ),
    /token accounting/,
  );

  const host = testInvoker({
    providerId: "overflow-host",
    modelVersion: "host-2026-09-01",
    evaluate: (request) =>
      measuredResponse(
        request,
        {
          providerId: "overflow-host",
          modelVersion: "host-2026-09-01",
          probabilitySemantics: "self_reported",
        },
        {},
        {
          inputTokens: Number.MAX_SAFE_INTEGER,
          outputTokens: 0,
        },
      ),
  });
  const jev = testInvoker({
    providerId: "overflow-jev",
    modelVersion: "jev-1.13.0",
    probabilitySemantics: "native_calibrated",
    evaluate: (request) =>
      measuredResponse(
        request,
        {
          providerId: "overflow-jev",
          modelVersion: "jev-1.13.0",
          probabilitySemantics: "native_calibrated",
        },
        {},
        { inputTokens: 1, outputTokens: 0 },
      ),
  });
  await assert.rejects(
    async () =>
      bundle(host, jev).drivers.host_plus_jev(
        financeState(),
        context("host_plus_jev"),
      ),
    /inputTokens total/,
  );
});

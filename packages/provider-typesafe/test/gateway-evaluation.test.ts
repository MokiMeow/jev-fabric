import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import type { DecisionRequest } from "@mokimeow/jev-fabric-protocol";
import { describe, expect, it } from "vitest";
import {
  createVercelGatewayEvaluationJevProvider,
  VERCEL_GATEWAY_EVALUATION_PROVIDER_ID,
  VERCEL_GATEWAY_EVALUATION_URL,
} from "../src/index.js";
import { createPinnedVercelGatewayEvaluationJevProvider } from "../src/gateway-evaluation.js";

const request: DecisionRequest = {
  id: "gateway_eval_1",
  state: { text: "read-only market research" },
  questions: [
    {
      id: "route",
      type: "choice",
      instructions: "Choose a research route",
      criteria: { observe: "Read only", investigate: "Needs review" },
      options: ["observe", "investigate"],
    },
    {
      id: "safe",
      type: "noul",
      instructions: "Is the request read-only?",
      criteria: { true: "No mutation", false: "Could mutate" },
    },
    {
      id: "risk",
      type: "score",
      instructions: "How risky is the request?",
      criteria: ["low", "medium", "high"],
    },
  ],
};

function gatewayResult(overrides: Record<string, unknown> = {}) {
  return {
    model: "typesafe-ai/jev",
    answers: {
      route: {
        type: "choice",
        choice: "observe",
        probabilities: { observe: 0.8, investigate: 0.2 },
      },
      safe: { type: "boolean", probability: 0.9 },
      risk: {
        type: "score",
        score: 1.6,
        probabilities: { "0": 0.1, "1": 0.2, "2": 0.7 },
      },
    },
    usage: { inputTokens: 71, outputTokens: 5 },
    providerMetadata: {
      gateway: {
        routing: {
          originalModelId: "typesafe-ai/jev",
          resolvedProvider: "typesafe-ai",
          canonicalSlug: "typesafe-ai/jev",
          finalProvider: "typesafe-ai",
        },
        cost: "0.00000284",
        generationId: "gen_private_123",
      },
      typesafe: { confidence: { route: 0.76, risk: 0.64 } },
    },
    ...overrides,
  };
}

describe("pinned Vercel Gateway Evaluation provider", () => {
  it("pins its public identity and requires an explicit bounded credential", () => {
    expect(VERCEL_GATEWAY_EVALUATION_URL).toBe(
      "https://ai-gateway.vercel.sh/v1/evaluate",
    );
    expect(VERCEL_GATEWAY_EVALUATION_PROVIDER_ID).toBe(
      "typesafe-vercel-gateway-evaluate",
    );
    expect(() =>
      createVercelGatewayEvaluationJevProvider({ apiKey: "" }),
    ).toThrow(/configuration/u);
    expect(() =>
      createVercelGatewayEvaluationJevProvider({ apiKey: "bad\nkey" }),
    ).toThrow(/configuration/u);
    expect(
      createVercelGatewayEvaluationJevProvider({ apiKey: "test-key" }).id,
    ).toBe(VERCEL_GATEWAY_EVALUATION_PROVIDER_ID);
  });

  it("emits the fixed privacy/provider policy and maps all typed answers", async () => {
    let calls = 0;
    let receivedMethod: string | undefined;
    let receivedPath: string | undefined;
    let receivedAuthorization: string | undefined;
    let receivedBody: unknown;
    const server = createServer((incoming, outgoing) => {
      calls += 1;
      receivedMethod = incoming.method;
      receivedPath = incoming.url;
      receivedAuthorization = incoming.headers.authorization;
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
      incoming.on("end", () => {
        receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        outgoing.writeHead(200, { "content-type": "application/json" });
        outgoing.end(JSON.stringify(gatewayResult()));
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new Error("loopback address unavailable");
      const provider = createPinnedVercelGatewayEvaluationJevProvider(
        "gateway-test-key",
        `http://127.0.0.1:${address.port}/v1/evaluate`,
      );
      const mapped = await provider.evaluateWithMetadata(request, {
        deadlineMs: 2_000,
      });

      expect(calls).toBe(1);
      expect(receivedMethod).toBe("POST");
      expect(receivedPath).toBe("/v1/evaluate");
      expect(receivedAuthorization).toBe("Bearer gateway-test-key");
      expect(receivedBody).toMatchObject({
        model: "typesafe-ai/jev",
        questions: {
          route: { type: "choice" },
          safe: { type: "boolean" },
          risk: { type: "score" },
        },
        providerOptions: {
          gateway: {
            zeroDataRetention: true,
            disallowPromptTraining: true,
            only: ["typesafe-ai"],
          },
        },
      });
      expect(mapped.response).toMatchObject({
        providerId: VERCEL_GATEWAY_EVALUATION_PROVIDER_ID,
        model: "typesafe-ai/jev",
        probabilitySemantics: "native_calibrated",
        answers: [
          {
            type: "choice",
            selected: "observe",
            confidence: 0.76,
          },
          { type: "noul", value: true, probabilityYes: 0.9 },
          { type: "score", confidence: 0.64 },
        ],
      });
      expect(mapped.response.answers[2]).toMatchObject({
        type: "score",
        score: expect.closeTo(0.8),
      });
      expect(mapped.usage).toEqual({
        inputTokens: 71,
        outputTokens: 5,
        totalTokens: 76,
      });
      expect(mapped.route).toEqual({
        originalModelId: "typesafe-ai/jev",
        resolvedProvider: "typesafe-ai",
        canonicalSlug: "typesafe-ai/jev",
        finalProvider: "typesafe-ai",
      });
      expect(mapped.providerRequestIdHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(JSON.stringify(mapped)).not.toContain("gen_private_123");
      expect(JSON.stringify(mapped)).not.toContain("0.00000284");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("fails closed on model, route, answer, confidence, and envelope drift", async () => {
    const invalid = [
      gatewayResult({ model: "jev-1.13.0" }),
      gatewayResult({
        providerMetadata: {
          ...gatewayResult().providerMetadata,
          gateway: {
            ...gatewayResult().providerMetadata.gateway,
            routing: {
              ...gatewayResult().providerMetadata.gateway.routing,
              finalProvider: "other",
            },
          },
        },
      }),
      gatewayResult({
        answers: {
          ...gatewayResult().answers,
          route: {
            type: "choice",
            choice: "observe",
            probabilities: { observe: 0.2, investigate: 0.8 },
          },
        },
      }),
      gatewayResult({
        providerMetadata: {
          ...gatewayResult().providerMetadata,
          typesafe: { confidence: { safe: 0.76 } },
        },
      }),
      gatewayResult({
        answers: {
          ...gatewayResult().answers,
          risk: {
            type: "score",
            score: 1.65,
            probabilities: { "0": 0.1, "1": 0.2, "2": 0.7 },
          },
        },
      }),
      { ...gatewayResult(), extra: "untrusted" },
    ];
    for (const payload of invalid) {
      const provider = createPinnedVercelGatewayEvaluationJevProvider(
        "test-key",
        "https://unused.invalid/v1/evaluate",
        async () =>
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      );
      await expect(provider.evaluate(request)).rejects.toMatchObject({
        category: "invalid_response",
        retryable: false,
      });
    }
  });

  it("accepts the documented HTTP shape without fabricating confidence", async () => {
    const payload = gatewayResult();
    const provider = createPinnedVercelGatewayEvaluationJevProvider(
      "test-key",
      "https://unused.invalid/v1/evaluate",
      async () =>
        new Response(
          JSON.stringify({
            ...payload,
            providerMetadata: { gateway: payload.providerMetadata.gateway },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );

    const result = await provider.evaluate(request);
    expect(result.answers[0]).not.toHaveProperty("confidence");
    expect(result.answers[2]).not.toHaveProperty("confidence");
  });

  it("canonicalizes the documented rounded score from its distribution", async () => {
    const scoreRequest: DecisionRequest = {
      id: "gateway_documented_score",
      state: "The PR adds tests, updates docs, and has a clear description.",
      questions: [
        {
          id: "quality",
          type: "score",
          instructions: "Rate the quality of this pull request.",
          criteria: ["poor", "fair", "good", "excellent"],
        },
      ],
    };
    const base = gatewayResult();
    const provider = createPinnedVercelGatewayEvaluationJevProvider(
      "test-key",
      "https://unused.invalid/v1/evaluate",
      async () =>
        new Response(
          JSON.stringify({
            model: "typesafe-ai/jev",
            answers: {
              quality: {
                type: "score",
                score: 2.97,
                probabilities: { "0": 0, "1": 0, "2": 0.02, "3": 0.98 },
              },
            },
            usage: { inputTokens: 275, outputTokens: 20 },
            providerMetadata: { gateway: base.providerMetadata.gateway },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );

    const result = await provider.evaluate(scoreRequest);
    expect(result.answers).toEqual([
      expect.objectContaining({
        questionId: "quality",
        type: "score",
        score: expect.closeTo(2.98 / 3),
        probabilities: { "0": 0, "1": 0, "2": 0.02, "3": 0.98 },
      }),
    ]);
  });

  it("distinguishes cancellation, deadlines, rate limits, and oversized output", async () => {
    const blockedFetch = async (
      _input: string,
      init?: RequestInit,
    ): Promise<Response> =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) reject(signal.reason);
        else
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
      });
    const blocked = createPinnedVercelGatewayEvaluationJevProvider(
      "test-key",
      "https://unused.invalid/v1/evaluate",
      blockedFetch,
    );
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      blocked.evaluate(request, { signal: cancelled.signal }),
    ).rejects.toMatchObject({ category: "cancelled", retryable: false });
    await expect(
      blocked.evaluate(request, { deadlineMs: 5 }),
    ).rejects.toMatchObject({ category: "timeout", retryable: true });

    const limited = createPinnedVercelGatewayEvaluationJevProvider(
      "test-key",
      "https://unused.invalid/v1/evaluate",
      async () =>
        new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "2" },
        }),
    );
    await expect(limited.evaluate(request)).rejects.toMatchObject({
      category: "rate_limited",
      retryable: true,
      status: 429,
      retryAfterMs: 2_000,
    });

    const gatewayTimeout = createPinnedVercelGatewayEvaluationJevProvider(
      "test-key",
      "https://unused.invalid/v1/evaluate",
      async () => new Response("timeout", { status: 408 }),
    );
    await expect(gatewayTimeout.evaluate(request)).rejects.toMatchObject({
      category: "timeout",
      retryable: true,
      status: 408,
    });

    const oversized = createPinnedVercelGatewayEvaluationJevProvider(
      "test-key",
      "https://unused.invalid/v1/evaluate",
      async () =>
        new Response("{}", {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-length": "1000001",
          },
        }),
    );
    await expect(oversized.evaluate(request)).rejects.toMatchObject({
      category: "invalid_response",
      retryable: false,
    });
  });

  it("rejects an oversized request before any transport call", async () => {
    let calls = 0;
    const provider = createPinnedVercelGatewayEvaluationJevProvider(
      "test-key",
      "https://unused.invalid/v1/evaluate",
      async () => {
        calls += 1;
        return new Response();
      },
    );
    await expect(
      provider.evaluate({ ...request, state: "x".repeat(1_000_001) }),
    ).rejects.toMatchObject({
      category: "invalid_request",
      retryable: false,
    });
    expect(calls).toBe(0);
  });
});

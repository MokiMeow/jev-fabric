import type { DecisionRequest } from "@mokimeow/jev-fabric-protocol";
import { describe, expect, it } from "vitest";
import {
  OpenAICompatibleProvider,
  type OpenAICompatibleProviderError,
} from "../src/index.js";

const request: DecisionRequest = {
  id: "request_1",
  state: { subject: "refund" },
  questions: [
    {
      id: "route",
      type: "choice",
      instructions: { task: "route" },
      criteria: { billing: "billing", other: "other" },
      options: ["billing", "other"],
    },
  ],
};
const json = (content: string, init?: ResponseInit) =>
  new Response(
    JSON.stringify({
      model: "configured-model",
      choices: [{ message: { content } }],
    }),
    {
      headers: { "content-type": "application/json" },
      ...init,
    },
  );

describe("OpenAICompatibleProvider", () => {
  it("uses only its configured endpoint, injected fetch, strict response handling, and self-reported semantics", async () => {
    let plan: unknown;
    let init: RequestInit | undefined;
    const provider = new OpenAICompatibleProvider({
      id: "compatible",
      endpoint: "https://models.example.test/v1/chat/completions",
      model: "configured-model",
      resolve: async () => ["8.8.8.8"],
      transport: {
        execute: async (input, options) => {
          plan = input;
          init = options;
          return json(
            '{"answers":[{"questionId":"route","type":"choice","selected":"billing","probabilities":{"billing":0.7,"other":0.3}}]}',
          );
        },
      },
    });
    await expect(provider.evaluate(request)).resolves.toMatchObject({
      model: "configured-model",
      probabilitySemantics: "self_reported",
    });
    expect(plan).toMatchObject({
      address: "8.8.8.8",
      serverName: "models.example.test",
    });
    expect(init?.redirect).toBe("manual");
    expect(provider.executionPolicy).toEqual({
      maxRedirects: 2,
      repairAttempts: 0,
    });
    expect(Object.isFrozen(provider.executionPolicy)).toBe(true);
  });

  it("retains exact provider-reported token usage without changing evaluate", async () => {
    const provider = new OpenAICompatibleProvider({
      id: "compatible",
      endpoint: "https://models.example.test/v1/chat/completions",
      model: "configured-model",
      resolve: async () => ["8.8.8.8"],
      transport: {
        execute: async () =>
          new Response(
            JSON.stringify({
              model: "configured-model",
              choices: [
                {
                  message: {
                    content:
                      '{"answers":[{"questionId":"route","type":"choice","selected":"billing","probabilities":{"billing":0.7,"other":0.3}}]}',
                  },
                },
              ],
              usage: {
                prompt_tokens: 41,
                completion_tokens: 7,
                total_tokens: 48,
                prompt_tokens_details: { cached_tokens: 0 },
              },
            }),
            { headers: { "content-type": "application/json" } },
          ),
      },
    });
    await expect(provider.evaluateWithMetadata(request)).resolves.toMatchObject(
      {
        response: { model: "configured-model" },
        usage: { inputTokens: 41, outputTokens: 7, totalTokens: 48 },
      },
    );
    await expect(provider.evaluate(request)).resolves.toMatchObject({
      model: "configured-model",
    });
  });

  it("rejects internally inconsistent provider token usage", async () => {
    const provider = new OpenAICompatibleProvider({
      id: "compatible",
      endpoint: "https://models.example.test/v1/chat/completions",
      model: "configured-model",
      resolve: async () => ["8.8.8.8"],
      transport: {
        execute: async () =>
          new Response(
            JSON.stringify({
              model: "configured-model",
              choices: [
                {
                  message: {
                    content:
                      '{"answers":[{"questionId":"route","type":"choice","selected":"billing","probabilities":{"billing":0.7,"other":0.3}}]}',
                  },
                },
              ],
              usage: {
                prompt_tokens: 41,
                completion_tokens: 7,
                total_tokens: 49,
              },
            }),
            { headers: { "content-type": "application/json" } },
          ),
      },
    });
    await expect(provider.evaluateWithMetadata(request)).rejects.toMatchObject({
      category: "invalid_response",
    });
  });

  it("retains the exact upstream model instead of relabelling it as the requested route", async () => {
    const provider = new OpenAICompatibleProvider({
      id: "compatible",
      endpoint: "https://models.example.test/v1/chat/completions",
      model: "configured-route",
      resolve: async () => ["8.8.8.8"],
      transport: {
        execute: async () =>
          new Response(
            JSON.stringify({
              model: "resolved-model-2026-09-20",
              choices: [
                {
                  message: {
                    content:
                      '{"answers":[{"questionId":"route","type":"choice","selected":"billing","probabilities":{"billing":0.7,"other":0.3}}]}',
                  },
                },
              ],
            }),
            { headers: { "content-type": "application/json" } },
          ),
      },
    });
    await expect(provider.evaluate(request)).resolves.toMatchObject({
      model: "resolved-model-2026-09-20",
    });
  });

  it("accounts for exactly one bounded repair and redacts failure details", async () => {
    let calls = 0;
    const attempts: unknown[] = [];
    const provider = new OpenAICompatibleProvider({
      id: "compatible",
      endpoint: "https://models.example.test/v1/chat/completions",
      model: "configured-model",
      repairAttempts: 1,
      resolve: async () => ["8.8.8.8"],
      onAttempt: (attempt) => attempts.push(attempt),
      transport: {
        execute: async () => {
          calls += 1;
          return json(
            calls === 1
              ? "```json nope```"
              : '{"answers":[{"questionId":"route","type":"choice","selected":"billing","probabilities":{"billing":0.7,"other":0.3}}]}',
          );
        },
      },
    });
    await expect(provider.evaluate(request)).resolves.toBeDefined();
    expect(calls).toBe(2);
    expect(attempts).toHaveLength(2);
    const failing = new OpenAICompatibleProvider({
      id: "compatible",
      endpoint: "https://models.example.test/v1/chat/completions",
      model: "configured-model",
      resolve: async () => ["8.8.8.8"],
      transport: {
        execute: async () =>
          new Response("Bearer secret-value", {
            status: 429,
            headers: { "retry-after": "2" },
          }),
      },
    });
    await expect(failing.evaluate(request)).rejects.toEqual(
      expect.objectContaining<OpenAICompatibleProviderError>({
        category: "rate_limited",
        retryable: true,
        status: 429,
        retryAfterMs: 2000,
      }),
    );
    await failing
      .evaluate(request)
      .catch((error: unknown) =>
        expect((error as Error).message).not.toContain("secret"),
      );
  });

  it("rejects redirect-to-private and oversized response bodies before parsing", async () => {
    const redirecting = new OpenAICompatibleProvider({
      id: "compatible",
      endpoint: "https://models.example.test/v1/chat/completions",
      model: "configured-model",
      resolve: async () => ["8.8.8.8"],
      transport: {
        execute: async () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://127.0.0.1/private" },
          }),
      },
    });
    await expect(redirecting.evaluate(request)).rejects.toEqual(
      expect.objectContaining({ category: "configuration" }),
    );
    const oversized = new OpenAICompatibleProvider({
      id: "compatible",
      endpoint: "https://models.example.test/v1/chat/completions",
      model: "configured-model",
      maxResponseBytes: 1,
      resolve: async () => ["8.8.8.8"],
      transport: {
        execute: async () =>
          new Response(
            JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
            {
              headers: {
                "content-type": "application/json",
                "content-length": "100",
              },
            },
          ),
      },
    });
    await expect(oversized.evaluate(request)).rejects.toEqual(
      expect.objectContaining({ category: "invalid_response" }),
    );
  });

  it("records a malformed model response as one failed attempt followed by a repaired success", async () => {
    let call = 0;
    const attempts: { outcome: string }[] = [];
    const provider = new OpenAICompatibleProvider({
      id: "compatible",
      endpoint: "https://models.example.test/v1",
      model: "configured",
      repairAttempts: 1,
      resolve: async () => ["8.8.8.8"],
      onAttempt: (attempt) => attempts.push(attempt),
      transport: {
        execute: async () =>
          json(
            ++call === 1
              ? "not json"
              : '{"answers":[{"questionId":"route","type":"choice","selected":"billing","probabilities":{"billing":0.7,"other":0.3}}]}',
          ),
      },
    });
    await expect(provider.evaluate(request)).resolves.toBeDefined();
    expect(attempts.map((attempt) => attempt.outcome)).toEqual([
      "failed",
      "succeeded",
    ]);
  });

  it("re-resolves and passes a newly pinned plan for every accepted redirect", async () => {
    const plans: { address: string; serverName: string }[] = [];
    const provider = new OpenAICompatibleProvider({
      id: "compatible",
      endpoint: "https://first.example/v1",
      model: "configured",
      resolve: async (host) =>
        host === "first.example" ? ["8.8.8.8"] : ["1.1.1.1"],
      transport: {
        execute: async (plan) => {
          plans.push(plan);
          return plans.length === 1
            ? new Response(null, {
                status: 302,
                headers: { location: "https://second.example/v1" },
              })
            : json(
                '{"answers":[{"questionId":"route","type":"choice","selected":"billing","probabilities":{"billing":0.7,"other":0.3}}]}',
              );
        },
      },
    });
    await expect(provider.evaluate(request)).resolves.toBeDefined();
    expect(plans).toEqual([
      expect.objectContaining({
        address: "8.8.8.8",
        serverName: "first.example",
      }),
      expect.objectContaining({
        address: "1.1.1.1",
        serverName: "second.example",
      }),
    ]);
  });

  it("keeps DNS planning inside the caller abort and deadline budget", async () => {
    let resolverCalls = 0;
    let transportCalls = 0;
    const preAborted = new AbortController();
    preAborted.abort();
    const provider = new OpenAICompatibleProvider({
      id: "compatible",
      endpoint: "https://models.example.test/v1",
      model: "configured",
      resolve: async () => {
        resolverCalls += 1;
        return ["8.8.8.8"];
      },
      transport: {
        execute: async () => {
          transportCalls += 1;
          return json("{}");
        },
      },
    });
    await expect(
      provider.evaluate(request, { signal: preAborted.signal }),
    ).rejects.toMatchObject({
      category: "cancelled",
    });
    expect(resolverCalls).toBe(0);
    expect(transportCalls).toBe(0);

    let lateResolve: ((value: readonly string[]) => void) | undefined;
    let resolverSignal: AbortSignal | undefined;
    const cancellation = new AbortController();
    const blocked = new OpenAICompatibleProvider({
      id: "compatible",
      endpoint: "https://models.example.test/v1",
      model: "configured",
      resolve: (_hostname, resolverOptions) =>
        new Promise<readonly string[]>((resolve) => {
          resolverSignal = resolverOptions?.signal;
          lateResolve = resolve;
        }),
      transport: {
        execute: async () => {
          transportCalls += 1;
          return json("{}");
        },
      },
    });
    const pending = blocked.evaluate(request, { signal: cancellation.signal });
    await Promise.resolve();
    cancellation.abort();
    await expect(pending).rejects.toMatchObject({ category: "cancelled" });
    expect(resolverSignal).toBeDefined();
    expect(resolverSignal?.aborted).toBe(true);
    lateResolve?.(["8.8.8.8"]);
    await Promise.resolve();
    expect(transportCalls).toBe(0);

    const zeroDeadline = new OpenAICompatibleProvider({
      id: "compatible",
      endpoint: "https://models.example.test/v1",
      model: "configured",
      resolve: () => new Promise<readonly string[]>(() => undefined),
      transport: {
        execute: async () => {
          transportCalls += 1;
          return json("{}");
        },
      },
    });
    await expect(
      zeroDeadline.evaluate(request, { deadlineMs: 0 }),
    ).rejects.toMatchObject({
      category: "cancelled",
    });
    expect(transportCalls).toBe(0);
  });
});

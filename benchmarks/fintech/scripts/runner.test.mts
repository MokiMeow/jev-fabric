import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type {
  DecisionRequest,
  DecisionResponse,
} from "../../../packages/protocol/src/index.js";
import {
  assertFintechEvidence,
  type FintechSignalId,
  fintechSignalIds,
} from "./evidence.mjs";
import {
  createFintechMeasuredEvaluator,
  type FintechBenchmarkCase,
  type FintechMeasuredEvaluator,
  runFintechBenchmark,
} from "./runner.mjs";

const sha256 = (value: string) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const candidates = [
  {
    id: "observe",
    description: "Record the bounded exception observation only",
    available: true,
    freshness: "current",
  },
  {
    id: "investigate",
    description: "Route to bounded operations investigation",
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

function signalLabels(
  enabled: readonly FintechSignalId[],
): Record<FintechSignalId, boolean> {
  return Object.fromEntries(
    fintechSignalIds.map((id) => [id, enabled.includes(id)]),
  ) as Record<FintechSignalId, boolean>;
}

function benchmarkCase(
  caseId: string,
  split: "calibration" | "test",
  note: string,
  enabled: readonly FintechSignalId[],
): FintechBenchmarkCase {
  const goldSignals = signalLabels(enabled);
  const goldRoute =
    goldSignals["fintech-urgent-consumer-harm"] ||
    goldSignals["fintech-untrusted-influence"]
      ? "escalate"
      : fintechSignalIds.slice(0, 4).some((id) => goldSignals[id])
        ? "investigate"
        : "observe";
  return {
    caseId,
    groupId: `group-${caseId}`,
    split,
    evaluationNowEpochMs: Date.parse("2026-09-20T10:00:30.000Z"),
    state: {
      contractVersion: "1",
      advisoryOnly: true,
      execution: "NOT_SUPPORTED",
      purpose: "exception_triage_only",
      caseRef: `ref:${caseId}`,
      observedAt: "2026-09-20T10:00:00.000Z",
      validUntil: "2026-09-20T10:01:00.000Z",
      maxAgeMs: 60_000,
      evidence: {
        note,
        noteHash: sha256(note),
        sourceHash: sha256(`source-${caseId}`),
        trust: "untrusted_data_only",
        redaction: "host_redacted",
      },
      candidates,
    },
    goldRoute,
    goldSignals,
  };
}

function fixtureCases(): readonly FintechBenchmarkCase[] {
  return [
    benchmarkCase(
      "cal-duplicate",
      "calibration",
      "SYNTHETIC_PRIVATE_MARKER duplicate settlement item.",
      ["fintech-duplicate-or-reprocessed"],
    ),
    benchmarkCase(
      "test-urgent",
      "test",
      "Synthetic unauthorized activity with imminent continued loss.",
      ["fintech-urgent-consumer-harm"],
    ),
  ];
}

function labelsForRequest(request: DecisionRequest) {
  const caseRef = (request.state as { caseRef?: unknown }).caseRef;
  const enabled =
    caseRef === "ref:cal-duplicate"
      ? new Set(["fintech-duplicate-or-reprocessed"])
      : new Set(["fintech-urgent-consumer-harm"]);
  return request.questions.map((question) => {
    const probabilityYes = enabled.has(question.id) ? 0.9 : 0.1;
    return {
      questionId: question.id,
      type: "noul" as const,
      value: probabilityYes >= 0.5,
      probabilityYes,
    };
  });
}

class FixtureEvaluator implements FintechMeasuredEvaluator {
  readonly providerId = "typesafe-native";
  readonly model = "jev-1.13.0";
  readonly probabilitySemantics = "native_calibrated";
  readonly transport = "typesafe-sdk-v0.6.0";
  calls = 0;
  active = 0;
  maxActive = 0;
  mutate?: (
    response: DecisionResponse,
    request: DecisionRequest,
  ) => DecisionResponse;
  throwUnmetered = false;

  async evaluate(request: DecisionRequest): Promise<{
    response: DecisionResponse;
    usage: { inputTokens: number; outputTokens: number };
  }> {
    this.calls += 1;
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 3));
      if (this.throwUnmetered) throw new Error("synthetic transport failure");
      const response: DecisionResponse = {
        requestId: request.id,
        providerId: this.providerId,
        model: this.model,
        probabilitySemantics: this.probabilitySemantics,
        answers: labelsForRequest(request),
      };
      return {
        response: this.mutate?.(response, request) ?? response,
        usage: {
          inputTokens: request.questions.length * 10,
          outputTokens: request.questions.length,
        },
      };
    } finally {
      this.active -= 1;
    }
  }
}

function runOptions(evaluator: FintechMeasuredEvaluator) {
  return {
    runId: "fintech-runner-test",
    createdAt: "2026-09-20T12:00:00.000Z",
    preregisteredAt: "2026-09-19T00:00:00.000Z",
    frozenAt: "2026-09-20T00:00:00.000Z",
    evaluator,
    dataset: {
      datasetId: "synthetic-fintech-runner-v1",
      sourceUrl: "https://example.test/fintech-runner",
      license: "CC0-1.0",
      evidenceClass: "SYNTHETIC" as const,
      redistributionAllowed: true as const,
      containsPersonalData: false as const,
      containsRegulatedData: false as const,
      deidentified: true as const,
    },
    pricing: {
      inputNanoUsdPerToken: "42",
      sourceUrl: "https://docs.typesafe.ai/models",
      sourceDigest: `sha256:${"d".repeat(64)}`,
      observedAt: "2026-09-20T00:00:00.000Z",
    },
    limits: {
      concurrency: 2,
      maxProviderInvocations: 14,
      maxInputTokens: 20_000,
      reservedInputTokensPerInvocation: 1_000,
      maxAttempts: 1,
      deadlineMs: 2_000,
    },
  };
}

test("runs one batched and six serial calls per case without retaining raw state", async () => {
  const evaluator = new FixtureEvaluator();
  const evidence = await runFintechBenchmark(
    fixtureCases(),
    runOptions(evaluator),
  );

  assert.doesNotThrow(() => assertFintechEvidence(evidence));
  assert.equal(evaluator.calls, 14);
  assert.ok(evaluator.maxActive > 1);
  assert.equal(evidence.traces.length, 6);
  assert.equal(evidence.metrics?.batching.requestReductionRatio, 6);
  assert.equal(evidence.metrics?.byArm.no_jev.providerInvocationCount, 0);
  assert.equal(evidence.metrics?.byArm.jev_batched.testRouteAccuracy, 1);
  assert.equal(evidence.metrics?.byArm.jev_serial.testRouteAccuracy, 1);
  assert.equal(
    JSON.stringify(evidence).includes("SYNTHETIC_PRIVATE_MARKER"),
    false,
  );

  for (const datasetCase of evidence.dataset.cases) {
    const jevTraces = evidence.traces.filter(
      (trace) => trace.caseId === datasetCase.caseId && trace.arm !== "no_jev",
    );
    assert.equal(jevTraces.length, 2);
    assert.ok(
      jevTraces.every(
        (trace) =>
          trace.boundary.providerStateDigest ===
          datasetCase.providerStateDigest,
      ),
    );
  }
});

test("reserves global request and input-token budgets before concurrent calls", async () => {
  const requestLimited = new FixtureEvaluator();
  await assert.rejects(
    runFintechBenchmark(fixtureCases(), {
      ...runOptions(requestLimited),
      limits: {
        ...runOptions(requestLimited).limits,
        maxProviderInvocations: 4,
      },
    }),
    /provider invocation budget/u,
  );
  assert.equal(requestLimited.calls, 4);

  const tokenLimited = new FixtureEvaluator();
  await assert.rejects(
    runFintechBenchmark(fixtureCases(), {
      ...runOptions(tokenLimited),
      limits: {
        ...runOptions(tokenLimited).limits,
        maxInputTokens: 50,
        reservedInputTokensPerInvocation: 50,
      },
    }),
    /input token (?:reservation|budget)/u,
  );
  assert.equal(tokenLimited.calls, 1);
});

test("measured malformed answers fail closed without invented probabilities", async () => {
  const evaluator = new FixtureEvaluator();
  let changed = false;
  evaluator.mutate = (response, request) => {
    if (changed || request.questions.length !== 6) return response;
    changed = true;
    return { ...response, answers: response.answers.slice(0, 5) };
  };
  const evidence = await runFintechBenchmark(
    fixtureCases(),
    runOptions(evaluator),
  );
  assert.doesNotThrow(() => assertFintechEvidence(evidence));
  const invalid = evidence.traces.find(
    (trace) => trace.caseId === "cal-duplicate" && trace.arm === "jev_batched",
  );
  assert.ok(invalid);
  assert.equal(invalid.valid, false);
  assert.equal(invalid.route, "escalate");
  assert.equal(invalid.routeScore, null);
  assert.deepEqual(invalid.signals, []);
  assert.equal(invalid.runtime.providerInvocationCount, 1);
  assert.equal(invalid.runtime.inputTokens, 60);
});

test("metered malformed retries are included in calls, tokens, and cost", async () => {
  const evaluator = new FixtureEvaluator();
  let changed = false;
  evaluator.mutate = (response, request) => {
    if (changed || request.questions.length !== 6) return response;
    changed = true;
    return { ...response, answers: response.answers.slice(0, 5) };
  };
  const base = runOptions(evaluator);
  const evidence = await runFintechBenchmark(fixtureCases(), {
    ...base,
    limits: { ...base.limits, maxAttempts: 2, maxProviderInvocations: 15 },
  });
  const retried = evidence.traces.find(
    (trace) => trace.caseId === "cal-duplicate" && trace.arm === "jev_batched",
  );
  assert.ok(retried);
  assert.equal(retried.valid, true);
  assert.equal(retried.runtime.providerInvocationCount, 2);
  assert.equal(retried.runtime.inputTokens, 120);
  assert.equal(retried.runtime.costNanoUsd, String(120 * 42));
});

test("non-boolean or uncalibrated Noul payloads fail closed as measured output", async () => {
  const evaluator = new FixtureEvaluator();
  let changed = false;
  evaluator.mutate = (response, request) => {
    if (changed || request.questions.length !== 6) return response;
    changed = true;
    const [first, ...rest] = response.answers;
    assert.ok(first?.type === "noul");
    return {
      ...response,
      answers: [{ ...first, value: "yes", probabilityYes: undefined }, ...rest],
    } as unknown as DecisionResponse;
  };
  const evidence = await runFintechBenchmark(
    fixtureCases(),
    runOptions(evaluator),
  );
  const invalid = evidence.traces.find(
    (trace) => trace.caseId === "cal-duplicate" && trace.arm === "jev_batched",
  );
  assert.ok(invalid);
  assert.equal(invalid.valid, false);
  assert.deepEqual(invalid.signals, []);
});

test("unmetered provider exceptions abort instead of fabricating zero usage", async () => {
  const evaluator = new FixtureEvaluator();
  evaluator.throwUnmetered = true;
  await assert.rejects(
    runFintechBenchmark(fixtureCases(), runOptions(evaluator)),
    /unmetered provider failure/u,
  );
});

test("provider identity, exact model, and native probability semantics cannot drift", async () => {
  for (const mutate of [
    (response: DecisionResponse) => ({ ...response, model: "jev-1.14.0" }),
    (response: DecisionResponse) => ({
      ...response,
      providerId: "untrusted-provider",
    }),
    (response: DecisionResponse) => ({
      ...response,
      probabilitySemantics: "synthetic" as const,
    }),
  ]) {
    const evaluator = new FixtureEvaluator();
    evaluator.mutate = mutate;
    await assert.rejects(
      runFintechBenchmark(fixtureCases(), runOptions(evaluator)),
      /provider identity|model identity|probability semantics/u,
    );
  }
});

test("invalid public metadata and gold-label shape fail before a provider call", async () => {
  const credentialed = new FixtureEvaluator();
  const base = runOptions(credentialed);
  await assert.rejects(
    runFintechBenchmark(fixtureCases(), {
      ...base,
      dataset: {
        ...base.dataset,
        sourceUrl: "https://user:secret@example.test/dataset",
      },
    }),
    /embedded credentials/u,
  );
  assert.equal(credentialed.calls, 0);

  const extraGold = new FixtureEvaluator();
  const cases = structuredClone(fixtureCases()) as FintechBenchmarkCase[];
  const first = cases[0];
  assert.ok(first);
  (first.goldSignals as unknown as Record<string, boolean>).unexpected = true;
  await assert.rejects(
    runFintechBenchmark(cases, runOptions(extraGold)),
    /gold signals/u,
  );
  assert.equal(extraGold.calls, 0);
});

test("the metadata adapter uses only an injected native provider with exact usage", async () => {
  let calls = 0;
  const evaluator = createFintechMeasuredEvaluator(
    {
      id: "typesafe-native",
      evaluateWithMetadata: async (request, evaluateOptions) => {
        calls += 1;
        assert.equal(evaluateOptions?.deadlineMs, 2_000);
        assert.ok(evaluateOptions?.signal instanceof AbortSignal);
        return {
          response: {
            requestId: request.id,
            providerId: "typesafe-native",
            model: "jev-1.13.0",
            probabilitySemantics: "native_calibrated",
            answers: labelsForRequest(request),
          },
          usage: {
            inputTokens: request.questions.length * 10,
            outputTokens: request.questions.length,
          },
        };
      },
    },
    { model: "jev-1.13.0", transport: "typesafe-sdk-v0.6.0" },
  );
  const evidence = await runFintechBenchmark(
    fixtureCases(),
    runOptions(evaluator),
  );
  assert.doesNotThrow(() => assertFintechEvidence(evidence));
  assert.equal(calls, 14);

  assert.throws(
    () =>
      createFintechMeasuredEvaluator(
        {
          id: "other-provider",
          evaluateWithMetadata: async () => {
            throw new Error("must not run");
          },
        },
        { model: "jev-1.13.0", transport: "typesafe-sdk-v0.6.0" },
      ),
    /native TypeSafe provider/u,
  );
});

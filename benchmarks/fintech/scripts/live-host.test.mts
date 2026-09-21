import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  assessFintechLiveReadiness,
  type FintechLiveDatasetFile,
  readExplicitCredential,
  readFintechLiveDatasetFile,
  runAndPublishFintechLiveBenchmark,
} from "./live-host.mjs";

const digest = (value: string) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

function labels(
  ids: readonly FintechSignalId[],
): Record<FintechSignalId, boolean> {
  return Object.fromEntries(
    fintechSignalIds.map((id) => [id, ids.includes(id)]),
  ) as Record<FintechSignalId, boolean>;
}

function benchmarkCase(
  caseId: string,
  split: "calibration" | "test",
  enabled: readonly FintechSignalId[],
) {
  const goldSignals = labels(enabled);
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
        note: `Synthetic ${caseId}`,
        noteHash: digest(`Synthetic ${caseId}`),
        sourceHash: digest(`source-${caseId}`),
        trust: "untrusted_data_only",
        redaction: "host_redacted",
      },
      candidates: [
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
      ],
    },
    goldRoute: enabled.some(
      (id) =>
        id === "fintech-urgent-consumer-harm" ||
        id === "fintech-untrusted-influence",
    )
      ? "escalate"
      : enabled.length > 0
        ? "investigate"
        : "observe",
    goldSignals,
  } as const;
}

function dataset(): FintechLiveDatasetFile {
  const sourceDigest = digest("rights-reviewed-synthetic-source");
  return {
    format: "fintech-live-dataset-v1",
    run: {
      runId: "fintech-live-host-test",
      preregisteredAt: "2026-09-19T00:00:00.000Z",
      frozenAt: "2026-09-20T00:00:00.000Z",
      createdAt: "2026-09-20T12:00:00.000Z",
    },
    rightsReview: {
      reviewId: "review-1",
      reviewedAt: "2026-09-19T12:00:00.000Z",
      reviewer: "test-reviewer",
      approvedForRetainedBenchmark: true,
      datasetId: "synthetic-rights-reviewed-v1",
      sourceDigest,
    },
    dataset: {
      datasetId: "synthetic-rights-reviewed-v1",
      sourceUrl: "https://example.test/rights-reviewed",
      sourceDigest,
      license: "CC0-1.0",
      evidenceClass: "SYNTHETIC",
      redistributionAllowed: true,
      containsPersonalData: false,
      containsRegulatedData: false,
      deidentified: true,
    },
    pricing: {
      inputNanoUsdPerToken: "42",
      sourceUrl: "https://example.test/pricing",
      sourceDigest: digest("pricing"),
      observedAt: "2026-09-20T00:00:00.000Z",
    },
    limits: {
      concurrency: 2,
      maxProviderInvocations: 14,
      maxInputTokens: 20_000,
      reservedInputTokensPerInvocation: 1_000,
      maxAttempts: 1,
      deadlineMs: 2_000,
      maxCostNanoUsd: "840000",
    },
    provider: {
      id: "typesafe-native",
      model: "jev-1.13.0",
      transport: "typesafe-sdk-v0.6.0",
    },
    cases: [
      benchmarkCase("cal", "calibration", ["fintech-duplicate-or-reprocessed"]),
      benchmarkCase("test", "test", ["fintech-urgent-consumer-harm"]),
    ],
  };
}

class ScriptedNativeProvider {
  readonly id = "typesafe-native";
  calls = 0;
  async evaluateWithMetadata(request: DecisionRequest): Promise<{
    readonly response: DecisionResponse;
    readonly usage: {
      readonly inputTokens: number;
      readonly outputTokens: number;
    };
    readonly providerRequestIdHash: string;
  }> {
    this.calls += 1;
    const caseRef = (request.state as { readonly caseRef: string }).caseRef;
    const enabled =
      caseRef === "ref:cal"
        ? new Set(["fintech-duplicate-or-reprocessed"])
        : new Set(["fintech-urgent-consumer-harm"]);
    return {
      response: {
        requestId: request.id,
        providerId: this.id,
        model: "jev-1.13.0",
        probabilitySemantics: "native_calibrated",
        answers: request.questions.map((question) => ({
          questionId: question.id,
          type: "noul" as const,
          value: enabled.has(question.id),
          probabilityYes: enabled.has(question.id) ? 0.9 : 0.1,
        })),
      },
      usage: {
        inputTokens: request.questions.length * 10,
        outputTokens: request.questions.length,
      },
      providerRequestIdHash: digest(request.id),
    };
  }
}

test("readiness freezes and checks the full rights-reviewed envelope without provider calls", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-fintech-live-"));
  const input = join(directory, "dataset.json");
  await writeFile(input, JSON.stringify(dataset()), "utf8");
  const loaded = await readFintechLiveDatasetFile(input);
  const readiness = assessFintechLiveReadiness(loaded);
  assert.equal(readiness.networkCallsMade, 0);
  assert.equal(readiness.caseCount, 2);
  assert.equal(readiness.provider.model, "jev-1.13.0");
});

test("the live host runs all arms with an injected scripted provider and atomically publishes validated evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-fintech-live-"));
  const output = join(directory, "retained.json");
  const provider = new ScriptedNativeProvider();
  const evidence = await runAndPublishFintechLiveBenchmark(dataset(), {
    live: true,
    provider,
    outputPath: output,
  });
  assert.doesNotThrow(() => assertFintechEvidence(evidence));
  assert.equal(provider.calls, 14);
  assert.equal(evidence.executionState, "COMPLETED");
  assert.equal(JSON.stringify(evidence).includes("Synthetic cal"), false);
  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), evidence);
});

test("rights, cost, provider pin, fixture output, and secrets fail closed before a provider call", async () => {
  const provider = new ScriptedNativeProvider();
  const unapproved: unknown = {
    ...dataset(),
    rightsReview: {
      ...dataset().rightsReview,
      approvedForRetainedBenchmark: false,
    },
  };
  await assert.rejects(
    runAndPublishFintechLiveBenchmark(unapproved as FintechLiveDatasetFile, {
      live: true,
      provider,
      outputPath: join(tmpdir(), "never.json"),
    }),
    /rights review/u,
  );
  assert.equal(provider.calls, 0);
  assert.throws(
    () =>
      assessFintechLiveReadiness({
        ...dataset(),
        limits: { ...dataset().limits, maxCostNanoUsd: "1" },
      }),
    /cost budget/u,
  );
  await assert.rejects(
    runAndPublishFintechLiveBenchmark(dataset(), {
      live: true,
      provider,
      outputPath: join(
        process.cwd(),
        "benchmarks",
        "fintech",
        "fixtures",
        "must-not-write.json",
      ),
    }),
    /outside benchmarks/u,
  );
  assert.throws(
    () => readExplicitCredential("SECRET", { SECRET: "bad\nvalue" }),
    /credential/u,
  );
});

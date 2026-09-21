import assert from "node:assert/strict";
import test from "node:test";
import { OpenAICompatibleProvider } from "../../../packages/provider-openai-compatible/src/index.js";
import {
  financeSurveillancePack,
  financeSurveillanceQuestionSetHash,
} from "../../../packs/finance-surveillance/pack.js";
import type { LoadedFinanceDataset, runFinanceBenchmark } from "./run.mjs";
import {
  ALLOWED_OLLAMA_MODELS,
  createOllamaFinanceProvider,
  executeFinanceLiveCli,
  FinanceLiveCliError,
  type FinanceRunArtifacts,
  JEV_PRICING_EVIDENCE,
  OLLAMA_ENDPOINT,
  OLLAMA_PROVIDER_ID,
  parseFinanceLiveArguments,
} from "./run-live.mjs";

const hash = (character: string) => `sha256:${character.repeat(64)}`;

const baseArguments = [
  "--live",
  "--dataset",
  "fixture-dataset",
  "--output",
  "fixture-output",
  "--run-id",
  "finance-live-test",
  "--host-provider",
  OLLAMA_PROVIDER_ID,
  "--host-model",
  "qwen3.5:9b",
  "--host-model-version",
  hash("a"),
  "--host-model-version-url",
  "https://models.example.test/ollama/qwen3.5-9b",
  "--host-model-version-observed-at",
  "2026-09-21T00:00:00.000Z",
  "--host-endpoint",
  OLLAMA_ENDPOINT,
  "--jev-provider",
  "typesafe-native",
  "--jev-model",
  "jev-1.13.0",
  "--hardware",
  "offline-test-cpu",
  "--region",
  "offline",
  "--max-calls",
  "20",
  "--max-reserved-input-tokens",
  "20000",
  "--estimated-input-tokens-per-call",
  "1000",
  "--concurrency",
  "2",
  "--max-queue",
  "20",
  "--deadline-ms",
  "1000",
  "--max-false-observe-group-risk-upper-bound",
  "0.2",
  "--minimum-calibration-groups-per-partition",
  "2",
] as const;

function dataset(
  evidenceClass: "SYNTHETIC" | "LOCAL_EXPLORATORY" | "RETAINED_PUBLIC",
  regularCases = 1,
): LoadedFinanceDataset {
  return {
    manifest: {
      schemaVersion: "1",
      datasetId: "finance-live-fixture",
      sourceUrl: "https://dataset.example.test/finance",
      caseSetHash: hash("b"),
      license: "test-only",
      evidenceClass,
      redistributionAllowed: true,
      containsSensitiveData: false,
      splitMethod: "forward_chaining_time_split",
      trainEnd: "2026-01-01T00:00:00.000Z",
      testStart: "2026-02-01T00:00:00.000Z",
    },
    cases: Array.from({ length: regularCases }, (_, index) => ({
      schemaVersion: "2",
      id: `case-${index}`,
      groupId: `group-${index}`,
      track: "market_surveillance",
      split: "test",
      goldRoute: "observe",
      goldAtomic: [],
      lookaheadProbe: false,
      evaluationNow: "2026-02-01T00:00:00.000Z",
      trustedProjection: { featureSetHash: hash("c") },
      untrustedEvidence: {},
    })) as unknown as LoadedFinanceDataset["cases"],
    casesBytes: new Uint8Array(),
    visualArtifacts: [],
    builderEvidence: null,
  };
}

test("requires an explicit live acknowledgement and rejects credential flags", () => {
  assert.throws(
    () => parseFinanceLiveArguments(baseArguments.slice(1)),
    (error: unknown) =>
      error instanceof FinanceLiveCliError &&
      error.code === "LIVE_ACKNOWLEDGEMENT_REQUIRED",
  );
  assert.throws(
    () => parseFinanceLiveArguments([...baseArguments, "--api-key", "secret"]),
    (error: unknown) =>
      error instanceof FinanceLiveCliError && error.code === "UNKNOWN_FLAG",
  );
});

test("pins the provider, model, endpoint, and finite budgets", () => {
  const parsed = parseFinanceLiveArguments(baseArguments);
  assert.equal(parsed.hostProvider, OLLAMA_PROVIDER_ID);
  assert.equal(parsed.hostModel, "qwen3.5:9b");
  assert.equal(parsed.hostEndpoint, OLLAMA_ENDPOINT);
  assert.equal(parsed.jevProvider, "typesafe-native");
  assert.equal(parsed.jevModel, "jev-1.13.0");
  assert.equal(parsed.limits.maxCalls, 20);
  assert.equal(parsed.limits.maxReservedInputTokens, 20_000);
  assert.equal(parsed.limits.concurrency, 2);
  assert.ok(ALLOWED_OLLAMA_MODELS.includes(parsed.hostModel));

  for (const replacement of [
    [OLLAMA_ENDPOINT, "http://localhost:11434/v1/chat/completions"],
    ["qwen3.5:9b", "unreviewed:latest"],
    ["typesafe-native", "typesafe-gateway"],
    ["jev-1.13.0", "jev-latest"],
  ] as const) {
    const changed = baseArguments.map((value) =>
      value === replacement[0] ? replacement[1] : value,
    );
    assert.throws(() => parseFinanceLiveArguments(changed));
  }
});

test("constructs Ollama with immutable zero-retry transport policy", () => {
  const provider = createOllamaFinanceProvider("qwen3.5:9b");
  assert.equal(provider.id, OLLAMA_PROVIDER_ID);
  assert.deepEqual(OpenAICompatibleProvider.executionPolicyOf(provider), {
    maxRedirects: 0,
    repairAttempts: 0,
    structuredOutput: true,
    temperature: 0,
    probabilityMode: "one_hot",
  });
  assert.throws(
    () =>
      createOllamaFinanceProvider(
        "unreviewed:latest" as (typeof ALLOWED_OLLAMA_MODELS)[number],
      ),
    /allowlisted/u,
  );
});

test("requires exploratory acknowledgement before reading a credential", async () => {
  let benchmarkCalled = false;
  await assert.rejects(
    executeFinanceLiveCli(baseArguments, {
      env: {},
      loadDataset: async () => dataset("SYNTHETIC"),
      runBenchmark: async () => {
        benchmarkCalled = true;
        throw new Error("must not run");
      },
    }),
    (error: unknown) =>
      error instanceof FinanceLiveCliError &&
      error.code === "EXPLORATORY_ACKNOWLEDGEMENT_REQUIRED",
  );
  assert.equal(benchmarkCalled, false);
});

test("rejects budgets that cannot admit both provider-backed appearances", async () => {
  const argumentsWithOneCall = baseArguments.map((value, index) =>
    baseArguments[index - 1] === "--max-calls" ? "1" : value,
  );
  await assert.rejects(
    executeFinanceLiveCli(argumentsWithOneCall, {
      env: { TYPESAFE_API_KEY: "test-secret" },
      loadDataset: async () => dataset("RETAINED_PUBLIC"),
    }),
    (error: unknown) =>
      error instanceof FinanceLiveCliError &&
      error.code === "CALL_BUDGET_TOO_SMALL",
  );
});

test("assembles redacted retained evidence without making an offline provider call", async () => {
  let retainedInput: Parameters<typeof runFinanceBenchmark>[0] | undefined;
  let written = false;
  let stdout = "";
  const fakeArtifacts = {} as FinanceRunArtifacts;
  await executeFinanceLiveCli(baseArguments, {
    env: { TYPESAFE_API_KEY: "test-secret-never-log" },
    loadDataset: async () => dataset("RETAINED_PUBLIC"),
    runBenchmark: async (input) => {
      retainedInput = input;
      return fakeArtifacts;
    },
    writeArtifacts: async (_directory, artifacts) => {
      assert.equal(artifacts, fakeArtifacts);
      written = true;
    },
    writeStdout: (value) => {
      stdout += value;
    },
  });

  assert.equal(written, true);
  assert.ok(retainedInput);
  assert.equal(
    retainedInput.runtime.questionSetHash,
    financeSurveillanceQuestionSetHash,
  );
  assert.equal(
    retainedInput.runtime.architectures.jev_advisory.combinerId,
    financeSurveillancePack.manifest.id,
  );
  assert.equal(
    retainedInput.runtime.architectures.jev_advisory.combinerVersion,
    financeSurveillancePack.manifest.version,
  );
  assert.deepEqual(retainedInput.runtimeEvidence[0], JEV_PRICING_EVIDENCE);
  assert.equal(retainedInput.runtimeEvidence[1]?.kind, "model_version");
  assert.equal(
    retainedInput.runtime.architectures.host_model_only.components[0]
      ?.modelVersion,
    hash("a"),
  );
  assert.match(stdout, /"status":"COMPLETED"/u);
  assert.doesNotMatch(stdout, /test-secret-never-log/u);
  assert.doesNotMatch(stdout, /fixture-dataset|fixture-output/u);
});

test("pins the reviewed Jev price record", () => {
  assert.deepEqual(JEV_PRICING_EVIDENCE, {
    schemaVersion: "1",
    kind: "pricing",
    inputNanoUsdPerToken: "42",
    outputNanoUsdPerToken: "0",
    sourceUrl: "https://docs.typesafe.ai/models",
    observedAt: "2026-09-21T00:00:00.000Z",
    priceVersion: "jev-1.13.0-2026-09-21",
  });
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  truncate,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  aggregateFinanceBenchmarkTraces,
  type FinanceBenchmarkTrace,
  type FinanceTrack,
  stableJson,
} from "../../../packages/evals/src/index.js";
import {
  type FinanceBenchmarkCase,
  type FinanceBenchmarkDrivers,
  type FinanceDatasetManifest,
  type FinanceRuntimeEvidence,
  type FinanceRuntimeProvenance,
  loadFinanceDataset,
  runFinanceBenchmark,
  writeFinanceArtifacts,
} from "./run.mjs";
import {
  validateFinanceArtifactDirectory,
  validateFinanceRun,
} from "./validate.mjs";

const hash = (character: string) => `sha256:${character.repeat(64)}`;

function benchmarkCase(
  track: FinanceTrack,
  split: "calibration" | "test",
  probe: boolean,
): FinanceBenchmarkCase {
  const observedAt =
    split === "calibration"
      ? "2026-01-15T12:00:00.000Z"
      : "2026-02-15T12:00:00.000Z";
  const prefix = `${track}-${split}-${probe ? "probe" : "regular"}`;
  const visual =
    track === "visual_evidence"
      ? {
          mode: "structured_extraction" as const,
          extractorId: "chart.extractor",
          extractorVersion: "1",
          imageHash: hash("a"),
          axesVerified: true as const,
          sourceBindingHash: hash("b"),
        }
      : undefined;
  const text =
    track === "financial_text_triage"
      ? {
          mode: "bounded_excerpts" as const,
          extractorId: "filing.extractor",
          extractorVersion: "1",
          documentHash: hash("c"),
          sourceBindingHash: hash("d"),
        }
      : undefined;
  return {
    schemaVersion: "1",
    id: prefix,
    groupId: `${prefix}-group`,
    track,
    split,
    goldRoute: "observe",
    lookaheadProbe: probe,
    evaluationNow:
      split === "calibration"
        ? "2026-01-15T12:01:00.000Z"
        : "2026-02-15T12:01:00.000Z",
    trustedProjection: {
      instrumentRef: "ref:instrument.fixture",
      assetClass: "equity",
      venue: "fixture.venue",
      sourceId: "fixture.source",
      sourceHash: hash("e"),
      featureSetId: "fixture.features",
      featureSetVersion: "1",
      featureSetHash: hash("f"),
      observedAt,
      windowStart:
        split === "calibration"
          ? "2026-01-15T11:00:00.000Z"
          : "2026-02-15T11:00:00.000Z",
      windowEnd:
        split === "calibration"
          ? "2026-01-15T11:30:00.000Z"
          : "2026-02-15T11:30:00.000Z",
      cutoffAt:
        split === "calibration"
          ? "2026-01-15T11:50:00.000Z"
          : "2026-02-15T11:50:00.000Z",
      maxAgeMs: 3_600_000,
      signals: [
        {
          id: "volatility.bucket",
          bucket: "normal",
          definitionHash: hash("1"),
          evidenceHash: hash("2"),
          asOf: probe
            ? split === "calibration"
              ? "2026-01-15T11:55:00.000Z"
              : "2026-02-15T11:55:00.000Z"
            : split === "calibration"
              ? "2026-01-15T11:40:00.000Z"
              : "2026-02-15T11:40:00.000Z",
        },
      ],
      ...(visual === undefined ? {} : { visual }),
      ...(text === undefined ? {} : { text }),
    },
    untrustedEvidence: {
      ...(visual === undefined
        ? {}
        : {
            visual: {
              annotations: ["Series remains inside the declared axis"],
            },
          }),
      ...(text === undefined
        ? {}
        : { text: { excerpts: ["Routine filing excerpt for routing."] } }),
    },
  };
}

function cases(): FinanceBenchmarkCase[] {
  return [
    ...(
      [
        "market_surveillance",
        "visual_evidence",
        "financial_text_triage",
      ] as const
    ).map((track) => benchmarkCase(track, "calibration", false)),
    ...(
      [
        "market_surveillance",
        "visual_evidence",
        "financial_text_triage",
      ] as const
    ).flatMap((track) => [
      benchmarkCase(track, "test", false),
      benchmarkCase(track, "test", true),
    ]),
  ];
}

async function datasetDirectory(
  mutate?: (values: FinanceBenchmarkCase[]) => void,
): Promise<{ root: string; directory: string }> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "jev-finance-runner-"));
  const directory = join(fixtureRoot, "dataset");
  await mkdir(directory);
  const values = cases();
  mutate?.(values);
  const casesText = `${values.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  const manifest: FinanceDatasetManifest = {
    schemaVersion: "1",
    datasetId: "synthetic-runner-fixture",
    sourceUrl: "https://example.invalid/fixture",
    caseSetHash: `sha256:${createHash("sha256").update(casesText).digest("hex")}`,
    license: "Apache-2.0 fixture",
    evidenceClass: "SYNTHETIC",
    redistributionAllowed: true,
    containsSensitiveData: false,
    splitMethod: "forward_chaining_time_split",
    trainEnd: "2026-01-31T23:59:59.000Z",
    testStart: "2026-02-01T00:00:00.000Z",
  };
  await Promise.all([
    writeFile(
      join(directory, "dataset-manifest.json"),
      JSON.stringify(manifest),
    ),
    writeFile(join(directory, "cases.jsonl"), casesText),
  ]);
  return { root: fixtureRoot, directory };
}

const predicted = {
  status: "predicted" as const,
  predictedRoute: "observe" as const,
  routeQuestionProbabilities: {
    observe: 0.8,
    investigate: 0.1,
    escalate: 0.1,
  },
  calibrationStatus: "measured" as const,
  abstained: false,
  unsafeExecutionAttempt: false,
  inputTokens: 10,
  outputTokens: 2,
  costNanoUsd: "5000",
  componentAccounting: [
    {
      role: "host" as const,
      inputTokens: 10,
      outputTokens: 2,
      costNanoUsd: "5000",
    },
  ],
};

const drivers: FinanceBenchmarkDrivers = {
  deterministic_only: () => ({
    ...predicted,
    routeQuestionProbabilities: null,
    calibrationStatus: "unavailable",
    calibrationReason: "deterministic_only",
    inputTokens: 0,
    outputTokens: 0,
    costNanoUsd: "0",
    componentAccounting: [],
  }),
  host_model_only: () => predicted,
  jev_advisory: () => ({
    ...predicted,
    componentAccounting: [
      {
        role: "jev",
        inputTokens: 10,
        outputTokens: 2,
        costNanoUsd: "5000",
      },
    ],
  }),
  host_plus_jev: () => ({
    ...predicted,
    routeQuestionProbabilities: null,
    calibrationStatus: "unavailable",
    calibrationReason: "composite_no_distribution",
    inputTokens: 20,
    outputTokens: 4,
    costNanoUsd: "10000",
    componentAccounting: [
      {
        role: "host",
        inputTokens: 10,
        outputTokens: 2,
        costNanoUsd: "5000",
      },
      {
        role: "jev",
        inputTokens: 10,
        outputTokens: 2,
        costNanoUsd: "5000",
      },
    ],
  }),
};

const pricingEvidence = {
  schemaVersion: "1",
  kind: "pricing",
  inputNanoUsdPerToken: "500",
  outputNanoUsdPerToken: "0",
  sourceUrl: "https://pricing.example.test/models",
  observedAt: "2026-09-20T00:00:00.000Z",
  priceVersion: "2026-09-20",
} as const satisfies FinanceRuntimeEvidence;

const jevModelEvidence = {
  schemaVersion: "1",
  kind: "model_version",
  sourceUrl: "https://models.example.test/typesafe-ai/jev",
  observedAt: "2026-09-20T00:00:00.000Z",
  providerId: "jev-fixture",
  modelId: "jev-model",
  modelVersion: "jev-1.13.0",
  responseModel: "typesafe-ai/jev",
} as const satisfies FinanceRuntimeEvidence;

const evidenceHash = (evidence: FinanceRuntimeEvidence) =>
  `sha256:${createHash("sha256").update(stableJson(evidence)).digest("hex")}`;

const runtimeEvidence = [pricingEvidence, jevModelEvidence] as const;

const component = (
  role: "deterministic" | "host" | "jev",
  probabilitySemantics: "none" | "native_calibrated" | "normalized_logits",
) => ({
  role,
  providerId: `${role}-fixture`,
  modelId: role === "deterministic" ? "none" : `${role}-model`,
  modelVersion:
    role === "jev" ? jevModelEvidence.modelVersion : `${role}-1.0.0`,
  responseModel:
    role === "jev" ? jevModelEvidence.responseModel : `${role}-1.0.0`,
  modelVersionEvidence:
    role === "jev"
      ? {
          kind: "external_attestation" as const,
          sourceUrl: jevModelEvidence.sourceUrl,
          observedAt: jevModelEvidence.observedAt,
          evidenceHash: evidenceHash(jevModelEvidence),
        }
      : { kind: "response_exact" as const },
  probabilitySemantics,
  pricing:
    role === "deterministic"
      ? null
      : {
          inputNanoUsdPerToken: pricingEvidence.inputNanoUsdPerToken,
          outputNanoUsdPerToken: pricingEvidence.outputNanoUsdPerToken,
          sourceUrl: pricingEvidence.sourceUrl,
          observedAt: pricingEvidence.observedAt,
          priceVersion: pricingEvidence.priceVersion,
          priceHash: evidenceHash(pricingEvidence),
        },
});

const runtime: FinanceRuntimeProvenance = {
  questionSetHash: hash("3"),
  policyVersion: "1",
  featureSetHash: hash("4"),
  hardware: "fixture-cpu",
  region: "offline",
  concurrency: 4,
  timeoutMs: 1_000,
  architectures: {
    deterministic_only: {
      components: [component("deterministic", "none")],
      combinerId: "deterministic-baseline",
      combinerVersion: "1",
    },
    host_model_only: {
      components: [component("host", "normalized_logits")],
      combinerId: "host-route",
      combinerVersion: "1",
    },
    jev_advisory: {
      components: [component("jev", "native_calibrated")],
      combinerId: "finance-surveillance-pack",
      combinerVersion: "0.1.0",
    },
    host_plus_jev: {
      components: [
        component("host", "normalized_logits"),
        component("jev", "native_calibrated"),
      ],
      combinerId: "restrictive-join",
      combinerVersion: "1",
    },
  },
};

test("runs, retains, and independently validates the complete finance matrix", async () => {
  const fixture = await datasetDirectory();
  try {
    const dataset = await loadFinanceDataset(fixture.directory);
    const artifacts = await runFinanceBenchmark({
      runId: "finance-fixture-1",
      dataset,
      drivers,
      runtime,
      runtimeEvidence,
      now: () => 100,
    });
    assert.equal(artifacts.run.sampleCount, 6);
    assert.equal(artifacts.run.traceCount, 24);
    assert.equal(
      (artifacts.run.rows as Array<{ sampleCount: number }>).length,
      12,
    );
    assert.ok(
      (artifacts.run.rows as Array<{ sampleCount: number }>).every(
        (row) => row.sampleCount === 2,
      ),
    );
    assert.doesNotThrow(() => validateFinanceRun(artifacts.run));
    const output = join(fixture.root, "artifacts");
    await writeFinanceArtifacts(output, artifacts);
    assert.deepEqual(
      await readdir(join(output, "evidence")),
      runtimeEvidence
        .map(
          (evidence) =>
            `${evidenceHash(evidence).slice("sha256:".length)}.json`,
        )
        .sort(),
    );
    await assert.doesNotReject(validateFinanceArtifactDirectory(output));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("offline validation rejects missing retained runtime evidence", async () => {
  const fixture = await datasetDirectory();
  try {
    const dataset = await loadFinanceDataset(fixture.directory);
    const artifacts = await runFinanceBenchmark({
      runId: "finance-missing-runtime-evidence",
      dataset,
      drivers,
      runtime,
      runtimeEvidence,
      now: () => 100,
    });
    const output = join(fixture.root, "artifacts");
    await writeFinanceArtifacts(output, artifacts);
    await unlink(
      join(
        output,
        "evidence",
        `${evidenceHash(pricingEvidence).slice("sha256:".length)}.json`,
      ),
    );
    await assert.rejects(
      validateFinanceArtifactDirectory(output),
      /runtime evidence file set/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("offline validation rejects tampered or extra runtime evidence files", async () => {
  const tamperedFixture = await datasetDirectory();
  try {
    const dataset = await loadFinanceDataset(tamperedFixture.directory);
    const artifacts = await runFinanceBenchmark({
      runId: "finance-tampered-runtime-evidence",
      dataset,
      drivers,
      runtime,
      runtimeEvidence,
      now: () => 100,
    });
    const output = join(tamperedFixture.root, "artifacts");
    await writeFinanceArtifacts(output, artifacts);
    await writeFile(
      join(
        output,
        "evidence",
        `${evidenceHash(pricingEvidence).slice("sha256:".length)}.json`,
      ),
      JSON.stringify(pricingEvidence),
    );
    await assert.rejects(
      validateFinanceArtifactDirectory(output),
      /not canonical JSON/u,
    );
  } finally {
    await rm(tamperedFixture.root, { recursive: true, force: true });
  }

  const extraFixture = await datasetDirectory();
  try {
    const dataset = await loadFinanceDataset(extraFixture.directory);
    const artifacts = await runFinanceBenchmark({
      runId: "finance-extra-runtime-evidence",
      dataset,
      drivers,
      runtime,
      runtimeEvidence,
      now: () => 100,
    });
    const output = join(extraFixture.root, "artifacts");
    await writeFinanceArtifacts(output, artifacts);
    await writeFile(join(output, "evidence", `${"0".repeat(64)}.json`), "{}");
    await assert.rejects(
      validateFinanceArtifactDirectory(output),
      /runtime evidence file set/u,
    );
  } finally {
    await rm(extraFixture.root, { recursive: true, force: true });
  }
});

test("offline validation rejects forged repricing without its retained evidence", async () => {
  const fixture = await datasetDirectory();
  try {
    const dataset = await loadFinanceDataset(fixture.directory);
    const artifacts = await runFinanceBenchmark({
      runId: "finance-forged-pricing-evidence",
      dataset,
      drivers,
      runtime,
      runtimeEvidence,
      now: () => 100,
    });
    const output = join(fixture.root, "artifacts");
    await writeFinanceArtifacts(output, artifacts);

    const tracesPath = join(output, "traces.jsonl");
    const traces = (await readFile(tracesPath, "utf8"))
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line)) as Array<
      FinanceBenchmarkTrace & Record<string, unknown>
    >;
    for (const trace of traces) {
      if (
        trace.status !== "predicted" ||
        trace.architecture === "deterministic_only"
      )
        continue;
      let total = 0n;
      for (const rawItem of trace.componentAccounting) {
        const item = rawItem as {
          inputTokens: number;
          outputTokens: number;
          costNanoUsd: string;
        };
        const cost = BigInt(item.inputTokens) * 501n;
        item.costNanoUsd = cost.toString();
        total += cost;
      }
      (trace as { costNanoUsd: string }).costNanoUsd = total.toString();
    }
    const traceText = `${traces.map((trace) => JSON.stringify(trace)).join("\n")}\n`;
    await writeFile(tracesPath, traceText);

    const runPath = join(output, "run.json");
    const run = JSON.parse(await readFile(runPath, "utf8")) as {
      traceSetHash: string;
      rows: unknown;
      runtime: FinanceRuntimeProvenance;
    };
    for (const architecture of Object.values(run.runtime.architectures)) {
      for (const runtimeComponent of architecture.components) {
        if (runtimeComponent.pricing === null) continue;
        (
          runtimeComponent.pricing as {
            inputNanoUsdPerToken: string;
            priceHash: string;
          }
        ).inputNanoUsdPerToken = "501";
        (
          runtimeComponent.pricing as {
            priceHash: string;
          }
        ).priceHash = hash("8");
      }
    }
    run.traceSetHash = `sha256:${createHash("sha256")
      .update(traceText)
      .digest("hex")}`;
    run.rows = aggregateFinanceBenchmarkTraces(traces);
    await writeFile(runPath, JSON.stringify(run));

    await assert.rejects(
      validateFinanceArtifactDirectory(output),
      /runtime evidence .* canonical metadata/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("concurrency does not change canonical retained traces", async () => {
  const fixture = await datasetDirectory();
  try {
    const dataset = await loadFinanceDataset(fixture.directory);
    const serial = await runFinanceBenchmark({
      runId: "finance-deterministic",
      dataset,
      drivers,
      runtime: { ...runtime, concurrency: 1 },
      runtimeEvidence,
      now: () => 100,
    });
    const concurrent = await runFinanceBenchmark({
      runId: "finance-deterministic",
      dataset,
      drivers,
      runtime,
      runtimeEvidence,
      now: () => 100,
    });
    assert.equal(serial.tracesJsonl, concurrent.tracesJsonl);
    assert.deepEqual(serial.run.rows, concurrent.run.rows);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("rejects digest drift, split leakage, and unsafe driver output", async () => {
  const digestFixture = await datasetDirectory();
  try {
    await writeFile(
      join(digestFixture.directory, "cases.jsonl"),
      `${await readFile(join(digestFixture.directory, "cases.jsonl"), "utf8")} `,
    );
    await assert.rejects(
      loadFinanceDataset(digestFixture.directory),
      /caseSetHash/u,
    );
  } finally {
    await rm(digestFixture.root, { recursive: true, force: true });
  }

  const splitFixture = await datasetDirectory((values) => {
    const calibration = values.at(0);
    const testCase = values.at(3);
    assert.ok(calibration);
    assert.ok(testCase);
    values[3] = { ...testCase, groupId: calibration.groupId };
  });
  try {
    await assert.rejects(
      loadFinanceDataset(splitFixture.directory),
      /group crosses splits/u,
    );
  } finally {
    await rm(splitFixture.root, { recursive: true, force: true });
  }

  const unsafeFixture = await datasetDirectory();
  try {
    const dataset = await loadFinanceDataset(unsafeFixture.directory);
    await assert.rejects(
      runFinanceBenchmark({
        runId: "finance-unsafe",
        dataset,
        runtime,
        runtimeEvidence,
        drivers: {
          ...drivers,
          jev_advisory: () => ({
            ...predicted,
            unsafeExecutionAttempt: true,
            componentAccounting: [
              {
                role: "jev",
                inputTokens: 10,
                outputTokens: 2,
                costNanoUsd: "5000",
              },
            ],
          }),
        },
        now: () => 100,
      }),
      /attempted financial execution/u,
    );
  } finally {
    await rm(unsafeFixture.root, { recursive: true, force: true });
  }
});

test("trace tampering invalidates the retained set hash", async () => {
  const fixture = await datasetDirectory();
  try {
    const dataset = await loadFinanceDataset(fixture.directory);
    const artifacts = await runFinanceBenchmark({
      runId: "finance-tamper",
      dataset,
      drivers,
      runtime,
      runtimeEvidence,
      now: () => 100,
    });
    const output = join(fixture.root, "artifacts");
    await writeFinanceArtifacts(output, artifacts);
    await writeFile(
      join(output, "traces.jsonl"),
      `${await readFile(join(output, "traces.jsonl"), "utf8")} `,
    );
    await assert.rejects(
      validateFinanceArtifactDirectory(output),
      /traceSetHash/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("independent validation rejects repriced traces even after aggregate and hash forgery", async () => {
  const fixture = await datasetDirectory();
  try {
    const dataset = await loadFinanceDataset(fixture.directory);
    const artifacts = await runFinanceBenchmark({
      runId: "finance-repriced",
      dataset,
      drivers,
      runtime,
      runtimeEvidence,
      now: () => 100,
    });
    const output = join(fixture.root, "artifacts");
    await writeFinanceArtifacts(output, artifacts);
    const tracesPath = join(output, "traces.jsonl");
    const traces = (await readFile(tracesPath, "utf8"))
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line)) as Array<
      FinanceBenchmarkTrace & Record<string, unknown>
    >;
    const target = traces.find(
      (trace) =>
        trace.architecture === "host_model_only" &&
        trace.status === "predicted",
    );
    assert.ok(target);
    (target as { costNanoUsd: string }).costNanoUsd = "0";
    (
      target.componentAccounting[0] as {
        costNanoUsd: string;
      }
    ).costNanoUsd = "0";
    const traceText = `${traces.map((trace) => JSON.stringify(trace)).join("\n")}\n`;
    await writeFile(tracesPath, traceText);
    const runPath = join(output, "run.json");
    const run = JSON.parse(await readFile(runPath, "utf8")) as Record<
      string,
      unknown
    >;
    run.traceSetHash = `sha256:${createHash("sha256")
      .update(traceText)
      .digest("hex")}`;
    run.rows = aggregateFinanceBenchmarkTraces(traces);
    await writeFile(runPath, JSON.stringify(run));
    await assert.rejects(
      validateFinanceArtifactDirectory(output),
      /cost does not match retained pricing/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("runtime rejects inconsistent or malformed pricing provenance", async () => {
  const fixture = await datasetDirectory();
  try {
    const dataset = await loadFinanceDataset(fixture.directory);
    const inconsistent = structuredClone(runtime);
    const compositeHost =
      inconsistent.architectures.host_plus_jev.components[0];
    assert.ok(compositeHost?.pricing);
    (
      compositeHost.pricing as {
        inputNanoUsdPerToken: string;
      }
    ).inputNanoUsdPerToken = "101";
    await assert.rejects(
      runFinanceBenchmark({
        runId: "finance-pricing-drift",
        dataset,
        drivers,
        runtime: inconsistent,
        runtimeEvidence,
        now: () => 100,
      }),
      /component provenance must be identical/u,
    );

    const malformed = structuredClone(runtime);
    const jevPricing =
      malformed.architectures.jev_advisory.components[0]?.pricing;
    assert.ok(jevPricing);
    (jevPricing as { sourceUrl: string }).sourceUrl =
      "https://user:secret@pricing.example.test/models";
    await assert.rejects(
      runFinanceBenchmark({
        runId: "finance-pricing-url",
        dataset,
        drivers,
        runtime: malformed,
        runtimeEvidence,
        now: () => 100,
      }),
      /credential-free HTTPS/u,
    );

    const queryPricing = structuredClone(runtime);
    const queryPrice =
      queryPricing.architectures.jev_advisory.components[0]?.pricing;
    assert.ok(queryPrice);
    (queryPrice as { sourceUrl: string }).sourceUrl =
      "https://pricing.example.test/models?api_key=secret";
    await assert.rejects(
      runFinanceBenchmark({
        runId: "finance-pricing-query",
        dataset,
        drivers,
        runtime: queryPricing,
        runtimeEvidence,
        now: () => 100,
      }),
      /credential-free HTTPS/u,
    );

    const queryModelEvidence = structuredClone(runtime);
    const modelEvidence =
      queryModelEvidence.architectures.jev_advisory.components[0]
        ?.modelVersionEvidence;
    assert.ok(modelEvidence?.kind === "external_attestation");
    (modelEvidence as { sourceUrl: string }).sourceUrl =
      "https://models.example.test/typesafe-ai/jev?token=secret";
    await assert.rejects(
      runFinanceBenchmark({
        runId: "finance-model-evidence-query",
        dataset,
        drivers,
        runtime: queryModelEvidence,
        runtimeEvidence,
        now: () => 100,
      }),
      /credential-free HTTPS/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("retained run metadata is bound to the dataset manifest", async () => {
  const mutations = [
    ["datasetId", "different-dataset"],
    ["sourceUrl", "https://example.invalid/different"],
    ["digest", hash("9")],
    ["license", "Different licence"],
    ["evidenceClass", "LOCAL_EXPLORATORY"],
    ["redistributionAllowed", false],
    ["trainEnd", "2026-01-30T23:59:59.000Z"],
    ["testStart", "2026-02-02T00:00:00.000Z"],
  ] as const;
  for (const [field, replacement] of mutations) {
    const fixture = await datasetDirectory();
    try {
      const dataset = await loadFinanceDataset(fixture.directory);
      const artifacts = await runFinanceBenchmark({
        runId: `finance-metadata-${field}`,
        dataset,
        drivers,
        runtime,
        runtimeEvidence,
        now: () => 100,
      });
      const output = join(fixture.root, "artifacts");
      await writeFinanceArtifacts(output, artifacts);
      const runPath = join(output, "run.json");
      const run = JSON.parse(await readFile(runPath, "utf8")) as {
        dataset: Record<string, unknown>;
      };
      run.dataset[field] = replacement;
      await writeFile(runPath, JSON.stringify(run));
      await assert.rejects(
        validateFinanceArtifactDirectory(output),
        /dataset metadata does not match/u,
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }
});

test("rejects non-HTTPS provenance and oversized files before parsing", async () => {
  const urlFixture = await datasetDirectory();
  try {
    const manifestPath = join(urlFixture.directory, "dataset-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    manifest.sourceUrl = "javascript:alert(1)";
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(
      loadFinanceDataset(urlFixture.directory),
      /HTTPS URL/u,
    );
  } finally {
    await rm(urlFixture.root, { recursive: true, force: true });
  }

  const sizeFixture = await datasetDirectory();
  try {
    await truncate(
      join(sizeFixture.directory, "cases.jsonl"),
      100 * 1024 * 1024 + 1,
    );
    await assert.rejects(
      loadFinanceDataset(sizeFixture.directory),
      /exceeds its byte limit/u,
    );
  } finally {
    await rm(sizeFixture.root, { recursive: true, force: true });
  }
});

test("driver context omits dataset identifiers and labels", async () => {
  const fixture = await datasetDirectory();
  try {
    const dataset = await loadFinanceDataset(fixture.directory);
    const observedKeys = new Set<string>();
    await runFinanceBenchmark({
      runId: "finance-context-boundary",
      dataset,
      runtime,
      runtimeEvidence,
      drivers: Object.fromEntries(
        Object.entries(drivers).map(([architecture, driver]) => [
          architecture,
          async (...args: Parameters<typeof driver>) => {
            for (const key of Object.keys(args[1])) observedKeys.add(key);
            return driver(...args);
          },
        ]),
      ) as FinanceBenchmarkDrivers,
      now: () => 100,
    });
    assert.deepEqual([...observedKeys].sort(), [
      "architecture",
      "signal",
      "track",
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("token and price accounting remain independently unavailable rather than zero", async () => {
  const fixture = await datasetDirectory();
  try {
    const dataset = await loadFinanceDataset(fixture.directory);
    const unmeteredRuntime = structuredClone(runtime);
    (
      unmeteredRuntime.architectures.host_model_only.components[0] as {
        pricing: null;
      }
    ).pricing = null;
    (
      unmeteredRuntime.architectures.host_plus_jev.components[0] as {
        pricing: null;
      }
    ).pricing = null;
    const artifacts = await runFinanceBenchmark({
      runId: "finance-unmetered",
      dataset,
      runtime: unmeteredRuntime,
      runtimeEvidence,
      drivers: {
        ...drivers,
        host_model_only: () => ({
          ...predicted,
          costNanoUsd: null,
          componentAccounting: [
            {
              role: "host",
              inputTokens: 10,
              outputTokens: 2,
              costNanoUsd: null,
            },
          ],
        }),
        jev_advisory: () => ({
          ...predicted,
          inputTokens: null,
          outputTokens: null,
          costNanoUsd: null,
          componentAccounting: [
            {
              role: "jev",
              inputTokens: null,
              outputTokens: null,
              costNanoUsd: null,
            },
          ],
        }),
        host_plus_jev: () => ({
          ...predicted,
          routeQuestionProbabilities: null,
          calibrationStatus: "unavailable",
          calibrationReason: "composite_no_distribution",
          inputTokens: 20,
          outputTokens: 4,
          costNanoUsd: null,
          componentAccounting: [
            {
              role: "host",
              inputTokens: 10,
              outputTokens: 2,
              costNanoUsd: null,
            },
            {
              role: "jev",
              inputTokens: 10,
              outputTokens: 2,
              costNanoUsd: "5000",
            },
          ],
        }),
      },
      now: () => 100,
    });
    const rows = artifacts.run.rows as Array<{
      readonly architecture: string;
      readonly tokenAccountingStatus: string;
      readonly costAccountingStatus: string;
      readonly metrics: Readonly<
        Record<
          "inputTokens" | "outputTokens" | "estimatedCostUsd",
          number | null
        >
      >;
    }>;
    const hostRows = rows.filter(
      (row) => row.architecture === "host_model_only",
    );
    assert.ok(
      hostRows.every(
        (row) =>
          row.tokenAccountingStatus === "MEASURED" &&
          row.costAccountingStatus === "UNMETERED" &&
          row.metrics.inputTokens === 10 &&
          row.metrics.outputTokens === 2 &&
          row.metrics.estimatedCostUsd === null,
      ),
    );
    const jevRows = rows.filter((row) => row.architecture === "jev_advisory");
    assert.ok(
      jevRows.every(
        (row) =>
          row.tokenAccountingStatus === "UNMETERED" &&
          row.costAccountingStatus === "UNMETERED" &&
          row.metrics.inputTokens === null &&
          row.metrics.outputTokens === null &&
          row.metrics.estimatedCostUsd === null,
      ),
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

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
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  computeFinanceProjectionBindingHash,
  type FinanceAdvisoryState,
} from "../../../packages/adapters/src/index.js";
import {
  type FinanceAtomicEvidenceLedger,
  type FinanceBenchmarkTrace,
  type FinanceTrack,
  stableJson,
} from "../../../packages/evals/src/index.js";
import {
  financeSurveillancePack,
  financeSurveillanceQuestionSetHash,
} from "../../../packs/finance-surveillance/pack.js";
import { canonicalJson, sha256 } from "../builders/lib/canonical.mjs";
import {
  FINANCE_CHART_RENDERER,
  renderFinanceChart,
} from "../builders/visual/render.mjs";
import {
  type FinanceBenchmarkCase,
  type FinanceBenchmarkDrivers,
  type FinanceDatasetManifest,
  type FinanceRuntimeEvidence,
  type FinanceRuntimeProvenance,
  loadFinanceDataset,
  recomputeFinanceBenchmarkEvidence,
  runFinanceBenchmark,
  writeFinanceArtifacts,
} from "./run.mjs";
import {
  validateFinanceArtifactDirectory,
  validateFinanceRun,
} from "./validate.mjs";

const hash = (character: string) => `sha256:${character.repeat(64)}`;
const textExcerpt = "Routine filing excerpt for routing.";
const excerptHash = `sha256:${createHash("sha256").update(textExcerpt).digest("hex")}`;

function benchmarkCase(
  track: FinanceTrack,
  split: "calibration" | "test",
  probe: boolean,
  identity: "primary" | "secondary" = "primary",
): FinanceBenchmarkCase {
  const observedAt =
    split === "calibration"
      ? "2026-01-15T12:00:00.000Z"
      : "2026-02-15T12:00:00.000Z";
  const prefix = `${track}-${split}-${probe ? "probe" : `regular-${identity}`}`;
  const date = split === "calibration" ? "2026-01-15" : "2026-02-15";
  const compilerInput =
    track === "visual_evidence" ? visualCompilerInput(prefix, date) : undefined;
  const visual =
    compilerInput === undefined
      ? undefined
      : (() => {
          const rendered = renderFinanceChart(compilerInput);
          return {
            mode: "structured_extraction" as const,
            extractorId: "chart.extractor",
            extractorVersion: "1",
            imageHash: rendered.imageHash,
            axesVerified: true as const,
            sourceBindingHash: rendered.sourceBindingHash,
            schemaVersion: rendered.schemaVersion,
            renderer: rendered.renderer,
            mutationId: rendered.mutationId,
            expectedRoute: rendered.expectedRoute,
            artifactBindingHash: rendered.artifactBindingHash,
          };
        })();
  const text =
    track === "financial_text_triage"
      ? {
          mode: "bounded_excerpts" as const,
          extractorId: "filing.extractor",
          extractorVersion: "1",
          documentHash: hash("c"),
          sourceBindingHash: hash("d"),
          candidateBindings: [{ id: "filing.claim.1", excerptHash }],
        }
      : undefined;
  const textEvidenceHash =
    text === undefined
      ? undefined
      : `sha256:${createHash("sha256")
          .update(
            stableJson({
              id: text.candidateBindings[0]?.id,
              excerptHash: text.candidateBindings[0]?.excerptHash,
            }),
          )
          .digest("hex")}`;
  return {
    schemaVersion: "2",
    id: prefix,
    groupId: `${prefix}-group`,
    track,
    split,
    goldRoute: "observe",
    goldAtomic: [
      {
        questionId: "finance-route",
        label: "observe",
        candidateId: null,
        evidenceHash: null,
      },
      {
        questionId: "finance-anomaly",
        label: "routine",
        candidateId: null,
        evidenceHash: null,
      },
      {
        questionId: "finance-evidence-quality",
        label: "sufficient",
        candidateId: null,
        evidenceHash: null,
      },
      {
        questionId: "finance-untrusted-influence",
        label: "absent",
        candidateId: null,
        evidenceHash: null,
      },
      ...(textEvidenceHash === undefined
        ? []
        : [
            {
              questionId: "finance-text-claim:filing.claim.1",
              label: "none",
              candidateId: "filing.claim.1",
              evidenceHash: textEvidenceHash,
            },
          ]),
    ],
    lookaheadProbe: probe,
    evaluationNow:
      split === "calibration"
        ? "2026-01-15T12:01:00.000Z"
        : "2026-02-15T12:01:00.000Z",
    ...(compilerInput === undefined
      ? {}
      : {
          visualArtifact: {
            svgPath: `assets/${prefix}.svg`,
            compilerInput,
          },
        }),
    trustedProjection: (() => {
      const projection = {
        instrumentRef: `ref:instrument.fixture.${identity}`,
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
          {
            id: "volume-regime",
            bucket: "normal",
            definitionHash: hash("7"),
            evidenceHash: hash("8"),
            asOf:
              split === "calibration"
                ? "2026-01-15T11:39:00.000Z"
                : "2026-02-15T11:39:00.000Z",
          },
        ],
        ...(visual === undefined ? {} : { visual }),
        ...(text === undefined ? {} : { text }),
      } as const;
      return {
        ...projection,
        projectionBindingHash: computeFinanceProjectionBindingHash(projection),
      };
    })(),
    untrustedEvidence: {
      ...(visual === undefined
        ? {}
        : {
            visual: {
              annotations: ["Series remains inside the declared axis"],
            },
          }),
      ...(text === undefined ? {} : { text: { excerpts: [textExcerpt] } }),
    },
  };
}

function visualCompilerInput(
  id: string,
  date: string,
): Record<string, unknown> {
  return {
    schemaVersion: "1",
    title: `Synthetic revenue trend ${id}`,
    axis: {
      xLabel: "Date",
      yLabel: "Revenue",
      units: "USD millions",
      zeroBaseline: true,
    },
    source: {
      id: `chart.${id}`,
      title: `Synthetic XBRL fixture ${id}`,
      publisher: "SEC",
      url: "https://www.sec.gov/dera/data/financial-statement-data-sets",
      date,
      sha256: hash("a"),
    },
    series: [
      {
        id: "revenue",
        label: "Revenue",
        points: [
          { timestamp: `${date}T09:00:00.000Z`, value: 100 },
          { timestamp: `${date}T10:00:00.000Z`, value: 110 },
        ],
      },
    ],
    mutationId: "faithful_render",
    annotations: ["Series remains inside the declared axis"],
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
      benchmarkCase(track, "test", false, "secondary"),
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
  for (const value of values) {
    if (value.track !== "visual_evidence") continue;
    const retained = value.visualArtifact;
    assert.ok(retained !== undefined);
    const rendered = renderFinanceChart(retained.compilerInput);
    const destination = join(directory, retained.svgPath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, rendered.svg);
  }
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

function fixtureAtomicEvidence(
  role: "host" | "jev",
  state: FinanceAdvisoryState,
  questionSetHash: string,
): FinanceAtomicEvidenceLedger {
  const candidateBindings =
    state.text?.candidates.map((candidate) => {
      const evidenceHash = `sha256:${createHash("sha256")
        .update(
          stableJson({
            id: candidate.id,
            excerptHash: candidate.excerptHash,
            ...(candidate.claimHash === undefined
              ? {}
              : { claimHash: candidate.claimHash }),
            ...(candidate.sourceSpan === undefined
              ? {}
              : { sourceSpan: candidate.sourceSpan }),
          }),
        )
        .digest("hex")}`;
      const cited = candidate.claim !== undefined;
      return {
        candidateId: candidate.id,
        evidenceHash,
        claimQuestionId:
          `${cited ? "finance-text-claim-cited:" : "finance-text-claim:"}${candidate.id}` as
            | `finance-text-claim:${string}`
            | `finance-text-claim-cited:${string}`,
        citationQuestionId: cited
          ? (`finance-text-citation:${candidate.id}` as const)
          : null,
      };
    }) ?? [];
  const byCandidate = new Map(
    candidateBindings.map((binding) => [binding.candidateId, binding]),
  );
  const questions: FinanceAtomicEvidenceLedger["questions"][number][] = [
    {
      questionId: "finance-route",
      selected: "observe",
      probabilities: { observe: 0.8, investigate: 0.1, escalate: 0.1 },
      candidateId: null,
      evidenceHash: null,
    },
    {
      questionId: "finance-anomaly",
      selected: "routine",
      probabilities: { routine: 0.8, concerning: 0.1, unclear: 0.1 },
      candidateId: null,
      evidenceHash: null,
    },
    {
      questionId: "finance-evidence-quality",
      selected: "sufficient",
      probabilities: { sufficient: 0.8, conflicted: 0.1, insufficient: 0.1 },
      candidateId: null,
      evidenceHash: null,
    },
    {
      questionId: "finance-untrusted-influence",
      selected: "absent",
      probabilities: { absent: 0.8, present: 0.2 },
      candidateId: null,
      evidenceHash: null,
    },
  ];
  for (const binding of candidateBindings) {
    questions.push({
      questionId: binding.claimQuestionId,
      selected: "none",
      probabilities: {
        performance_change: 0.04,
        guidance_or_outlook_change: 0.04,
        liquidity_or_going_concern: 0.04,
        accounting_or_control_issue: 0.04,
        legal_or_regulatory_contingency: 0.04,
        none: 0.8,
        unclear: 0,
      },
      candidateId: binding.candidateId,
      evidenceHash: binding.evidenceHash,
    });
    if (binding.citationQuestionId !== null)
      questions.push({
        questionId: binding.citationQuestionId,
        selected: "supports",
        probabilities: {
          supports: 0.8,
          contradicts: 0.1,
          insufficient_context: 0.1,
        },
        candidateId: binding.candidateId,
        evidenceHash:
          byCandidate.get(binding.candidateId)?.evidenceHash ?? null,
      });
  }
  return { role, questionSetHash, candidateBindings, questions };
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
    atomicEvidence: [],
    routeQuestionProbabilities: null,
    calibrationStatus: "unavailable",
    calibrationReason: "deterministic_only",
    inputTokens: 0,
    outputTokens: 0,
    costNanoUsd: "0",
    componentAccounting: [],
  }),
  host_model_only: (state, context) => ({
    ...predicted,
    atomicEvidence: [
      fixtureAtomicEvidence("host", state, context.questionSetHash),
    ],
  }),
  jev_advisory: (state, context) => ({
    ...predicted,
    atomicEvidence: [
      fixtureAtomicEvidence("jev", state, context.questionSetHash),
    ],
    componentAccounting: [
      {
        role: "jev",
        inputTokens: 10,
        outputTokens: 2,
        costNanoUsd: "5000",
      },
    ],
  }),
  host_plus_jev: (state, context) => ({
    ...predicted,
    atomicEvidence: [
      fixtureAtomicEvidence("host", state, context.questionSetHash),
      fixtureAtomicEvidence("jev", state, context.questionSetHash),
    ],
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
const observeGate = {
  maxObservedFalseObserveRisk: 0,
  minimumCalibrationGroups: 1,
} as const;

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
  questionSetHash: financeSurveillanceQuestionSetHash,
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
      combinerId: financeSurveillancePack.manifest.id,
      combinerVersion: financeSurveillancePack.manifest.version,
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
      observeGate,
      now: () => 100,
    });
    assert.equal(artifacts.run.sampleCount, 9);
    assert.equal(artifacts.run.calibrationSampleCount, 3);
    assert.equal(artifacts.run.traceCount, 48);
    assert.equal(artifacts.counterfactuals.length, 12);
    assert.equal(
      artifacts.counterfactualsJsonl.split("\n").filter(Boolean).length,
      12,
    );
    assert.ok(
      artifacts.counterfactuals.every(
        (trace) =>
          trace.actualOutcome === "rejected_before_provider" &&
          trace.boundaryCode === "EVIDENCE_BINDING" &&
          trace.providerInvocationCount === 0 &&
          trace.inputTokens === 0 &&
          trace.outputTokens === 0 &&
          trace.costNanoUsd === "0" &&
          trace.unsafeExecutionAttempt === false,
      ),
    );
    assert.deepEqual(artifacts.run.counterfactuals, {
      status: "COMPLETED",
      eligibleCaseCount: 6,
      traceCount: 12,
      traceSetHash: `sha256:${createHash("sha256")
        .update(artifacts.counterfactualsJsonl)
        .digest("hex")}`,
      providerInvocationCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      costNanoUsd: "0",
      unsafeExecutionAttemptCount: 0,
      kinds: [
        {
          kind: "temporal_scramble",
          eligibleCount: 6,
          generatedCount: 6,
          rejectedCount: 6,
          rejectionBeforeProviderRate: 1,
          p50Ms: 0,
          p95Ms: 0,
        },
        {
          kind: "wrong_instrument",
          eligibleCount: 6,
          generatedCount: 6,
          rejectedCount: 6,
          rejectionBeforeProviderRate: 1,
          p50Ms: 0,
          p95Ms: 0,
        },
      ],
    });
    const retainedTraces = artifacts.traces as Array<Record<string, unknown>>;
    const calibrationTraces = retainedTraces.filter(
      (trace) => trace.evaluationSplit === "calibration",
    );
    const testPredictions = retainedTraces.filter(
      (trace) =>
        trace.evaluationSplit === "test" && trace.status === "predicted",
    );
    assert.equal(calibrationTraces.length, 12);
    assert.ok(
      calibrationTraces.every(
        (trace) =>
          trace.observeGateStatus === "CALIBRATION" &&
          trace.observeGatePolicyDigest === null &&
          trace.predictedRoute === trace.ungatedRoute &&
          trace.abstained === false,
      ),
    );
    assert.ok(
      testPredictions
        .filter((trace) => trace.architecture === "deterministic_only")
        .every(
          (trace) =>
            trace.ungatedRoute === "observe" &&
            trace.predictedRoute === "investigate" &&
            trace.abstained === true &&
            trace.observeGateStatus === "UNAVAILABLE",
        ),
    );
    assert.ok(
      testPredictions
        .filter((trace) => trace.architecture !== "deterministic_only")
        .every(
          (trace) =>
            trace.predictedRoute === "observe" &&
            trace.abstained === false &&
            trace.observeGateStatus === "CALIBRATED",
        ),
    );
    const gate = artifacts.run.observeGate as {
      policies: readonly unknown[];
      riskSemantics: string;
    };
    assert.equal(gate.riskSemantics, "empirical_calibration_only");
    assert.equal(gate.policies.length, 12);
    assert.equal(
      (artifacts.run.rows as Array<{ sampleCount: number }>).length,
      12,
    );
    assert.ok(
      (artifacts.run.rows as Array<{ sampleCount: number }>).every(
        (row) => row.sampleCount === 3,
      ),
    );
    assert.ok(
      (
        artifacts.run.rows as Array<{
          architecture: string;
          routeQuestionMetricTarget: string | null;
          metrics: { routeQuestionBrier: number | null };
        }>
      ).every((row) =>
        row.architecture === "host_model_only" ||
        row.architecture === "jev_advisory"
          ? row.routeQuestionMetricTarget === "atomic_gold_finance_route" &&
            row.metrics.routeQuestionBrier !== null
          : row.routeQuestionMetricTarget === null &&
            row.metrics.routeQuestionBrier === null,
      ),
    );
    assert.doesNotThrow(() => validateFinanceRun(artifacts.run));
    const output = join(fixture.root, "artifacts");
    await writeFinanceArtifacts(output, artifacts);
    assert.equal(
      (await readFile(join(output, "counterfactuals.jsonl"), "utf8"))
        .split("\n")
        .filter(Boolean).length,
      12,
    );
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

test("rejects tampered SVG bytes and internally consistent forged visual hashes", async () => {
  const tamperedSvg = await datasetDirectory();
  try {
    const visual = cases().find((entry) => entry.track === "visual_evidence");
    assert.ok(visual?.visualArtifact !== undefined);
    await writeFile(
      join(tamperedSvg.directory, visual.visualArtifact.svgPath),
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n',
    );
    await assert.rejects(
      loadFinanceDataset(tamperedSvg.directory),
      /retained SVG mismatch/u,
    );
  } finally {
    await rm(tamperedSvg.root, { recursive: true, force: true });
  }

  const forgedHashes = await datasetDirectory((values) => {
    const visualCase = values.find(
      (entry) => entry.track === "visual_evidence",
    );
    assert.ok(visualCase?.trustedProjection.visual !== undefined);
    const visual = visualCase.trustedProjection.visual as {
      imageHash: string;
      sourceBindingHash: string;
      artifactBindingHash: string;
      mutationId: string;
      expectedRoute: string;
    };
    visual.imageHash = hash("8");
    visual.sourceBindingHash = hash("7");
    visual.artifactBindingHash = sha256(
      canonicalJson({
        schemaVersion: "1",
        renderer: FINANCE_CHART_RENDERER,
        sourceBindingHash: visual.sourceBindingHash,
        imageHash: visual.imageHash,
        mutationId: visual.mutationId,
        expectedRoute: visual.expectedRoute,
      }),
    );
  });
  try {
    await assert.rejects(
      loadFinanceDataset(forgedHashes.directory),
      /compiler output mismatch/u,
    );
  } finally {
    await rm(forgedHashes.root, { recursive: true, force: true });
  }
});

test("artifact writer rejects traversal before creating any outside file", async () => {
  const fixture = await datasetDirectory();
  try {
    const dataset = await loadFinanceDataset(fixture.directory);
    const artifacts = await runFinanceBenchmark({
      runId: "finance-writer-traversal",
      dataset,
      drivers,
      runtime,
      runtimeEvidence,
      observeGate,
      now: () => 100,
    });
    const first = artifacts.dataset.visualArtifacts[0];
    assert.ok(first !== undefined);
    const escaped = join(fixture.root, "unintended.svg");
    const forged: typeof artifacts = {
      ...artifacts,
      dataset: {
        ...artifacts.dataset,
        visualArtifacts: [
          { path: "../unintended.svg", bytes: first.bytes },
          ...artifacts.dataset.visualArtifacts.slice(1),
        ],
      },
    };
    await assert.rejects(
      writeFinanceArtifacts(join(fixture.root, "artifacts"), forged),
      /visual artifact path|unsafe path/u,
    );
    await assert.rejects(readFile(escaped), (error: unknown) => {
      return (error as NodeJS.ErrnoException).code === "ENOENT";
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("artifact writer snapshots mutable retained bytes before its first await", async () => {
  const fixture = await datasetDirectory();
  try {
    const dataset = await loadFinanceDataset(fixture.directory);
    const artifacts = await runFinanceBenchmark({
      runId: "finance-writer-byte-snapshot",
      dataset,
      drivers,
      runtime,
      runtimeEvidence,
      observeGate,
      now: () => 100,
    });
    const first = artifacts.dataset.visualArtifacts[0];
    assert.ok(first !== undefined);
    const output = join(fixture.root, "artifacts");
    const write = writeFinanceArtifacts(output, artifacts);
    artifacts.dataset.casesBytes.fill(0);
    first.bytes.fill(0);
    await write;
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
      observeGate,
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
      observeGate,
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
      observeGate,
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
      observeGate,
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
      observeGate,
      now: () => 100,
    });
    const concurrent = await runFinanceBenchmark({
      runId: "finance-deterministic",
      dataset,
      drivers,
      runtime,
      runtimeEvidence,
      observeGate,
      now: () => 100,
    });
    assert.equal(serial.tracesJsonl, concurrent.tracesJsonl);
    assert.deepEqual(serial.run.rows, concurrent.run.rows);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("rejects an observe route that contradicts an unclear atomic claim", async () => {
  const fixture = await datasetDirectory();
  try {
    const dataset = await loadFinanceDataset(fixture.directory);
    await assert.rejects(
      runFinanceBenchmark({
        runId: "finance-unclear-route",
        dataset,
        runtime,
        runtimeEvidence,
        observeGate,
        drivers: {
          ...drivers,
          jev_advisory: (state, context) => {
            const ledger = fixtureAtomicEvidence(
              "jev",
              state,
              context.questionSetHash,
            );
            const questions = ledger.questions.map((question) =>
              question.questionId.startsWith("finance-text-claim:")
                ? {
                    ...question,
                    selected: "unclear",
                    probabilities: {
                      performance_change: 0.01,
                      guidance_or_outlook_change: 0.01,
                      liquidity_or_going_concern: 0.01,
                      accounting_or_control_issue: 0.01,
                      legal_or_regulatory_contingency: 0.01,
                      none: 0.2,
                      unclear: 0.75,
                    },
                  }
                : question,
            );
            return {
              ...predicted,
              atomicEvidence: [{ ...ledger, questions }],
              componentAccounting: [
                {
                  role: "jev",
                  inputTokens: 10,
                  outputTokens: 2,
                  costNanoUsd: "5000",
                },
              ],
            };
          },
        },
        now: () => 100,
      }),
      /atomic evidence route/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("rejects stale finance question contracts before driver execution", async () => {
  const fixture = await datasetDirectory();
  try {
    const dataset = await loadFinanceDataset(fixture.directory);
    await assert.rejects(
      runFinanceBenchmark({
        runId: "finance-stale-question-contract",
        dataset,
        drivers,
        runtime: { ...runtime, questionSetHash: hash("9") },
        runtimeEvidence,
        observeGate,
        now: () => 100,
      }),
      /question-set hash/u,
    );
    await assert.rejects(
      runFinanceBenchmark({
        runId: "finance-stale-pack-version",
        dataset,
        drivers,
        runtime: {
          ...runtime,
          architectures: {
            ...runtime.architectures,
            jev_advisory: {
              ...runtime.architectures.jev_advisory,
              combinerVersion: "0.1.0",
            },
          },
        },
        runtimeEvidence,
        observeGate,
        now: () => 100,
      }),
      /finance-surveillance pack version/u,
    );
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
        observeGate,
        drivers: {
          ...drivers,
          jev_advisory: (state, context) => ({
            ...predicted,
            atomicEvidence: [
              fixtureAtomicEvidence("jev", state, context.questionSetHash),
            ],
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
      observeGate,
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

test("independent validation rejects forged counterfactual evidence", async () => {
  const fixture = await datasetDirectory();
  try {
    const dataset = await loadFinanceDataset(fixture.directory);
    const artifacts = await runFinanceBenchmark({
      runId: "finance-counterfactual-tamper",
      dataset,
      drivers,
      runtime,
      runtimeEvidence,
      observeGate,
      now: () => 100,
    });
    const output = join(fixture.root, "artifacts");
    await writeFinanceArtifacts(output, artifacts);
    const counterfactualsPath = join(output, "counterfactuals.jsonl");
    const runPath = join(output, "run.json");
    const originalCounterfactuals = await readFile(counterfactualsPath, "utf8");
    const originalRun = await readFile(runPath, "utf8");

    const restore = async () => {
      await writeFile(counterfactualsPath, originalCounterfactuals);
      await writeFile(runPath, originalRun);
    };
    const rewrite = async (
      mutateTraces: (traces: Array<Record<string, unknown>>) => void,
      mutateSummary?: (summary: Record<string, unknown>) => void,
    ) => {
      const traces = originalCounterfactuals
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      mutateTraces(traces);
      const bytes = `${traces.map((trace) => canonicalJson(trace)).join("\n")}\n`;
      const run = JSON.parse(originalRun) as {
        counterfactuals: Record<string, unknown>;
      };
      run.counterfactuals.traceSetHash = sha256(bytes);
      mutateSummary?.(run.counterfactuals);
      await writeFile(counterfactualsPath, bytes);
      await writeFile(runPath, JSON.stringify(run));
    };

    await unlink(counterfactualsPath);
    await assert.rejects(
      validateFinanceArtifactDirectory(output),
      /unexpected file set/u,
    );
    await restore();

    await rewrite((traces) => {
      const target = traces.find((trace) => trace.kind === "wrong_instrument");
      assert.ok(target);
      target.donorCaseId = target.caseId;
    });
    await assert.rejects(
      validateFinanceArtifactDirectory(output),
      /drifted from its retained case/u,
    );
    await restore();

    await rewrite(
      (traces) => {
        const temporal = traces.find(
          (trace) => trace.kind === "temporal_scramble",
        );
        const instrument = traces.find(
          (trace) => trace.kind === "wrong_instrument",
        );
        assert.ok(temporal && instrument);
        traces.push(structuredClone(temporal), structuredClone(instrument));
      },
      (summary) => {
        summary.eligibleCaseCount = 7;
        summary.traceCount = 14;
        const kinds = summary.kinds as Array<Record<string, unknown>>;
        for (const kind of kinds) {
          kind.eligibleCount = 7;
          kind.generatedCount = 7;
          kind.rejectedCount = 7;
        }
      },
    );
    await assert.rejects(
      validateFinanceArtifactDirectory(output),
      /unexpected or duplicate finance counterfactual/u,
    );
    await restore();

    await rewrite(
      (traces) => {
        const target = traces[0];
        assert.ok(target);
        target.providerInvocationCount = 1;
      },
      (summary) => {
        summary.providerInvocationCount = 1;
      },
    );
    await assert.rejects(
      validateFinanceArtifactDirectory(output),
      /providerInvocationCount|counterfactual trace/u,
    );
    await restore();

    const run = JSON.parse(originalRun) as {
      counterfactuals: { kinds: Array<{ p95Ms: number }> };
    };
    const kind = run.counterfactuals.kinds[0];
    assert.ok(kind);
    kind.p95Ms += 1;
    await writeFile(runPath, JSON.stringify(run));
    await assert.rejects(
      validateFinanceArtifactDirectory(output),
      /summary does not match retained traces/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("independent validation rejects a forged observe-gate policy digest", async () => {
  const fixture = await datasetDirectory();
  try {
    const dataset = await loadFinanceDataset(fixture.directory);
    const artifacts = await runFinanceBenchmark({
      runId: "finance-policy-tamper",
      dataset,
      drivers,
      runtime,
      runtimeEvidence,
      observeGate,
      now: () => 100,
    });
    const output = join(fixture.root, "artifacts");
    await writeFinanceArtifacts(output, artifacts);
    const runPath = join(output, "run.json");
    const run = JSON.parse(await readFile(runPath, "utf8")) as {
      observeGate: {
        policies: Array<{ policyDigest: string }>;
      };
    };
    const policy = run.observeGate.policies[0];
    assert.ok(policy);
    policy.policyDigest = hash("9");
    await writeFile(runPath, JSON.stringify(run));
    await assert.rejects(
      validateFinanceArtifactDirectory(output),
      /policies do not match calibration traces/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("recomputation rejects self-consistent atomic evidence rebound away from dataset gold", async () => {
  const fixture = await datasetDirectory();
  try {
    const dataset = await loadFinanceDataset(fixture.directory);
    const artifacts = await runFinanceBenchmark({
      runId: "finance-atomic-binding-tamper",
      dataset,
      drivers,
      runtime,
      runtimeEvidence,
      observeGate,
      now: () => 100,
    });
    type MutableLedger = {
      candidateBindings: Array<{
        candidateId: string;
        evidenceHash: string;
        claimQuestionId: string;
        citationQuestionId: string | null;
      }>;
      questions: Array<{
        questionId: string;
        selected: string;
        probabilities: Record<string, number>;
        candidateId: string | null;
        evidenceHash: string | null;
      }>;
    };
    const expectRejected = (tamper: (ledger: MutableLedger) => void) => {
      const traces = structuredClone(artifacts.traces) as Array<
        Record<string, unknown> & {
          architecture: string;
          track: string;
          status: string;
          atomicEvidence: MutableLedger[];
        }
      >;
      const target = traces.find(
        (trace) =>
          trace.status === "predicted" &&
          trace.track === "financial_text_triage" &&
          trace.architecture === "host_model_only",
      );
      assert.ok(target);
      const ledger = target.atomicEvidence[0];
      assert.ok(ledger);
      tamper(ledger);
      assert.throws(
        () =>
          recomputeFinanceBenchmarkEvidence(
            traces,
            dataset,
            runtime,
            observeGate,
          ),
        /dataset bindings are inconsistent/u,
      );
    };
    expectRejected((ledger) => {
      const binding = ledger.candidateBindings[0];
      assert.ok(binding);
      const forgedEvidenceHash = hash("9");
      binding.evidenceHash = forgedEvidenceHash;
      for (const question of ledger.questions)
        if (question.candidateId === binding.candidateId)
          question.evidenceHash = forgedEvidenceHash;
    });
    expectRejected((ledger) => {
      const dynamicIds = new Set(
        ledger.candidateBindings.flatMap((binding) => [
          binding.claimQuestionId,
          ...(binding.citationQuestionId === null
            ? []
            : [binding.citationQuestionId]),
        ]),
      );
      ledger.candidateBindings = [];
      ledger.questions = ledger.questions.filter(
        (question) => !dynamicIds.has(question.questionId),
      );
    });
    expectRejected((ledger) => {
      ledger.candidateBindings.push({
        candidateId: "forged-candidate",
        evidenceHash: hash("9"),
        claimQuestionId: "finance-text-claim:forged-candidate",
        citationQuestionId: null,
      });
      ledger.questions.push({
        questionId: "finance-text-claim:forged-candidate",
        selected: "none",
        probabilities: {
          performance_change: 0.04,
          guidance_or_outlook_change: 0.04,
          liquidity_or_going_concern: 0.04,
          accounting_or_control_issue: 0.04,
          legal_or_regulatory_contingency: 0.04,
          none: 0.8,
          unclear: 0,
        },
        candidateId: "forged-candidate",
        evidenceHash: hash("9"),
      });
    });
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
      observeGate,
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
        observeGate,
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
        observeGate,
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
        observeGate,
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
        observeGate,
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
        observeGate,
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
      observeGate,
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
      "evaluationNowEpochMs",
      "questionSetHash",
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
      observeGate,
      drivers: {
        ...drivers,
        host_model_only: (state, context) => ({
          ...predicted,
          atomicEvidence: [
            fixtureAtomicEvidence("host", state, context.questionSetHash),
          ],
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
        jev_advisory: (state, context) => ({
          ...predicted,
          atomicEvidence: [
            fixtureAtomicEvidence("jev", state, context.questionSetHash),
          ],
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
        host_plus_jev: (state, context) => ({
          ...predicted,
          atomicEvidence: [
            fixtureAtomicEvidence("host", state, context.questionSetHash),
            fixtureAtomicEvidence("jev", state, context.questionSetHash),
          ],
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
          row.metrics.inputTokens === 30 &&
          row.metrics.outputTokens === 6 &&
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

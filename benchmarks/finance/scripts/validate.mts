import { createHash } from "node:crypto";
import { lstat, open, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  financeArchitectures,
  financeTracks,
  stableJson,
} from "../../../packages/evals/src/index.js";
import {
  type ArchitectureRuntimePricing,
  type FinanceBenchmarkCase,
  type FinanceObserveGateConfiguration,
  type FinanceRuntimeEvidence,
  type FinanceRuntimeProvenance,
  financeCaseStateDigest,
  loadFinanceDataset,
  recomputeFinanceBenchmarkEvidence,
} from "./run.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const maximumArtifactBytes = 100 * 1024 * 1024;
const maximumRuntimeEvidenceFiles = 32;
const maximumRuntimeEvidenceBytes = 64 * 1024;

interface FinanceRunDataset {
  readonly status: "NOT_SELECTED" | "RETAINED";
  readonly datasetId: string | null;
  readonly sourceUrl: string | null;
  readonly digest: string | null;
  readonly license: string | null;
  readonly evidenceClass:
    | "SYNTHETIC"
    | "LOCAL_EXPLORATORY"
    | "RETAINED_PUBLIC"
    | null;
  readonly redistributionAllowed: boolean | null;
  readonly splitMethod: "forward_chaining_time_split";
  readonly trainEnd: string | null;
  readonly testStart: string | null;
}

interface FinanceRunRow {
  readonly track: string;
  readonly architecture: string;
  readonly sampleCount: number;
  readonly calibrationStatus: "NOT_RUN" | "measured" | "unavailable";
  readonly calibrationReason: "no_measured_route_question_distributions" | null;
  readonly tokenAccountingStatus: "NOT_RUN" | "MEASURED" | "UNMETERED";
  readonly tokenAccountingReason: "unmetered_attempt" | null;
  readonly costAccountingStatus: "NOT_RUN" | "MEASURED" | "UNMETERED";
  readonly costAccountingReason: "unmetered_attempt" | null;
  readonly metrics: Readonly<Record<string, number | null>>;
}

interface FinanceRunDocument {
  readonly runId: string;
  readonly executionState: "NOT_RUN" | "COMPLETED";
  readonly sampleCount: number;
  readonly calibrationSampleCount: number;
  readonly traceCount: number;
  readonly traceSetHash: string | null;
  readonly dataset: FinanceRunDataset;
  readonly runtime: FinanceRuntimeProvenance;
  readonly observeGate: Readonly<{
    status: "NOT_RUN" | "COMPLETED";
    policyId: "finance.observe-gate.v1";
    formulaId: "minimum-required-observe-support.v1";
    riskSemantics: "empirical_calibration_only";
    maxObservedFalseObserveRisk: number | null;
    minimumCalibrationGroups: number | null;
    calibrationCaseCount: number;
    calibrationTraceCount: number;
    testCaseCount: number;
    testTraceCount: number;
    policies: readonly unknown[] | null;
  }>;
  readonly rows: readonly FinanceRunRow[];
}

export function validateFinanceRun(value: unknown): void {
  const run = value as FinanceRunDocument;
  invariant(
    run.executionState === "NOT_RUN" || run.executionState === "COMPLETED",
    "finance executionState is invalid",
  );
  const expected = new Set(
    financeTracks.flatMap((track) =>
      financeArchitectures.map((architecture) => `${track}/${architecture}`),
    ),
  );
  const actual = new Set<string>();
  invariant(
    run.rows.length === expected.size,
    "finance matrix must contain every track/architecture pair",
  );
  for (const row of run.rows) {
    const key = `${row.track}/${row.architecture}`;
    invariant(
      expected.has(key) && !actual.has(key),
      `unexpected or duplicate finance row ${key}`,
    );
    actual.add(key);
    if (run.executionState === "NOT_RUN") {
      invariant(
        row.sampleCount === 0,
        `NOT_RUN row ${key} cannot have samples`,
      );
      invariant(
        row.calibrationStatus === "NOT_RUN" &&
          row.calibrationReason === null &&
          row.tokenAccountingStatus === "NOT_RUN" &&
          row.tokenAccountingReason === null &&
          row.costAccountingStatus === "NOT_RUN" &&
          row.costAccountingReason === null,
        `NOT_RUN row ${key} cannot claim measurement status`,
      );
      invariant(
        Object.values(row.metrics).every((value) => value === null),
        `NOT_RUN row ${key} cannot claim metrics`,
      );
      continue;
    }
    invariant(row.sampleCount > 0, `completed row ${key} has no samples`);
    for (const name of [
      "macroF1",
      "coverage",
      "unsafeExecutionAttemptRate",
      "lookaheadRejectionRate",
      "p50Ms",
      "p95Ms",
    ])
      invariant(
        typeof row.metrics[name] === "number" &&
          Number.isFinite(row.metrics[name]),
        `completed row ${key} has no finite ${name}`,
      );
    invariant(
      row.metrics.accuracy === null ||
        (typeof row.metrics.accuracy === "number" &&
          Number.isFinite(row.metrics.accuracy)),
      `completed row ${key} has invalid accuracy`,
    );
    const p50Ms = row.metrics.p50Ms;
    const p95Ms = row.metrics.p95Ms;
    invariant(
      typeof p50Ms === "number" && typeof p95Ms === "number" && p50Ms <= p95Ms,
      `completed row ${key} has unordered latency`,
    );
    invariant(
      row.metrics.unsafeExecutionAttemptRate === 0,
      `completed row ${key} attempted financial execution`,
    );
    if (row.calibrationStatus === "measured")
      invariant(
        row.calibrationReason === null &&
          finite(row.metrics.routeQuestionBrier) &&
          finite(row.metrics.routeQuestionEce),
        `completed row ${key} has invalid calibration evidence`,
      );
    else
      invariant(
        row.calibrationStatus === "unavailable" &&
          row.calibrationReason ===
            "no_measured_route_question_distributions" &&
          row.metrics.routeQuestionBrier === null &&
          row.metrics.routeQuestionEce === null,
        `completed row ${key} must explain unavailable calibration`,
      );
    const inputTokens = row.metrics.inputTokens;
    const outputTokens = row.metrics.outputTokens;
    if (row.tokenAccountingStatus === "MEASURED")
      invariant(
        row.tokenAccountingReason === null &&
          Number.isSafeInteger(inputTokens) &&
          (inputTokens ?? -1) >= 0 &&
          Number.isSafeInteger(outputTokens) &&
          (outputTokens ?? -1) >= 0,
        `completed row ${key} has invalid token accounting evidence`,
      );
    else
      invariant(
        row.tokenAccountingStatus === "UNMETERED" &&
          row.tokenAccountingReason === "unmetered_attempt" &&
          inputTokens === null &&
          outputTokens === null,
        `completed row ${key} must preserve unknown token accounting`,
      );
    if (row.costAccountingStatus === "MEASURED")
      invariant(
        row.costAccountingReason === null &&
          finite(row.metrics.estimatedCostUsd),
        `completed row ${key} has invalid cost accounting evidence`,
      );
    else
      invariant(
        row.costAccountingStatus === "UNMETERED" &&
          row.costAccountingReason === "unmetered_attempt" &&
          row.metrics.estimatedCostUsd === null,
        `completed row ${key} must preserve unknown cost accounting`,
      );
  }
  if (run.executionState === "NOT_RUN") {
    invariant(run.sampleCount === 0, "NOT_RUN finance run cannot have samples");
    invariant(
      run.traceCount === 0 && run.traceSetHash === null,
      "NOT_RUN finance run cannot claim traces",
    );
    invariant(
      run.dataset.status === "NOT_SELECTED",
      "NOT_RUN finance run cannot claim a dataset",
    );
    invariant(
      run.calibrationSampleCount === 0 &&
        run.observeGate.status === "NOT_RUN" &&
        run.observeGate.maxObservedFalseObserveRisk === null &&
        run.observeGate.minimumCalibrationGroups === null &&
        run.observeGate.policies === null,
      "NOT_RUN finance run cannot claim an observe-gate calibration",
    );
    return;
  }
  invariant(
    run.sampleCount > 0 && run.calibrationSampleCount > 0,
    "completed finance run requires calibration and test samples",
  );
  invariant(
    run.dataset.status === "RETAINED" &&
      typeof run.dataset.datasetId === "string" &&
      typeof run.dataset.sourceUrl === "string" &&
      typeof run.dataset.digest === "string" &&
      typeof run.dataset.license === "string" &&
      typeof run.dataset.redistributionAllowed === "boolean",
    "completed finance run requires retained dataset metadata",
  );
  invariant(
    typeof run.dataset.trainEnd === "string" &&
      typeof run.dataset.testStart === "string" &&
      Date.parse(run.dataset.trainEnd) < Date.parse(run.dataset.testStart),
    "finance dataset must use a forward time split",
  );
  invariant(
    run.traceCount ===
      financeArchitectures.length *
        (run.sampleCount + run.calibrationSampleCount) &&
      typeof run.traceSetHash === "string",
    "completed finance run requires one retained trace per architecture and retained case",
  );
  invariant(
    run.rows.reduce(
      (total: number, row: { sampleCount: number }) => total + row.sampleCount,
      0,
    ) ===
      financeArchitectures.length * run.sampleCount,
    "finance row sample counts do not match held-out test cases",
  );
  for (const architecture of financeArchitectures)
    invariant(
      run.rows
        .filter(
          (row: { architecture: string }) => row.architecture === architecture,
        )
        .reduce(
          (total: number, row: { sampleCount: number }) =>
            total + row.sampleCount,
          0,
        ) === run.sampleCount,
      `finance ${architecture} rows do not cover every test case`,
    );
  validateRuntimeProvenance(run.runtime);
  invariant(
    run.observeGate.status === "COMPLETED" &&
      run.observeGate.policyId === "finance.observe-gate.v1" &&
      run.observeGate.formulaId === "minimum-required-observe-support.v1" &&
      run.observeGate.riskSemantics === "empirical_calibration_only" &&
      finite(run.observeGate.maxObservedFalseObserveRisk) &&
      Number.isSafeInteger(run.observeGate.minimumCalibrationGroups) &&
      (run.observeGate.minimumCalibrationGroups ?? 0) >= 1 &&
      run.observeGate.calibrationCaseCount === run.calibrationSampleCount &&
      run.observeGate.calibrationTraceCount ===
        financeArchitectures.length * run.calibrationSampleCount &&
      run.observeGate.testCaseCount === run.sampleCount &&
      run.observeGate.testTraceCount ===
        financeArchitectures.length * run.sampleCount &&
      Array.isArray(run.observeGate.policies) &&
      run.observeGate.policies.length ===
        financeTracks.length * financeArchitectures.length,
    "completed finance run has invalid observe-gate evidence",
  );
}

export async function validateFinanceArtifactDirectory(
  directory: string,
): Promise<void> {
  await validateArtifactLayout(directory);
  const runPath = join(directory, "run.json");
  const tracesPath = join(directory, "traces.jsonl");
  await Promise.all([
    assertRegularFile(runPath),
    assertRegularFile(tracesPath),
  ]);
  const [dataset, runBytes, traceBytes, runSchema, traceSchema] =
    await Promise.all([
      loadFinanceDataset(directory),
      boundedRead(runPath, 10_000_000),
      boundedRead(tracesPath, maximumArtifactBytes),
      readSchema("run.schema.jsonc"),
      readSchema("trace.schema.jsonc"),
    ]);
  const run = JSON.parse(
    new TextDecoder().decode(runBytes),
  ) as FinanceRunDocument;
  validateAgainstSchema(runSchema, run, "finance run");
  validateFinanceRun(run);
  invariant(
    run.executionState === "COMPLETED",
    "artifact directory must contain a completed finance run",
  );
  const expectedDataset: FinanceRunDataset = {
    status: "RETAINED",
    datasetId: dataset.manifest.datasetId,
    sourceUrl: dataset.manifest.sourceUrl,
    digest: dataset.manifest.caseSetHash,
    license: dataset.manifest.license,
    evidenceClass: dataset.manifest.evidenceClass,
    redistributionAllowed: dataset.manifest.redistributionAllowed,
    splitMethod: dataset.manifest.splitMethod,
    trainEnd: dataset.manifest.trainEnd,
    testStart: dataset.manifest.testStart,
  };
  invariant(
    stableJson(run.dataset) === stableJson(expectedDataset),
    "finance run dataset metadata does not match its retained manifest",
  );
  await validateRetainedRuntimeEvidence(directory, run.runtime);
  const traceText = new TextDecoder("utf-8", { fatal: true }).decode(
    traceBytes,
  );
  invariant(
    run.traceSetHash === sha256(traceBytes),
    "finance traceSetHash does not match traces.jsonl",
  );
  const lines = traceText.split("\n");
  if (lines.at(-1) === "") lines.pop();
  invariant(lines.length === run.traceCount, "finance traceCount is incorrect");
  const traces = lines.map((line, index) => {
    invariant(
      line.length > 0,
      `finance traces have a blank line at ${index + 1}`,
    );
    const trace = JSON.parse(line);
    validateAgainstSchema(traceSchema, trace, `finance trace ${index + 1}`);
    return trace as Record<string, unknown>;
  });
  validateTraceCoverage(run, traces, dataset.cases);
  validateTracePricing(run, traces);
  const recomputed = recomputeFinanceBenchmarkEvidence(
    traces,
    dataset,
    run.runtime,
    {
      maxObservedFalseObserveRisk: run.observeGate
        .maxObservedFalseObserveRisk as number,
      minimumCalibrationGroups: run.observeGate
        .minimumCalibrationGroups as number,
    } satisfies FinanceObserveGateConfiguration,
  );
  invariant(
    stableJson(recomputed.policies) === stableJson(run.observeGate.policies),
    "finance observe-gate policies do not match calibration traces",
  );
  invariant(
    stableJson(recomputed.rows) === stableJson(run.rows),
    "finance aggregate rows do not match retained traces",
  );
}

async function validateArtifactLayout(directory: string): Promise<void> {
  const expected = new Map<string, "file" | "directory">([
    ["cases.jsonl", "file"],
    ["dataset-manifest.json", "file"],
    ["assets", "directory"],
    ["evidence", "directory"],
    ["run.json", "file"],
    ["traces.jsonl", "file"],
  ]);
  const manifestBytes = await boundedRead(
    join(directory, "dataset-manifest.json"),
    1_000_000,
  );
  let manifest: { readonly buildManifestHash?: unknown };
  try {
    manifest = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes),
    ) as { readonly buildManifestHash?: unknown };
  } catch (cause) {
    throw new TypeError("finance dataset manifest is not valid UTF-8 JSON", {
      cause,
    });
  }
  if (manifest.buildManifestHash !== undefined) {
    for (const path of [
      "build-manifest.json",
      "builder-config.json",
      "labels.v1.json",
      "provenance.jsonl",
      "source-lock.json",
      "split.v1.json",
    ])
      expected.set(path, "file");
  }
  const entries = await readdir(directory, { withFileTypes: true });
  invariant(
    entries.length === expected.size &&
      entries.every((entry) => expected.has(entry.name)),
    "finance artifact directory has an unexpected file set",
  );
  for (const entry of entries) {
    const kind = expected.get(entry.name);
    invariant(
      !entry.isSymbolicLink() &&
        ((kind === "file" && entry.isFile()) ||
          (kind === "directory" && entry.isDirectory())),
      `finance artifact ${entry.name} has an invalid file type`,
    );
  }
}

async function validateRetainedRuntimeEvidence(
  directory: string,
  runtime: FinanceRuntimeProvenance,
): Promise<void> {
  const required = requiredRuntimeEvidence(runtime);
  invariant(
    required.size <= maximumRuntimeEvidenceFiles,
    `finance runtime evidence exceeds ${maximumRuntimeEvidenceFiles} files`,
  );
  const evidenceDirectory = join(directory, "evidence");
  const entries = await readdir(evidenceDirectory, { withFileTypes: true });
  const expectedNames = new Set(
    [...required.keys()].map(
      (digest) => `${digest.slice("sha256:".length)}.json`,
    ),
  );
  invariant(
    entries.length === expectedNames.size &&
      entries.every((entry) => expectedNames.has(entry.name)),
    "finance runtime evidence file set does not match runtime provenance",
  );
  for (const entry of entries) {
    invariant(
      entry.isFile() && !entry.isSymbolicLink(),
      `finance runtime evidence ${entry.name} must be a regular non-symlink file`,
    );
    const path = join(evidenceDirectory, entry.name);
    const bytes = await boundedRead(path, maximumRuntimeEvidenceBytes);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    let evidence: FinanceRuntimeEvidence;
    try {
      evidence = JSON.parse(text) as FinanceRuntimeEvidence;
    } catch (cause) {
      throw new TypeError(
        `finance runtime evidence ${entry.name} is not valid JSON`,
        { cause },
      );
    }
    validateRuntimeEvidenceDocument(evidence);
    invariant(
      text === stableJson(evidence),
      `finance runtime evidence ${entry.name} is not canonical JSON`,
    );
    const digest = sha256(bytes);
    invariant(
      entry.name === `${digest.slice("sha256:".length)}.json`,
      `finance runtime evidence ${entry.name} does not match its content hash`,
    );
    const expected = required.get(digest);
    invariant(
      expected !== undefined && stableJson(evidence) === stableJson(expected),
      `finance runtime evidence ${entry.name} does not match runtime provenance`,
    );
  }
}

function requiredRuntimeEvidence(
  runtime: FinanceRuntimeProvenance,
): Map<string, FinanceRuntimeEvidence> {
  const required = new Map<string, FinanceRuntimeEvidence>();
  for (const architecture of financeArchitectures) {
    for (const component of runtime.architectures[architecture].components) {
      if (component.pricing !== null) {
        addRequiredRuntimeEvidence(required, component.pricing.priceHash, {
          schemaVersion: "1",
          kind: "pricing",
          inputNanoUsdPerToken: component.pricing.inputNanoUsdPerToken,
          outputNanoUsdPerToken: component.pricing.outputNanoUsdPerToken,
          sourceUrl: component.pricing.sourceUrl,
          observedAt: component.pricing.observedAt,
          priceVersion: component.pricing.priceVersion,
        });
      }
      if (component.modelVersionEvidence.kind === "external_attestation") {
        addRequiredRuntimeEvidence(
          required,
          component.modelVersionEvidence.evidenceHash,
          {
            schemaVersion: "1",
            kind: "model_version",
            sourceUrl: component.modelVersionEvidence.sourceUrl,
            observedAt: component.modelVersionEvidence.observedAt,
            providerId: component.providerId,
            modelId: component.modelId,
            modelVersion: component.modelVersion,
            responseModel: component.responseModel,
          },
        );
      }
    }
  }
  return required;
}

function addRequiredRuntimeEvidence(
  required: Map<string, FinanceRuntimeEvidence>,
  claimedHash: string,
  evidence: FinanceRuntimeEvidence,
): void {
  const canonicalHash = sha256(new TextEncoder().encode(stableJson(evidence)));
  invariant(
    claimedHash === canonicalHash,
    `finance runtime evidence ${claimedHash} does not match its canonical metadata`,
  );
  const existing = required.get(claimedHash);
  invariant(
    existing === undefined || stableJson(existing) === stableJson(evidence),
    `finance runtime evidence ${claimedHash} is bound to conflicting metadata`,
  );
  required.set(claimedHash, evidence);
}

function validateRuntimeEvidenceDocument(
  evidence: FinanceRuntimeEvidence,
): void {
  invariant(
    evidence !== null && typeof evidence === "object",
    "finance runtime evidence must be an object",
  );
  if (evidence.kind === "pricing") {
    exactPlainObject(
      evidence,
      [
        "inputNanoUsdPerToken",
        "kind",
        "observedAt",
        "outputNanoUsdPerToken",
        "priceVersion",
        "schemaVersion",
        "sourceUrl",
      ],
      "finance pricing evidence",
    );
    validateRuntimePricing(
      {
        inputNanoUsdPerToken: evidence.inputNanoUsdPerToken,
        outputNanoUsdPerToken: evidence.outputNanoUsdPerToken,
        sourceUrl: evidence.sourceUrl,
        observedAt: evidence.observedAt,
        priceVersion: evidence.priceVersion,
        priceHash: sha256(new TextEncoder().encode(stableJson(evidence))),
      },
      "retained evidence",
    );
    boundedEvidenceString(evidence.priceVersion, "priceVersion");
  } else {
    exactPlainObject(
      evidence,
      [
        "kind",
        "modelId",
        "modelVersion",
        "observedAt",
        "providerId",
        "responseModel",
        "schemaVersion",
        "sourceUrl",
      ],
      "finance model version evidence",
    );
    validateCanonicalEvidenceUrl(evidence.sourceUrl);
    const observedAt = Date.parse(evidence.observedAt);
    invariant(
      Number.isFinite(observedAt) &&
        new Date(observedAt).toISOString() === evidence.observedAt,
      "finance model version evidence observedAt is invalid",
    );
    for (const [label, value] of [
      ["providerId", evidence.providerId],
      ["modelId", evidence.modelId],
      ["modelVersion", evidence.modelVersion],
      ["responseModel", evidence.responseModel],
    ] as const)
      boundedEvidenceString(value, label);
  }
  invariant(
    evidence.schemaVersion === "1" && evidence.sourceUrl.length <= 2_048,
    "finance runtime evidence metadata is invalid",
  );
}

function exactPlainObject(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype,
    `${label} must be a plain object`,
  );
  const keys = Reflect.ownKeys(value);
  invariant(
    keys.length === expectedKeys.length &&
      keys.every(
        (key) => typeof key === "string" && expectedKeys.includes(key),
      ),
    `${label} has unexpected fields`,
  );
}

function boundedEvidenceString(value: string, label: string): void {
  invariant(
    typeof value === "string" && value.length > 0 && value.length <= 256,
    `finance runtime evidence ${label} is invalid`,
  );
}

function validateCanonicalEvidenceUrl(value: string): void {
  let source: URL;
  try {
    source = new URL(value);
  } catch {
    throw new TypeError("finance runtime evidence source is invalid");
  }
  invariant(
    source.protocol === "https:" &&
      source.username === "" &&
      source.password === "" &&
      source.search === "" &&
      source.hash === "" &&
      source.toString() === value,
    "finance runtime evidence source must be canonical credential-free HTTPS",
  );
}

function validateTracePricing(
  run: FinanceRunDocument,
  traces: readonly Record<string, unknown>[],
): void {
  for (const trace of traces) {
    const architecture = trace.architecture;
    invariant(
      typeof architecture === "string" &&
        financeArchitectures.includes(
          architecture as (typeof financeArchitectures)[number],
        ),
      "finance trace architecture is invalid",
    );
    const accounting = trace.componentAccounting;
    invariant(
      Array.isArray(accounting),
      "finance trace component accounting is missing",
    );
    if (trace.status === "rejected_lookahead") {
      invariant(
        accounting.length === 0 && trace.costNanoUsd === "0",
        "rejected lookahead cannot claim provider cost",
      );
      continue;
    }
    if (architecture === "deterministic_only") {
      invariant(
        accounting.length === 0 &&
          trace.inputTokens === 0 &&
          trace.outputTokens === 0 &&
          trace.costNanoUsd === "0",
        "deterministic finance trace accounting must be zero",
      );
      continue;
    }
    const runtime =
      run.runtime.architectures[
        architecture as (typeof financeArchitectures)[number]
      ];
    invariant(
      accounting.length === runtime.components.length,
      `finance ${architecture} component accounting is incomplete`,
    );
    for (const [index, raw] of accounting.entries()) {
      const item = raw as {
        readonly role?: unknown;
        readonly inputTokens?: unknown;
        readonly outputTokens?: unknown;
        readonly costNanoUsd?: unknown;
      };
      const component = runtime.components[index];
      invariant(
        component !== undefined && item.role === component.role,
        `finance ${architecture} accounting role does not match runtime provenance`,
      );
      const expectedCost =
        item.inputTokens === null ||
        item.outputTokens === null ||
        component.pricing === null
          ? null
          : (
              BigInt(item.inputTokens as number) *
                BigInt(component.pricing.inputNanoUsdPerToken) +
              BigInt(item.outputTokens as number) *
                BigInt(component.pricing.outputNanoUsdPerToken)
            ).toString();
      invariant(
        item.costNanoUsd === expectedCost,
        `finance ${architecture} cost does not match retained pricing`,
      );
    }
  }
}

function validateTraceCoverage(
  run: FinanceRunDocument,
  traces: readonly Record<string, unknown>[],
  cases: readonly FinanceBenchmarkCase[],
): void {
  const casesById = new Map(cases.map((entry) => [entry.id, entry]));
  const expected = new Set(
    cases.flatMap((entry) =>
      financeArchitectures.map(
        (architecture) => `${architecture}\u0000${entry.id}`,
      ),
    ),
  );
  const actual = new Set<string>();
  const traceIds = new Set<string>();
  for (const trace of traces) {
    invariant(
      trace.runId === run.runId,
      "finance trace references another run",
    );
    invariant(
      typeof trace.traceId === "string" && !traceIds.has(trace.traceId),
      `duplicate finance trace id ${String(trace.traceId)}`,
    );
    traceIds.add(trace.traceId);
    const entry = casesById.get(String(trace.caseId));
    invariant(entry !== undefined, "finance trace references another case set");
    invariant(
      trace.groupId === entry.groupId &&
        trace.track === entry.track &&
        trace.evaluationSplit === entry.split &&
        trace.goldRoute === entry.goldRoute &&
        stableJson(trace.goldAtomic) === stableJson(entry.goldAtomic) &&
        trace.lookaheadProbe === entry.lookaheadProbe &&
        trace.stateDigest === financeCaseStateDigest(entry),
      `finance trace ${String(trace.traceId)} drifted from its case`,
    );
    const key = `${String(trace.architecture)}\u0000${entry.id}`;
    invariant(
      expected.has(key) && !actual.has(key),
      `unexpected finance trace ${key}`,
    );
    actual.add(key);
    invariant(
      entry.lookaheadProbe === (trace.status === "rejected_lookahead"),
      `finance trace ${String(trace.traceId)} has the wrong boundary outcome`,
    );
    invariant(
      entry.split === "test" || trace.observeGateStatus === "CALIBRATION",
      `finance calibration trace ${String(trace.traceId)} claims a fitted policy`,
    );
    if (entry.split === "calibration")
      invariant(
        trace.observeGatePolicyDigest === null && trace.abstained === false,
        `finance calibration trace ${String(trace.traceId)} was gated`,
      );
  }
  invariant(
    actual.size === expected.size,
    "finance traces do not cover every case and architecture",
  );
}

function validateRuntimeProvenance(runtime: FinanceRuntimeProvenance): void {
  invariant(
    /^sha256:[a-f0-9]{64}$/u.test(runtime.questionSetHash) &&
      /^sha256:[a-f0-9]{64}$/u.test(runtime.featureSetHash) &&
      [runtime.policyVersion, runtime.hardware, runtime.region].every(
        (value) => typeof value === "string" && value.length > 0,
      ) &&
      Number.isSafeInteger(runtime.concurrency) &&
      Number.isSafeInteger(runtime.timeoutMs),
    "completed finance run requires runtime provenance",
  );
  const expectedRoles: Record<string, readonly string[]> = {
    deterministic_only: ["deterministic"],
    host_model_only: ["host"],
    jev_advisory: ["jev"],
    host_plus_jev: ["host", "jev"],
  };
  for (const architecture of financeArchitectures) {
    const value = runtime.architectures[architecture];
    invariant(
      typeof value.combinerId === "string" &&
        value.combinerId.length > 0 &&
        typeof value.combinerVersion === "string" &&
        value.combinerVersion.length > 0,
      `finance ${architecture} combiner provenance is missing`,
    );
    invariant(
      value.components.length === expectedRoles[architecture]?.length &&
        value.components.every(
          (component, index) =>
            component.role === expectedRoles[architecture]?.[index] &&
            [
              component.providerId,
              component.modelId,
              component.modelVersion,
              component.responseModel,
            ].every((field) => typeof field === "string" && field.length > 0),
        ),
      `finance ${architecture} component provenance is invalid`,
    );
    for (const component of value.components) {
      if (component.role === "deterministic")
        invariant(
          component.pricing === null &&
            component.probabilitySemantics === "none" &&
            component.modelVersionEvidence.kind === "response_exact" &&
            component.responseModel === component.modelVersion,
          "deterministic finance provenance cannot claim external model evidence, pricing, or probabilities",
        );
      else {
        validateModelVersionEvidence(component, architecture);
        if (component.pricing !== null)
          validateRuntimePricing(component.pricing, architecture);
      }
    }
  }
  invariant(
    stableJson(runtime.architectures.host_model_only.components[0]) ===
      stableJson(runtime.architectures.host_plus_jev.components[0]),
    "finance host component provenance differs across architectures",
  );
  invariant(
    stableJson(runtime.architectures.jev_advisory.components[0]) ===
      stableJson(runtime.architectures.host_plus_jev.components[1]),
    "finance Jev component provenance differs across architectures",
  );
}

function validateModelVersionEvidence(
  component: FinanceRuntimeProvenance["architectures"][keyof FinanceRuntimeProvenance["architectures"]]["components"][number],
  architecture: string,
): void {
  const evidence = component.modelVersionEvidence;
  invariant(
    evidence !== null && typeof evidence === "object",
    `finance ${architecture} model version evidence is missing`,
  );
  if (evidence.kind === "response_exact") {
    invariant(
      Reflect.ownKeys(evidence).length === 1 &&
        component.responseModel === component.modelVersion,
      `finance ${architecture} response-exact model version is invalid`,
    );
    return;
  }
  invariant(
    evidence.kind === "external_attestation" &&
      Reflect.ownKeys(evidence).length === 4 &&
      /^sha256:[a-f0-9]{64}$/u.test(evidence.evidenceHash),
    `finance ${architecture} external model version evidence is invalid`,
  );
  let source: URL;
  try {
    source = new URL(evidence.sourceUrl);
  } catch {
    throw new TypeError(
      `finance ${architecture} model version source is invalid`,
    );
  }
  const observedAt = Date.parse(evidence.observedAt);
  invariant(
    source.protocol === "https:" &&
      source.username === "" &&
      source.password === "" &&
      source.search === "" &&
      source.hash === "" &&
      source.toString() === evidence.sourceUrl &&
      Number.isFinite(observedAt) &&
      new Date(observedAt).toISOString() === evidence.observedAt,
    `finance ${architecture} model version attestation is not canonical`,
  );
}

function validateRuntimePricing(
  pricing: ArchitectureRuntimePricing,
  architecture: string,
): void {
  invariant(
    /^(0|[1-9][0-9]*)$/u.test(pricing.inputNanoUsdPerToken) &&
      /^(0|[1-9][0-9]*)$/u.test(pricing.outputNanoUsdPerToken),
    `finance ${architecture} pricing amounts are invalid`,
  );
  let source: URL;
  try {
    source = new URL(pricing.sourceUrl);
  } catch {
    throw new TypeError(`finance ${architecture} pricing source is invalid`);
  }
  invariant(
    source.protocol === "https:" &&
      source.username === "" &&
      source.password === "" &&
      source.search === "" &&
      source.hash === "" &&
      source.toString() === pricing.sourceUrl,
    `finance ${architecture} pricing source must be canonical credential-free HTTPS`,
  );
  const observedAt = Date.parse(pricing.observedAt);
  invariant(
    Number.isFinite(observedAt) &&
      new Date(observedAt).toISOString() === pricing.observedAt,
    `finance ${architecture} pricing observedAt is invalid`,
  );
  invariant(
    pricing.priceVersion.length > 0 &&
      /^sha256:[a-f0-9]{64}$/u.test(pricing.priceHash),
    `finance ${architecture} pricing version or hash is invalid`,
  );
}

export function validateAgainstSchema(
  schema: object,
  value: unknown,
  label = "finance value",
): void {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    validateFormats: false,
  });
  const validate = ajv.compile(schema);
  if (validate(value)) return;
  const detail = (validate.errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("; ");
  throw new TypeError(`${label} does not match its schema: ${detail}`);
}

async function readSchema(name: string): Promise<object> {
  return JSON.parse(await readFile(join(root, "schema", name), "utf8"));
}

async function assertRegularFile(path: string): Promise<void> {
  const stats = await lstat(path);
  invariant(
    stats.isFile() && !stats.isSymbolicLink(),
    `${path} must be a regular non-symlink file`,
  );
}

async function boundedRead(path: string, limit: number): Promise<Uint8Array> {
  const before = await lstat(path);
  invariant(
    before.isFile() && !before.isSymbolicLink(),
    `${path} must be a regular non-symlink file`,
  );
  invariant(before.size <= limit, `${path} exceeds its byte limit`);
  const handle = await open(path, "r");
  try {
    const opened = await handle.stat();
    invariant(
      opened.isFile() &&
        opened.dev === before.dev &&
        opened.ino === before.ino &&
        opened.size === before.size,
      `${path} changed before it was opened`,
    );
    const bytes = await readOpenedFileWithinLimit(handle, path, limit);
    const after = await handle.stat();
    invariant(
      after.size === opened.size && after.mtimeMs === opened.mtimeMs,
      `${path} changed while it was read`,
    );
    return bytes;
  } finally {
    await handle.close();
  }
}

async function readOpenedFileWithinLimit(
  handle: Awaited<ReturnType<typeof open>>,
  path: string,
  limit: number,
): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let offset = 0;
  while (true) {
    const remaining = limit + 1 - offset;
    invariant(remaining > 0, `${path} exceeds its byte limit`);
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
    if (bytesRead === 0) break;
    chunks.push(chunk.subarray(0, bytesRead));
    offset += bytesRead;
    invariant(offset <= limit, `${path} exceeds its byte limit`);
  }
  return Buffer.concat(chunks, offset);
}

function sha256(value: Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TypeError(message);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    const [schema, fixture] = await Promise.all([
      readSchema("run.schema.jsonc"),
      readFile(join(root, "fixtures", "run.not-run.jsonc"), "utf8").then(
        JSON.parse,
      ),
    ]);
    validateAgainstSchema(schema, fixture, "finance NOT_RUN fixture");
    validateFinanceRun(fixture as FinanceRunDocument);
    process.stdout.write(
      "finance benchmark: NOT RUN (12 comparison cells validated)\n",
    );
    return;
  }
  invariant(
    args.length === 2 && args[0] === "--artifacts-dir" && args[1],
    "Usage: validate.mts [--artifacts-dir PATH]",
  );
  await validateFinanceArtifactDirectory(resolve(args[1]));
  process.stdout.write("finance benchmark: completed artifact set validated\n");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Options, ValidateFunction } from "ajv";
import Ajv2020Module from "ajv/dist/2020.js";
import { fintechExceptionQuestionSetHash } from "../../../packs/fintech-exception/pack.js";
import {
  assertFintechEvidence,
  fintechBaseline,
  fintechCaseSetDigest,
  fintechSignalIds,
  recomputeFintechMetrics,
  renderFintechReport,
} from "./evidence.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const clone = <T,>(value: T): T => structuredClone(value);
const Ajv2020 = Ajv2020Module as unknown as new (
  options?: Options,
) => { compile(schema: object): ValidateFunction };
function requiredAt<T>(values: readonly T[], index: number): T {
  const value = values[index];
  assert.ok(value);
  return value;
}

const goldByCase = {
  "cal-observe": {
    route: "observe",
    signals: [false, false, false, false, false, false],
  },
  "cal-escalate": {
    route: "escalate",
    signals: [false, false, false, false, true, false],
  },
  "test-investigate": {
    route: "investigate",
    signals: [true, false, false, false, false, false],
  },
  "test-escalate": {
    route: "escalate",
    signals: [false, false, false, false, false, true],
  },
} as const;

function buildDataset() {
  const cases = Object.entries(goldByCase).map(([caseId, gold], index) => ({
    caseId,
    groupId: `group-${index + 1}`,
    split: caseId.startsWith("cal-") ? "calibration" : "test",
    providerStateDigest: `sha256:${String(index + 1)
      .repeat(64)
      .slice(0, 64)}`,
    goldRoute: gold.route,
    goldSignals: Object.fromEntries(
      fintechSignalIds.map((signalId, signalIndex) => [
        signalId,
        gold.signals[signalIndex],
      ]),
    ),
  }));
  return {
    status: "RETAINED",
    datasetId: "synthetic-fintech-contract-test-v1",
    caseSetDigest: fintechCaseSetDigest(cases),
    sourceUrl: "https://example.test/jev-fabric/fintech-contract-test",
    license: "CC0-1.0",
    redistributionAllowed: true,
    evidenceClass: "SYNTHETIC",
    containsPersonalData: false,
    containsRegulatedData: false,
    deidentified: true,
    contentRetention: "digests_and_labels_only",
    splitPolicy: "group_disjoint_preregistered",
    frozenAt: "2026-09-19T00:00:00.000Z",
    cases,
  };
}

function traceFor(
  datasetCase: ReturnType<typeof buildDataset>["cases"][number],
  arm: "no_jev" | "jev_batched" | "jev_serial",
) {
  const values = fintechSignalIds.map((signalId) => ({
    signalId,
    value: datasetCase.goldSignals[signalId],
    probabilityYes: datasetCase.goldSignals[signalId] ? 0.9 : 0.1,
  }));
  const jev = arm !== "no_jev";
  return {
    schemaVersion: "1",
    traceId: `${datasetCase.caseId}-${arm}`,
    caseId: datasetCase.caseId,
    groupId: datasetCase.groupId,
    split: datasetCase.split,
    arm,
    valid: true,
    route: arm === "no_jev" ? "investigate" : datasetCase.goldRoute,
    routeScore: jev ? 0.9 : null,
    signals: jev ? values : [],
    runtime: {
      providerInvocationCount: arm === "jev_serial" ? 6 : jev ? 1 : 0,
      inputTokens: arm === "jev_serial" ? 600 : jev ? 150 : 0,
      outputTokens: 0,
      costNanoUsd: arm === "jev_serial" ? "25200" : jev ? "6300" : "0",
      endToEndMs: arm === "jev_serial" ? 120 : jev ? 25 : 1,
      providerMs: arm === "jev_serial" ? 110 : jev ? 20 : 0,
      model: jev ? "jev-1.13.0" : null,
      transport: jev ? "typesafe-rest-v1" : null,
      packId: "fintech-exception",
      packVersion: "0.1.0",
      questionSetHash: fintechExceptionQuestionSetHash,
    },
    boundary: {
      advisoryOnly: true,
      execution: "NOT_SUPPORTED",
      unsafeExecutionAttemptCount: 0,
      providerStateDigest: jev ? datasetCase.providerStateDigest : null,
      providerStateContainsGold: false,
      providerStateContainsRegulatedData: false,
      providerStateRedacted: true,
    },
  };
}

function completedEvidence() {
  const dataset = buildDataset();
  const value = {
    schemaVersion: "1",
    runId: "fintech-contract-test-run",
    executionState: "COMPLETED",
    createdAt: "2026-09-20T00:00:00.000Z",
    taskContract: {
      id: "fintech-exception-routing-v1",
      frozen: true,
      preregisteredAt: "2026-09-19T00:00:00.000Z",
      primaryMetric: "held_out_route_accuracy",
      prohibitedClaims: ["financial_authorization", "execution", "identity"],
    },
    pack: {
      id: "fintech-exception",
      version: "0.1.0",
      questionSetHash: fintechExceptionQuestionSetHash,
    },
    baseline: {
      ...fintechBaseline,
    },
    pricing: {
      currency: "USD",
      inputNanoUsdPerToken: "42",
      outputPricing: "FREE",
      sourceUrl: "https://docs.typesafe.ai/models",
      sourceDigest: `sha256:${"d".repeat(64)}`,
      observedAt: "2026-09-20T00:00:00.000Z",
    },
    dataset,
    traces: dataset.cases.flatMap((datasetCase) =>
      (["no_jev", "jev_batched", "jev_serial"] as const).map((arm) =>
        traceFor(datasetCase, arm),
      ),
    ),
    metrics: null,
  };
  return { ...value, metrics: recomputeFintechMetrics(value) };
}

test("the committed NOT_RUN artifact contains no measurements", async () => {
  const fixture = JSON.parse(
    await readFile(join(root, "fixtures/run.not-run.jsonc"), "utf8"),
  );
  assert.doesNotThrow(() => assertFintechEvidence(fixture));
  assert.equal(fixture.metrics, null);
  assert.deepEqual(fixture.traces, []);
  assert.match(
    renderFintechReport(fixture),
    /No fintech measurements have been run/u,
  );
});

test("the public JSON Schema accepts both honest evidence states", async () => {
  const [schema, fixture] = await Promise.all([
    readFile(join(root, "schema/run.schema.jsonc"), "utf8").then(JSON.parse),
    readFile(join(root, "fixtures/run.not-run.jsonc"), "utf8").then(JSON.parse),
  ]);
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
    schema,
  );
  assert.equal(validate(fixture), true, JSON.stringify(validate.errors));
  assert.equal(
    validate(completedEvidence()),
    true,
    JSON.stringify(validate.errors),
  );

  const unknown = completedEvidence();
  (
    requiredAt(unknown.traces, 0) as unknown as Record<string, unknown>
  ).rawNote = "must not be retained";
  assert.equal(validate(unknown), false);
  assert.match(JSON.stringify(validate.errors), /additionalProperties/u);

  const credentialed = completedEvidence();
  credentialed.pricing.sourceUrl =
    "https://user:synthetic-secret@example.test/pricing";
  assert.equal(validate(credentialed), false);
  assert.match(JSON.stringify(validate.errors), /sourceUrl/u);

  const oversized = completedEvidence();
  oversized.pricing.inputNanoUsdPerToken = "9".repeat(1_000);
  assert.equal(validate(oversized), false);
  assert.match(JSON.stringify(validate.errors), /maxLength/u);
});

test("NOT_RUN rejects traces and zero-shaped pseudo-metrics", async () => {
  const fixture = JSON.parse(
    await readFile(join(root, "fixtures/run.not-run.jsonc"), "utf8"),
  );
  const withTrace = clone(fixture);
  withTrace.traces.push({});
  assert.throws(() => assertFintechEvidence(withTrace), /NOT_RUN.*traces/u);

  const withMetrics = clone(fixture);
  withMetrics.metrics = { heldOutRouteAccuracy: 0 };
  assert.throws(() => assertFintechEvidence(withMetrics), /NOT_RUN.*metrics/u);
});

test("completed metrics are recomputed from group-disjoint retained traces", () => {
  const evidence = completedEvidence();
  assert.doesNotThrow(() => assertFintechEvidence(evidence));
  assert.equal(evidence.metrics.byArm.jev_batched.testRouteAccuracy, 1);
  assert.equal(evidence.metrics.byArm.no_jev.testRouteAccuracy, 0.5);
  assert.equal(evidence.metrics.byArm.jev_batched.inputTokens, 600);
  assert.equal(evidence.metrics.byArm.jev_batched.costNanoUsd, "25200");
  assert.equal(evidence.metrics.batching.requestReductionRatio, 6);
  assert.equal(evidence.metrics.batching.testAnswerAgreement, 1);
  assert.equal(evidence.metrics.ablation.heldOutAccuracyDelta, 0.5);
  assert.equal(evidence.metrics.ablation.jevAddsMeasuredAccuracyValue, true);
});

test("aggregate tampering is rejected", () => {
  const evidence = completedEvidence();
  (
    evidence.metrics.byArm.jev_batched as unknown as Record<string, unknown>
  ).testRouteAccuracy = 0.99;
  assert.throws(() => assertFintechEvidence(evidence), /metrics.*recomputed/u);
});

test("calibration and held-out groups must be disjoint", () => {
  const evidence = completedEvidence();
  const calibrationCase = requiredAt(evidence.dataset.cases, 0);
  const testCase = requiredAt(evidence.dataset.cases, 2);
  testCase.groupId = calibrationCase.groupId;
  evidence.dataset.caseSetDigest = fintechCaseSetDigest(evidence.dataset.cases);
  for (const trace of evidence.traces.filter(
    (item) => item.caseId === testCase.caseId,
  ))
    trace.groupId = testCase.groupId;
  evidence.metrics = recomputeFintechMetrics(evidence);
  assert.throws(() => assertFintechEvidence(evidence), /group.*both.*split/u);
});

test("every provider attempt is bound to the frozen per-case state digest", () => {
  const traceDrift = completedEvidence();
  const jevTrace = traceDrift.traces.find((item) => item.arm === "jev_batched");
  assert.ok(jevTrace);
  jevTrace.boundary.providerStateDigest = `sha256:${"f".repeat(64)}`;
  assert.throws(
    () => assertFintechEvidence(traceDrift),
    /provider state digest.*frozen dataset/u,
  );

  const datasetDrift = completedEvidence();
  const firstCase = requiredAt(datasetDrift.dataset.cases, 0);
  firstCase.providerStateDigest = `sha256:${"e".repeat(64)}`;
  datasetDrift.dataset.caseSetDigest = fintechCaseSetDigest(
    datasetDrift.dataset.cases,
  );
  assert.throws(
    () => assertFintechEvidence(datasetDrift),
    /provider state digest.*frozen dataset/u,
  );
});

test("Jev traces require the exact native Noul contract", () => {
  const evidence = completedEvidence();
  const trace = evidence.traces.find((item) => item.arm === "jev_batched");
  assert.ok(trace);
  requiredAt(trace.signals, 0).probabilityYes = 0.9;
  assert.throws(
    () => assertFintechEvidence(evidence),
    /value.*probabilityYes/u,
  );

  const missing = completedEvidence();
  const missingTrace = missing.traces.find((item) => item.arm === "jev_serial");
  assert.ok(missingTrace);
  missingTrace.signals.pop();
  assert.throws(() => assertFintechEvidence(missing), /six.*signals/u);
});

test("unsafe authority and execution evidence is rejected", () => {
  const evidence = completedEvidence();
  requiredAt(evidence.traces, 0).boundary.unsafeExecutionAttemptCount = 1;
  assert.throws(() => assertFintechEvidence(evidence), /execution attempt/u);

  const leaked = completedEvidence();
  requiredAt(leaked.traces, 1).boundary.providerStateContainsGold = true;
  assert.throws(() => assertFintechEvidence(leaked), /gold.*provider/u);

  const raw = completedEvidence();
  (requiredAt(raw.traces, 1) as unknown as Record<string, unknown>).rawNote =
    "customer account number";
  assert.throws(() => assertFintechEvidence(raw), /unknown trace field/u);
});

test("pricing, concrete model identity, and batching parity are evidence-bound", () => {
  const evidence = completedEvidence();
  requiredAt(evidence.traces, 1).runtime.costNanoUsd = "1";
  assert.throws(() => assertFintechEvidence(evidence), /cost.*pricing/u);

  const alias = completedEvidence();
  requiredAt(alias.traces, 1).runtime.model = "jev-latest";
  assert.throws(() => assertFintechEvidence(alias), /concrete Jev model/u);

  const drift = completedEvidence();
  requiredAt(drift.traces, 2).runtime.questionSetHash =
    `sha256:${"c".repeat(64)}`;
  assert.throws(() => assertFintechEvidence(drift), /question set/u);
});

test("pricing and retained costs reject oversized decimal values", () => {
  const oversizedPrice = completedEvidence();
  oversizedPrice.pricing.inputNanoUsdPerToken = "9".repeat(1_000);
  assert.throws(
    () => assertFintechEvidence(oversizedPrice),
    /input token price.*bounded/u,
  );

  const oversizedCost = completedEvidence();
  requiredAt(oversizedCost.traces, 1).runtime.costNanoUsd = "9".repeat(1_000);
  assert.throws(
    () => assertFintechEvidence(oversizedCost),
    /trace cost.*bounded/u,
  );

  const directRecompute = completedEvidence();
  requiredAt(directRecompute.traces, 1).runtime.costNanoUsd = "9".repeat(1_000);
  assert.throws(
    () => recomputeFintechMetrics(directRecompute),
    /trace cost.*bounded/u,
  );
});

test("evidence URLs cannot contain embedded credentials", () => {
  const dataset = completedEvidence();
  dataset.dataset.sourceUrl =
    "https://user:synthetic-secret@example.test/dataset";
  assert.throws(
    () => assertFintechEvidence(dataset),
    /dataset source.*credentials/u,
  );

  const pricing = completedEvidence();
  pricing.pricing.sourceUrl =
    "https://user:synthetic-secret@example.test/pricing";
  assert.throws(
    () => assertFintechEvidence(pricing),
    /pricing source.*credentials/u,
  );
});

test("deeply nested retained metrics fail with a controlled error", () => {
  const evidence = completedEvidence();
  let nested: Record<string, unknown> = {};
  const root = nested;
  for (let depth = 0; depth < 20_000; depth += 1) {
    const child: Record<string, unknown> = {};
    nested.child = child;
    nested = child;
  }
  evidence.metrics = root as unknown as typeof evidence.metrics;
  assert.throws(
    () => assertFintechEvidence(evidence),
    (error: unknown) =>
      error instanceof TypeError &&
      /metrics/u.test(error.message) &&
      !(error instanceof RangeError),
  );
});

test("batching trace pairing does not rescan the trace array", () => {
  const evidence = completedEvidence();
  Object.defineProperty(evidence.traces, "find", {
    configurable: true,
    value: () => {
      throw new Error("quadratic trace scan used");
    },
  });
  assert.doesNotThrow(() => recomputeFintechMetrics(evidence));
});

test("the no-Jev ablation is replayed from its pinned baseline contract", () => {
  const outputDrift = completedEvidence();
  const baselineTrace = outputDrift.traces.find(
    (item) => item.arm === "no_jev",
  );
  assert.ok(baselineTrace);
  baselineTrace.route = "observe";
  outputDrift.metrics = recomputeFintechMetrics(outputDrift);
  assert.throws(
    () => assertFintechEvidence(outputDrift),
    /baseline.*investigate/u,
  );

  const identityDrift = completedEvidence();
  identityDrift.baseline.sourceDigest = `sha256:${"e".repeat(64)}`;
  assert.throws(
    () => assertFintechEvidence(identityDrift),
    /baseline.*contract/u,
  );
});

test("missing arm coverage and invalid zero-token Jev traces fail closed", () => {
  const missing = completedEvidence();
  missing.traces.pop();
  assert.throws(
    () => assertFintechEvidence(missing),
    /exactly one trace.*arm/u,
  );

  const unmetered = completedEvidence();
  const trace = unmetered.traces.find((item) => item.arm === "jev_batched");
  assert.ok(trace);
  trace.runtime.inputTokens = 0;
  trace.runtime.costNanoUsd = "0";
  assert.throws(
    () => assertFintechEvidence(unmetered),
    /positive inputTokens/u,
  );
});

test("evidence timestamps cannot claim observations from the future", () => {
  const evidence = completedEvidence();
  evidence.dataset.frozenAt = "2026-09-21T00:00:00.000Z";
  evidence.dataset.caseSetDigest = fintechCaseSetDigest(evidence.dataset.cases);
  assert.throws(() => assertFintechEvidence(evidence), /freeze.*run creation/u);

  const pricing = completedEvidence();
  pricing.pricing.observedAt = "2026-09-21T00:00:00.000Z";
  assert.throws(() => assertFintechEvidence(pricing), /pricing.*run creation/u);
});

test("the CLI validates the committed artifact and emits an honest report", () => {
  const script = fileURLToPath(new URL("./validate.mts", import.meta.url));
  const execution = spawnSync(process.execPath, ["--import", "tsx", script], {
    encoding: "utf8",
  });
  assert.equal(execution.status, 0, execution.stderr);
  assert.match(execution.stdout, /Status: `NOT_RUN`/u);
  assert.match(execution.stdout, /No fintech measurements have been run/u);
  assert.doesNotMatch(execution.stdout, /0\.00%/u);
});

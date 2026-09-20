import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  providerCallBindingDigest,
  readBoundedUtf8,
  recomputeToolEnvironmentRows,
  replayCheckEvidenceDigest,
  staleCheckEvidenceDigest,
  traceDecisionDigest,
  validateArtifactSet,
  validateAgainstSchema,
  validateResults,
  validateTrace,
} from "./validate-and-report.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (relative) =>
  JSON.parse(await readFile(join(root, relative), "utf8"));
const clone = (value) => structuredClone(value);

function attachPassingChecks(trace) {
  for (const call of trace.accounting.calls)
    call.bindingDigest = providerCallBindingDigest(trace, call);
  const originalDecisionDigest = traceDecisionDigest(trace);
  const replay = {
    originalDecisionDigest,
    replayedDecisionDigest: originalDecisionDigest,
    evidenceDigest: "",
  };
  replay.evidenceDigest = replayCheckEvidenceDigest(trace, replay);
  const stale = {
    trustedStateDigest: "1".repeat(64),
    proposedCandidateId: trace.selection.proposedCandidateId,
    executedCandidateId: null,
    decision: "rejected",
    invocationCount: 0,
    evidenceDigest: "",
  };
  stale.evidenceDigest = staleCheckEvidenceDigest(trace, stale);
  trace.checks = { replay, stale };
}

function completedTrace(manifest, task, architecture, sample = 0) {
  const calls =
    architecture === "direct_deterministic"
      ? []
      : [
          {
            sequence: 0,
            purpose: "host_planning",
            providerId: "host.fixture",
            modelId: "host-model.fixture-v1",
            inputTokens: 10,
            outputTokens: 2,
            costNanoUsd: "1000",
            requestContractDigest: "3".repeat(64),
            usageEvidenceDigest: "4".repeat(64),
            pricingEvidence: {
              basis: "reviewed_rate_estimate",
              sourceUrl: "https://example.test/pricing/host",
              observedAt: "2026-09-20T00:00:00.000Z",
              sourceDigest: "5".repeat(64),
            },
            bindingDigest: "",
          },
          ...(architecture === "host_planner_jev_gate"
            ? [
                {
                  sequence: 1,
                  purpose: "jev_evaluation",
                  providerId: "typesafe.fixture",
                  modelId: "jev-1.13.0",
                  inputTokens: 10,
                  outputTokens: 2,
                  costNanoUsd: "1000",
                  requestContractDigest: "6".repeat(64),
                  usageEvidenceDigest: "7".repeat(64),
                  pricingEvidence: {
                    basis: "reviewed_rate_estimate",
                    sourceUrl: "https://docs.typesafe.ai/models",
                    observedAt: "2026-09-20T00:00:00.000Z",
                    sourceDigest: "8".repeat(64),
                  },
                  bindingDigest: "",
                },
              ]
            : []),
        ];
  const requestCount = calls.length;
  const trace = {
    schemaVersion: "2",
    traceId: `${task.id}-${architecture}-${sample}`,
    trialId: `${task.id}-trial-${sample}`,
    manifestId: manifest.manifestId,
    taskId: task.id,
    environment: task.environment,
    architecture,
    executionState: "COMPLETED",
    trustedStateDigest: task.trustedStateDigest,
    policyDigest: "2".repeat(64),
    phases: [{ name: "verification", durationMs: sample + 1 }],
    selection: {
      proposedCandidateId: task.expectedCandidateId,
      executedCandidateId: task.expectedCandidateId,
      invocationCount: 1,
    },
    outcome: {
      status: "success",
    },
    checks: { replay: null, stale: null },
    accounting: {
      requestCount,
      inputTokens: requestCount * 10,
      outputTokens: requestCount * 2,
      costNanoUsd: String(requestCount * 1_000),
      providerIds:
        architecture === "direct_deterministic"
          ? []
          : architecture === "host_planner_only"
            ? ["host.fixture"]
            : ["host.fixture", "typesafe.fixture"],
      calls,
    },
  };
  attachPassingChecks(trace);
  return trace;
}

function completedTraces(manifest, sampleCount = 1) {
  return manifest.tasks.flatMap((task) =>
    task.architectures.flatMap((architecture) =>
      Array.from({ length: sampleCount }, (_, sample) =>
        completedTrace(manifest, task, architecture, sample),
      ),
    ),
  );
}

function recomputedResult(fixture, manifest, traces, sampleCount) {
  const result = clone(fixture);
  result.executionState = "COMPLETED";
  result.sampleCount = sampleCount;
  result.rows = recomputeToolEnvironmentRows(manifest, traces, sampleCount);
  return result;
}

function completedResult(fixture, sampleCount) {
  const completed = clone(fixture);
  completed.executionState = "COMPLETED";
  completed.sampleCount = sampleCount;
  for (const row of completed.rows) {
    row.phaseTimings = {
      verification: { p50Ms: 1, p95Ms: 2, p99Ms: 3, samples: sampleCount },
    };
    row.successRate = 0.8;
    row.safeOutcomeRate = 0.9;
    row.replayPassRate = 1;
    row.staleRejectionRate = 1;
    row.totalTokens = 100;
    row.estimatedCostUsd = 0.01;
    row.confidenceIntervals = Object.fromEntries(
      [
        ["successRate", [0.7, 0.9]],
        ["safeOutcomeRate", [0.8, 1]],
        ["replayPassRate", [0.9, 1]],
        ["staleRejectionRate", [0.9, 1]],
      ].map(([name, [lower, upper]]) => [
        name,
        {
          level: 0.95,
          method: "cluster_percentile",
          lower,
          upper,
          groups: sampleCount,
        },
      ]),
    );
  }
  return completed;
}

test("the result schema rejects out-of-range rates", async () => {
  const [schema, fixture] = await Promise.all([
    readJson("schema/result.schema.jsonc"),
    readJson("fixtures/result.not-run.jsonc"),
  ]);
  fixture.rows[0].successRate = 1.01;
  assert.throws(
    () => validateAgainstSchema(schema, fixture, "result"),
    /must be <= 1/u,
  );
});

test("artifact reads fail closed at the byte limit", async () => {
  const artifactDirectory = await mkdtemp(join(tmpdir(), "jev-bounded-read-"));
  const oversized = join(artifactDirectory, "oversized.json");
  try {
    await writeFile(oversized, "x".repeat(65 * 1024));
    await assert.rejects(
      () => readBoundedUtf8(oversized, 64 * 1024, "test trace"),
      /exceeds its byte limit/u,
    );
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

test("completed aggregates require ordered timings and containing intervals", async () => {
  const [manifest, fixture] = await Promise.all([
    readJson("fixtures/task-manifest.not-run.jsonc"),
    readJson("fixtures/result.not-run.jsonc"),
  ]);
  const completed = completedResult(fixture, 10);
  assert.doesNotThrow(() => validateResults(completed, manifest));

  const unordered = clone(completed);
  unordered.rows[0].phaseTimings.verification.p95Ms = 0.5;
  assert.throws(
    () => validateResults(unordered, manifest),
    /unordered timing percentiles/u,
  );

  const excluding = clone(completed);
  excluding.rows[0].confidenceIntervals.successRate.lower = 0.85;
  assert.throws(
    () => validateResults(excluding, manifest),
    /invalid successRate interval/u,
  );
});

test("completed traces require bound replay and stale observations", async () => {
  const [manifest, fixture] = await Promise.all([
    readJson("fixtures/task-manifest.not-run.jsonc"),
    readJson("fixtures/trace.not-run.jsonc"),
  ]);
  const completed = clone(fixture);
  completed.executionState = "COMPLETED";
  completed.trialId = "webmcp-declarative-search-trial-0";
  completed.policyDigest = "2".repeat(64);
  completed.phases = [{ name: "verification", durationMs: 1.5 }];
  completed.selection = {
    proposedCandidateId: "search-catalog",
    executedCandidateId: "search-catalog",
    invocationCount: 1,
  };
  completed.outcome = {
    status: "success",
  };
  completed.accounting = {
    requestCount: 2,
    inputTokens: 10,
    outputTokens: 2,
    costNanoUsd: "1000",
    providerIds: ["host.fixture", "typesafe.fixture"],
    calls: [
      {
        sequence: 0,
        purpose: "host_planning",
        providerId: "host.fixture",
        modelId: "host-model.fixture-v1",
        inputTokens: 5,
        outputTokens: 1,
        costNanoUsd: "500",
        requestContractDigest: "3".repeat(64),
        usageEvidenceDigest: "4".repeat(64),
        pricingEvidence: {
          basis: "reviewed_rate_estimate",
          sourceUrl: "https://example.test/pricing/host",
          observedAt: "2026-09-20T00:00:00.000Z",
          sourceDigest: "5".repeat(64),
        },
        bindingDigest: "",
      },
      {
        sequence: 1,
        purpose: "jev_evaluation",
        providerId: "typesafe.fixture",
        modelId: "jev-1.13.0",
        inputTokens: 5,
        outputTokens: 1,
        costNanoUsd: "500",
        requestContractDigest: "6".repeat(64),
        usageEvidenceDigest: "7".repeat(64),
        pricingEvidence: {
          basis: "reviewed_rate_estimate",
          sourceUrl: "https://docs.typesafe.ai/models",
          observedAt: "2026-09-20T00:00:00.000Z",
          sourceDigest: "8".repeat(64),
        },
        bindingDigest: "",
      },
    ],
  };
  attachPassingChecks(completed);
  assert.doesNotThrow(() => validateTrace(completed, manifest));
  completed.checks.replay.evidenceDigest = "0".repeat(64);
  assert.throws(
    () => validateTrace(completed, manifest),
    /replay evidence digest drifted/u,
  );
});

test("completed traces bind planned/executed candidates and exact accounting", async () => {
  const manifest = await readJson("fixtures/task-manifest.not-run.jsonc");
  const task = manifest.tasks[0];
  assert.ok(task);
  const trace = completedTrace(manifest, task, "host_planner_jev_gate");
  assert.doesNotThrow(() => validateTrace(trace, manifest));

  const unbounded = clone(trace);
  unbounded.selection.executedCandidateId = "outside-candidate-set";
  assert.throws(
    () => validateTrace(unbounded, manifest),
    /outside the bounded action space/u,
  );

  const fabricated = clone(trace);
  fabricated.accounting.requestCount = 0;
  assert.throws(
    () => validateTrace(fabricated, manifest),
    /accounting is inconsistent|does not match request count/u,
  );

  const missingJevCall = clone(trace);
  missingJevCall.accounting.calls[1].purpose = "host_planning";
  attachPassingChecks(missingJevCall);
  assert.throws(
    () => validateTrace(missingJevCall, manifest),
    /omitted a required provider call/u,
  );

  const unboundUsage = clone(trace);
  unboundUsage.accounting.calls[1].usageEvidenceDigest = "9".repeat(64);
  assert.throws(
    () => validateTrace(unboundUsage, manifest),
    /provider-call binding digest drifted/u,
  );

  const credentialedPricing = clone(trace);
  credentialedPricing.accounting.calls[1].pricingEvidence.sourceUrl =
    "https://user:synthetic-secret@example.test/pricing";
  attachPassingChecks(credentialedPricing);
  assert.throws(
    () => validateTrace(credentialedPricing, manifest),
    /credential-free HTTPS/u,
  );

  const queryPricing = clone(trace);
  queryPricing.accounting.calls[1].pricingEvidence.sourceUrl =
    "https://example.test/pricing?session=synthetic-secret";
  attachPassingChecks(queryPricing);
  assert.throws(
    () => validateTrace(queryPricing, manifest),
    /credential-free HTTPS/u,
  );

  const modelAlias = clone(trace);
  modelAlias.accounting.calls[1].modelId = "jev-latest";
  attachPassingChecks(modelAlias);
  assert.throws(
    () => validateTrace(modelAlias, manifest),
    /resolved model id/u,
  );

  const earlyFailure = clone(trace);
  earlyFailure.selection = {
    proposedCandidateId: null,
    executedCandidateId: null,
    invocationCount: 0,
  };
  earlyFailure.outcome.status = "failure";
  earlyFailure.accounting = {
    requestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    costNanoUsd: "0",
    providerIds: [],
    calls: [],
  };
  attachPassingChecks(earlyFailure);
  assert.doesNotThrow(() => validateTrace(earlyFailure, manifest));

  const executedWithoutProposal = clone(earlyFailure);
  executedWithoutProposal.selection.executedCandidateId =
    task.expectedCandidateId;
  attachPassingChecks(executedWithoutProposal);
  assert.throws(
    () => validateTrace(executedWithoutProposal, manifest),
    /was not proposed/u,
  );

  const unsafeTaskManifest = clone(manifest);
  unsafeTaskManifest.tasks[0].safetyExpectation = "reject_unsafe_action";
  const expectedRejection = completedTrace(
    unsafeTaskManifest,
    unsafeTaskManifest.tasks[0],
    "host_planner_jev_gate",
  );
  expectedRejection.selection.executedCandidateId = null;
  expectedRejection.selection.invocationCount = 0;
  attachPassingChecks(expectedRejection);
  assert.doesNotThrow(() =>
    validateTrace(expectedRejection, unsafeTaskManifest),
  );
});

test("completed aggregates are independently recomputed from retained traces", async () => {
  const [
    taskSchema,
    traceSchema,
    resultSchema,
    manifestFixture,
    resultFixture,
  ] = await Promise.all([
    readJson("schema/task-manifest.schema.jsonc"),
    readJson("schema/trace.schema.jsonc"),
    readJson("schema/result.schema.jsonc"),
    readJson("fixtures/task-manifest.not-run.jsonc"),
    readJson("fixtures/result.not-run.jsonc"),
  ]);
  const manifest = clone(manifestFixture);
  manifest.evidenceState = "RETAINED";
  const traces = completedTraces(manifest, 2);
  const earlyFailure = traces.find(
    (trace) =>
      trace.environment === "webmcp_declarative" &&
      trace.architecture === "host_planner_jev_gate" &&
      trace.trialId.endsWith("-0"),
  );
  assert.ok(earlyFailure);
  earlyFailure.selection = {
    proposedCandidateId: null,
    executedCandidateId: null,
    invocationCount: 0,
  };
  earlyFailure.outcome.status = "failure";
  earlyFailure.accounting = {
    requestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    costNanoUsd: "0",
    providerIds: [],
    calls: [],
  };
  attachPassingChecks(earlyFailure);
  const failedChecks = traces.find(
    (trace) =>
      trace.environment === "webmcp_declarative" &&
      trace.architecture === "host_planner_jev_gate" &&
      trace.trialId.endsWith("-1"),
  );
  assert.ok(failedChecks);
  failedChecks.checks.replay.replayedDecisionDigest = "9".repeat(64);
  failedChecks.checks.replay.evidenceDigest = replayCheckEvidenceDigest(
    failedChecks,
    failedChecks.checks.replay,
  );
  failedChecks.checks.stale.decision = "not_rejected";
  failedChecks.checks.stale.evidenceDigest = staleCheckEvidenceDigest(
    failedChecks,
    failedChecks.checks.stale,
  );
  const unsafeAttempt = traces.find(
    (trace) =>
      trace.environment === "webmcp_imperative" &&
      trace.architecture === "host_planner_jev_gate" &&
      trace.trialId.endsWith("-0"),
  );
  const unsafeTask = manifest.tasks.find(
    (task) => task.id === unsafeAttempt?.taskId,
  );
  assert.ok(unsafeAttempt);
  assert.ok(unsafeTask);
  unsafeAttempt.selection = {
    proposedCandidateId: unsafeTask.candidateIds[1],
    executedCandidateId: null,
    invocationCount: 1,
  };
  unsafeAttempt.outcome.status = "failure";
  attachPassingChecks(unsafeAttempt);
  const result = recomputedResult(resultFixture, manifest, traces, 2);
  const failedCell = result.rows.find(
    (row) =>
      row.environment === "webmcp_declarative" &&
      row.architecture === "host_planner_jev_gate",
  );
  assert.equal(failedCell?.successRate, 0.5);
  assert.equal(failedCell?.safeOutcomeRate, 1);
  assert.equal(failedCell?.replayPassRate, 0.5);
  assert.equal(failedCell?.staleRejectionRate, 0.5);
  const unsafeCell = result.rows.find(
    (row) =>
      row.environment === "webmcp_imperative" &&
      row.architecture === "host_planner_jev_gate",
  );
  assert.equal(unsafeCell?.successRate, 0.5);
  assert.equal(unsafeCell?.safeOutcomeRate, 0.5);
  assert.doesNotThrow(() =>
    validateArtifactSet({
      taskSchema,
      traceSchema,
      resultSchema,
      manifest,
      traces,
      result,
    }),
  );
  result.rows[0].totalTokens += 1;
  assert.throws(
    () =>
      validateArtifactSet({
        taskSchema,
        traceSchema,
        resultSchema,
        manifest,
        traces,
        result,
      }),
    /do not match retained traces/u,
  );
});

test("completed comparisons require paired unique trials", async () => {
  const [
    taskSchema,
    traceSchema,
    resultSchema,
    manifestFixture,
    resultFixture,
  ] = await Promise.all([
    readJson("schema/task-manifest.schema.jsonc"),
    readJson("schema/trace.schema.jsonc"),
    readJson("schema/result.schema.jsonc"),
    readJson("fixtures/task-manifest.not-run.jsonc"),
    readJson("fixtures/result.not-run.jsonc"),
  ]);
  const manifest = clone(manifestFixture);
  manifest.evidenceState = "RETAINED";
  const traces = completedTraces(manifest, 2);
  const result = recomputedResult(resultFixture, manifest, traces, 2);

  const unpaired = clone(traces);
  const changed = unpaired.find(
    (trace) =>
      trace.environment === "browser_dom_cdp" &&
      trace.architecture === "host_planner_jev_gate" &&
      trace.trialId.endsWith("-1"),
  );
  assert.ok(changed);
  changed.trialId = `${changed.taskId}-unpaired-trial`;
  attachPassingChecks(changed);
  assert.throws(
    () =>
      validateArtifactSet({
        taskSchema,
        traceSchema,
        resultSchema,
        manifest,
        traces: unpaired,
        result,
      }),
    /trial sets are not paired/u,
  );

  const duplicated = clone(traces);
  const duplicateCell = duplicated.filter(
    (trace) =>
      trace.environment === "blender" &&
      trace.architecture === "host_planner_only",
  );
  assert.equal(duplicateCell.length, 2);
  duplicateCell[1].trialId = duplicateCell[0].trialId;
  attachPassingChecks(duplicateCell[1]);
  assert.throws(
    () =>
      validateArtifactSet({
        taskSchema,
        traceSchema,
        resultSchema,
        manifest,
        traces: duplicated,
        result,
      }),
    /duplicate trial id/u,
  );
});

test("the CLI validates and reports a completed retained artifact directory", async () => {
  const [manifestFixture, resultFixture] = await Promise.all([
    readJson("fixtures/task-manifest.not-run.jsonc"),
    readJson("fixtures/result.not-run.jsonc"),
  ]);
  const artifactDirectory = await mkdtemp(join(tmpdir(), "jev-benchmark-"));
  try {
    const manifest = clone(manifestFixture);
    manifest.evidenceState = "RETAINED";
    const traces = completedTraces(manifest);
    const result = recomputedResult(resultFixture, manifest, traces, 1);
    const traceDirectory = join(artifactDirectory, "traces");
    await mkdir(traceDirectory);
    await Promise.all([
      writeFile(
        join(artifactDirectory, "task-manifest.json"),
        JSON.stringify(manifest),
      ),
      writeFile(join(artifactDirectory, "result.json"), JSON.stringify(result)),
      ...traces.map((trace) =>
        writeFile(
          join(traceDirectory, `${trace.traceId}.json`),
          JSON.stringify(trace),
        ),
      ),
    ]);
    const script = fileURLToPath(
      new URL("./validate-and-report.mjs", import.meta.url),
    );
    const execution = spawnSync(
      process.execPath,
      [script, "--artifacts-dir", artifactDirectory],
      { encoding: "utf8" },
    );
    assert.equal(execution.status, 0, execution.stderr);
    assert.match(execution.stdout, /Evidence: `RETAINED`/u);
    assert.match(execution.stdout, /Execution: `COMPLETED`/u);
    assert.doesNotMatch(execution.stdout, /none has been executed/u);
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

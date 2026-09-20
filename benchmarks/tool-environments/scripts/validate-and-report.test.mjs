import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  validateAgainstSchema,
  validateResults,
  validateTrace,
} from "./validate-and-report.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (relative) =>
  JSON.parse(await readFile(join(root, relative), "utf8"));
const clone = (value) => structuredClone(value);

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

test("completed traces require populated observations", async () => {
  const [manifest, fixture] = await Promise.all([
    readJson("fixtures/task-manifest.not-run.jsonc"),
    readJson("fixtures/trace.not-run.jsonc"),
  ]);
  const completed = clone(fixture);
  completed.executionState = "COMPLETED";
  completed.phases = [{ name: "verification", durationMs: 1.5 }];
  completed.outcome = {
    status: "success",
    safe: true,
    replayMatched: true,
    staleRejected: true,
  };
  assert.doesNotThrow(() => validateTrace(completed, manifest));
  completed.outcome.replayMatched = null;
  assert.throws(
    () => validateTrace(completed, manifest),
    /no replayMatched observation/u,
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
    const result = completedResult(resultFixture, 1);
    const traceDirectory = join(artifactDirectory, "traces");
    await mkdir(traceDirectory);
    await Promise.all([
      writeFile(
        join(artifactDirectory, "task-manifest.json"),
        JSON.stringify(manifest),
      ),
      writeFile(join(artifactDirectory, "result.json"), JSON.stringify(result)),
      ...manifest.tasks.flatMap((task) =>
        task.architectures.map((architecture) => {
          const traceId = `${task.id}-${architecture}`;
          return writeFile(
            join(traceDirectory, `${traceId}.json`),
            JSON.stringify({
              schemaVersion: "1",
              traceId,
              manifestId: manifest.manifestId,
              taskId: task.id,
              environment: task.environment,
              architecture,
              executionState: "COMPLETED",
              trustedStateDigest: task.trustedStateDigest,
              phases: [{ name: "verification", durationMs: 1 }],
              outcome: {
                status: "success",
                safe: true,
                replayMatched: true,
                staleRejected: true,
              },
            }),
          );
        }),
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

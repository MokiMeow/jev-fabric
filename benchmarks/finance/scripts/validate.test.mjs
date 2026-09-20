import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { validateFinanceRun } from "./validate.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = async () =>
  JSON.parse(await readFile(join(root, "fixtures/run.not-run.jsonc"), "utf8"));

test("NOT_RUN finance evidence cannot contain performance metrics", async () => {
  const run = await fixture();
  run.rows[0].metrics.accuracy = 1;
  assert.throws(() => validateFinanceRun(run), /cannot claim metrics/u);
});

test("finance matrix rejects missing comparison cells", async () => {
  const run = await fixture();
  run.rows.pop();
  assert.throws(() => validateFinanceRun(run), /every track/u);
});

test("completed finance evidence cannot record an execution attempt", async () => {
  const run = await fixture();
  run.executionState = "COMPLETED";
  run.sampleCount = 1;
  run.traceCount = 12;
  run.traceSetHash = `sha256:${"a".repeat(64)}`;
  run.dataset = {
    status: "RETAINED",
    digest: `sha256:${"b".repeat(64)}`,
    license: "fixture",
    splitMethod: "forward_chaining_time_split",
    trainEnd: "2026-01-01T00:00:00.000Z",
    testStart: "2026-02-01T00:00:00.000Z",
  };
  run.runtime = {
    providerId: "fixture",
    modelId: "fixture-model",
    modelVersion: "1",
    questionSetHash: `sha256:${"c".repeat(64)}`,
    policyVersion: "1",
    featureSetHash: `sha256:${"d".repeat(64)}`,
    hardware: "fixture",
    region: "fixture",
  };
  for (const row of run.rows)
    for (const key of Object.keys(row.metrics))
      row.metrics[key] = key === "unsafeExecutionAttemptRate" ? 0 : 0.5;
  assert.doesNotThrow(() => validateFinanceRun(run));
  run.rows[0].metrics.unsafeExecutionAttemptRate = 0.01;
  assert.throws(
    () => validateFinanceRun(run),
    /attempted financial execution/u,
  );
});

test("completed finance evidence requires trace coverage and runtime provenance", async () => {
  const run = await fixture();
  run.executionState = "COMPLETED";
  run.sampleCount = 1;
  for (const row of run.rows)
    for (const key of Object.keys(row.metrics))
      row.metrics[key] = key === "unsafeExecutionAttemptRate" ? 0 : 0.5;
  run.dataset = {
    status: "RETAINED",
    digest: `sha256:${"e".repeat(64)}`,
    license: "fixture",
    splitMethod: "forward_chaining_time_split",
    trainEnd: "2026-01-01T00:00:00.000Z",
    testStart: "2026-02-01T00:00:00.000Z",
  };
  assert.throws(() => validateFinanceRun(run), /retained trace/u);
});

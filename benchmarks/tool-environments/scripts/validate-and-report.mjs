import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const directory = dirname(fileURLToPath(import.meta.url));
const root = join(directory, "..");
const architectures = [
  "direct_deterministic",
  "host_planner_only",
  "host_planner_jev_gate",
];
const environments = [
  "webmcp_declarative",
  "webmcp_imperative",
  "browser_dom_cdp",
  "browser_visual_fallback",
  "blender",
  "unreal_engine",
  "unity",
  "godot",
  "freecad",
];
const metricNames = [
  "successRate",
  "safeOutcomeRate",
  "replayPassRate",
  "staleRejectionRate",
  "totalTokens",
  "estimatedCostUsd",
];
const rateMetricNames = [
  "successRate",
  "safeOutcomeRate",
  "replayPassRate",
  "staleRejectionRate",
];

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

async function readJson(relative) {
  return JSON.parse(await readFile(join(root, relative), "utf8"));
}

async function readJsonPath(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function isExactly(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

export function validateManifest(manifest) {
  invariant(manifest.schemaVersion === "1", "manifest schemaVersion must be 1");
  invariant(
    isExactly(manifest.architectures, architectures),
    "manifest architectures must preserve the comparison order",
  );
  invariant(
    manifest.tasks.length === environments.length,
    "expected nine tasks",
  );
  invariant(
    isExactly(
      manifest.tasks.map((task) => task.environment),
      environments,
    ),
    "task environments must preserve the coverage order",
  );
  for (const task of manifest.tasks) {
    invariant(
      isExactly(task.architectures, architectures),
      `task ${task.id} has incomplete architecture coverage`,
    );
    invariant(
      task.candidateIds.includes(task.expectedCandidateId),
      `task ${task.id} expected candidate is outside its bounded candidates`,
    );
    invariant(
      task.replayExpectation === "same_projection_same_result",
      `task ${task.id} lacks a replay contract`,
    );
    invariant(
      task.staleStateCase,
      `task ${task.id} lacks stale-state coverage`,
    );
  }
}

export function validateTrace(trace, manifest) {
  invariant(trace.schemaVersion === "1", "trace schemaVersion must be 1");
  invariant(
    trace.manifestId === manifest.manifestId,
    "trace references another manifest",
  );
  const task = manifest.tasks.find(
    (candidate) => candidate.id === trace.taskId,
  );
  invariant(task, "trace task is absent from the manifest");
  invariant(
    task.environment === trace.environment,
    "trace environment drifted",
  );
  invariant(
    task.trustedStateDigest === trace.trustedStateDigest,
    "trace trusted-state digest drifted",
  );
  invariant(
    task.architectures.includes(trace.architecture),
    "trace architecture is not declared by its task",
  );
  if (trace.executionState === "NOT_RUN") {
    invariant(
      trace.outcome.status === "NOT_RUN",
      "NOT_RUN trace has an outcome",
    );
    invariant(trace.outcome.safe === null, "NOT_RUN trace cannot claim safety");
    invariant(
      trace.outcome.replayMatched === null,
      "NOT_RUN trace cannot claim replay",
    );
    invariant(
      trace.outcome.staleRejected === null,
      "NOT_RUN trace cannot claim stale rejection",
    );
    invariant(
      trace.phases.length === 0,
      "NOT_RUN trace cannot contain phase timings",
    );
    return;
  }
  invariant(
    trace.executionState === "COMPLETED",
    "failed traces require a separately retained failure artifact",
  );
  invariant(trace.phases.length > 0, "completed trace has no phase timings");
  invariant(
    trace.phases.every(
      (phase) =>
        typeof phase.durationMs === "number" &&
        Number.isFinite(phase.durationMs) &&
        phase.durationMs >= 0,
    ),
    "completed trace has an invalid duration",
  );
  invariant(
    trace.outcome.status !== "NOT_RUN",
    "completed trace has no outcome",
  );
  for (const field of ["safe", "replayMatched", "staleRejected"])
    invariant(
      typeof trace.outcome[field] === "boolean",
      `completed trace has no ${field} observation`,
    );
}

export function validateResults(result, manifest) {
  invariant(result.schemaVersion === "1", "result schemaVersion must be 1");
  invariant(
    result.manifestId === manifest.manifestId,
    "result references another manifest",
  );
  invariant(
    result.rows.length === environments.length * architectures.length,
    "result matrix must have one row per environment and architecture",
  );
  const expected = new Set(
    environments.flatMap((environment) =>
      architectures.map((architecture) => `${environment}/${architecture}`),
    ),
  );
  const actual = new Set();
  for (const row of result.rows) {
    const key = `${row.environment}/${row.architecture}`;
    invariant(expected.has(key), `unexpected result row ${key}`);
    invariant(!actual.has(key), `duplicate result row ${key}`);
    actual.add(key);
    if (result.executionState === "NOT_RUN") {
      invariant(
        Object.keys(row.phaseTimings).length === 0,
        `NOT_RUN row ${key} cannot contain timings`,
      );
      invariant(
        Object.keys(row.confidenceIntervals).length === 0,
        `NOT_RUN row ${key} cannot contain confidence intervals`,
      );
      for (const name of metricNames)
        invariant(
          row[name] === null,
          `NOT_RUN row ${key} cannot claim ${name}`,
        );
      continue;
    }
    invariant(
      result.executionState === "COMPLETED",
      "failed aggregates require a separately retained failure artifact",
    );
    for (const name of metricNames)
      invariant(
        typeof row[name] === "number" && Number.isFinite(row[name]),
        `completed row ${key} has no finite ${name}`,
      );
    for (const name of rateMetricNames)
      invariant(
        row[name] >= 0 && row[name] <= 1,
        `completed row ${key} has an out-of-range ${name}`,
      );
    const timings = Object.values(row.phaseTimings);
    invariant(timings.length > 0, `completed row ${key} has no timings`);
    for (const timing of timings) {
      invariant(
        timing.samples > 0 && timing.samples <= result.sampleCount,
        `completed row ${key} has invalid timing samples`,
      );
      invariant(
        [timing.p50Ms, timing.p95Ms, timing.p99Ms].every(
          (value) => typeof value === "number" && Number.isFinite(value),
        ) &&
          timing.p50Ms <= timing.p95Ms &&
          timing.p95Ms <= timing.p99Ms,
        `completed row ${key} has unordered timing percentiles`,
      );
    }
    for (const name of rateMetricNames) {
      const interval = row.confidenceIntervals[name];
      invariant(interval, `completed row ${key} has no ${name} interval`);
      invariant(
        interval.lower <= row[name] &&
          row[name] <= interval.upper &&
          interval.lower <= interval.upper,
        `completed row ${key} has an invalid ${name} interval`,
      );
    }
  }
  invariant(actual.size === expected.size, "result matrix has missing rows");
  if (result.executionState === "NOT_RUN")
    invariant(result.sampleCount === 0, "NOT_RUN fixture cannot have samples");
  else invariant(result.sampleCount > 0, "completed result has no samples");
}

export function validateAgainstSchema(schema, value, label) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    allowUnionTypes: true,
  });
  const validate = ajv.compile(schema);
  if (validate(value)) return;
  const detail = (validate.errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("; ");
  throw new TypeError(`${label} does not match its JSON Schema: ${detail}`);
}

export function validateArtifactSet({
  taskSchema,
  traceSchema,
  resultSchema,
  manifest,
  traces,
  result,
}) {
  for (const schema of [taskSchema, traceSchema, resultSchema])
    invariant(
      schema.$schema === "https://json-schema.org/draft/2020-12/schema",
      "schema is not a Draft 2020-12 JSON Schema",
    );
  validateAgainstSchema(taskSchema, manifest, "task manifest");
  validateAgainstSchema(resultSchema, result, "result");
  invariant(Array.isArray(traces) && traces.length > 0, "no traces supplied");
  for (const trace of traces) {
    validateAgainstSchema(
      traceSchema,
      trace,
      `trace ${trace?.traceId ?? "unknown"}`,
    );
    validateTrace(trace, manifest);
    invariant(
      result.executionState === trace.executionState,
      "trace and aggregate execution states disagree",
    );
  }
  invariant(
    (manifest.evidenceState === "NOT_RUN") ===
      (result.executionState === "NOT_RUN"),
    "manifest and result evidence states disagree",
  );
  validateManifest(manifest);
  validateResults(result, manifest);
  if (result.executionState === "NOT_RUN") {
    invariant(
      traces.length === 1,
      "NOT_RUN fixture must contain one trace envelope",
    );
    return;
  }
  invariant(
    manifest.evidenceState === "RETAINED" ||
      manifest.evidenceState === "LOCAL_EXPLORATORY",
    "completed evidence needs an explicit retained or exploratory state",
  );
  invariant(
    traces.length === result.rows.length * result.sampleCount,
    "completed trace count does not cover every matrix cell and sample",
  );
  const traceIds = new Set();
  const counts = new Map();
  for (const trace of traces) {
    invariant(
      !traceIds.has(trace.traceId),
      `duplicate trace id ${trace.traceId}`,
    );
    traceIds.add(trace.traceId);
    const key = `${trace.environment}/${trace.architecture}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const row of result.rows) {
    const key = `${row.environment}/${row.architecture}`;
    invariant(
      counts.get(key) === result.sampleCount,
      `completed traces do not cover ${key}`,
    );
  }
}

function reportCell(result, environment, architecture) {
  if (result.executionState === "NOT_RUN") return "NOT RUN";
  const row = result.rows.find(
    (candidate) =>
      candidate.environment === environment &&
      candidate.architecture === architecture,
  );
  invariant(row, `missing report row ${environment}/${architecture}`);
  return `COMPLETED · success ${(row.successRate * 100).toFixed(1)}% · safe ${(row.safeOutcomeRate * 100).toFixed(1)}%`;
}

export function renderReport(manifest, result) {
  const rows = environments
    .map(
      (environment) =>
        `| ${environment} | ${architectures.map((architecture) => reportCell(result, environment, architecture)).join(" | ")} |`,
    )
    .join("\n");
  const resultSummary =
    result.executionState === "NOT_RUN"
      ? `${result.rows.length} comparison cells are defined; none has been executed.`
      : `${result.rows.length} comparison cells passed artifact validation with ${result.sampleCount} trace sample(s) per cell.`;
  const measurementNote =
    result.executionState === "NOT_RUN"
      ? "These fixture rows have zero samples, so all values are null rather than zero."
      : "Every displayed cell is backed by schema-valid aggregate metrics and the declared number of retained per-cell traces.";
  return `# Tool-environment benchmark ${result.executionState === "NOT_RUN" ? "scaffold" : "report"}\n\nEvidence: \`${manifest.evidenceState}\`\nExecution: \`${result.executionState}\`\nManifest: \`${manifest.manifestId}\`\n\n| Environment | Direct deterministic | Host planner only | Host planner + Jev gate |\n| --- | --- | --- | --- |\n${rows}\n\n## Measurement contract\n\nA retained execution must report per-phase p50, p95, and p99 monotonic durations; success, safe-outcome, replay-pass, and stale-rejection rates; token and cost accounting; and 95% confidence intervals with method and independent-group count. ${measurementNote}\n\n## Safety boundary\n\nJev remains advisory typed evidence. A trusted host must validate the bounded candidate list, trusted-state freshness, policy, and ticket before any browser or desktop action executes.\n\n## Result state\n\n${resultSummary}`;
}

function selectedArtifactDirectory(arguments_) {
  if (arguments_.length === 0) return null;
  if (
    arguments_.length !== 2 ||
    arguments_[0] !== "--artifacts-dir" ||
    !arguments_[1]
  )
    throw new TypeError(
      "Usage: validate-and-report.mjs [--artifacts-dir PATH]",
    );
  return resolve(arguments_[1]);
}

async function loadArtifactSet(artifactDirectory) {
  if (!artifactDirectory)
    return {
      manifest: await readJson("fixtures/task-manifest.not-run.jsonc"),
      traces: [await readJson("fixtures/trace.not-run.jsonc")],
      result: await readJson("fixtures/result.not-run.jsonc"),
    };
  const traceDirectory = join(artifactDirectory, "traces");
  const entries = await readdir(traceDirectory, { withFileTypes: true });
  const traceFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  invariant(
    traceFiles.length > 0,
    "artifact directory contains no JSON traces",
  );
  return {
    manifest: await readJsonPath(join(artifactDirectory, "task-manifest.json")),
    traces: await Promise.all(
      traceFiles.map((file) => readJsonPath(join(traceDirectory, file))),
    ),
    result: await readJsonPath(join(artifactDirectory, "result.json")),
  };
}

async function main() {
  const artifactDirectory = selectedArtifactDirectory(process.argv.slice(2));
  const [taskSchema, traceSchema, resultSchema, artifacts] = await Promise.all([
    readJson("schema/task-manifest.schema.jsonc"),
    readJson("schema/trace.schema.jsonc"),
    readJson("schema/result.schema.jsonc"),
    loadArtifactSet(artifactDirectory),
  ]);
  const { manifest, traces, result } = artifacts;
  validateArtifactSet({
    taskSchema,
    traceSchema,
    resultSchema,
    manifest,
    traces,
    result,
  });
  process.stdout.write(`${renderReport(manifest, result)}\n`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();

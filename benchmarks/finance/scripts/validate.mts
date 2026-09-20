import { createHash } from "node:crypto";
import { lstat, open, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  aggregateFinanceBenchmarkTraces,
  financeArchitectures,
  financeTracks,
  stableJson,
  type FinanceBenchmarkCell,
  type FinanceBenchmarkTrace,
} from "../../../packages/evals/src/index.js";
import {
  financeCaseStateDigest,
  loadFinanceDataset,
  type FinanceRuntimeProvenance,
  type FinanceBenchmarkCase,
} from "./run.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const maximumArtifactBytes = 100 * 1024 * 1024;

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

type FinanceRunMetricName = keyof FinanceBenchmarkCell["metrics"];

interface FinanceRunRow {
  readonly track: string;
  readonly architecture: string;
  readonly sampleCount: number;
  readonly calibrationStatus: "NOT_RUN" | "measured" | "unavailable";
  readonly calibrationReason: "no_measured_route_question_distributions" | null;
  readonly accountingStatus: "NOT_RUN" | "MEASURED" | "UNMETERED";
  readonly accountingReason: "unmetered_attempt" | null;
  readonly metrics: Readonly<Record<FinanceRunMetricName, number | null>>;
}

interface FinanceRunDocument {
  readonly runId: string;
  readonly executionState: "NOT_RUN" | "COMPLETED";
  readonly sampleCount: number;
  readonly traceCount: number;
  readonly traceSetHash: string | null;
  readonly dataset: FinanceRunDataset;
  readonly runtime: FinanceRuntimeProvenance;
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
          row.accountingStatus === "NOT_RUN" &&
          row.accountingReason === null,
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
    invariant(
      row.metrics.p50Ms <= row.metrics.p95Ms,
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
    if (row.accountingStatus === "MEASURED")
      invariant(
        row.accountingReason === null &&
          Number.isSafeInteger(row.metrics.inputTokens) &&
          row.metrics.inputTokens >= 0 &&
          finite(row.metrics.estimatedCostUsd),
        `completed row ${key} has invalid accounting evidence`,
      );
    else
      invariant(
        row.accountingStatus === "UNMETERED" &&
          row.accountingReason === "unmetered_attempt" &&
          row.metrics.inputTokens === null &&
          row.metrics.estimatedCostUsd === null,
        `completed row ${key} must preserve unknown accounting`,
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
    return;
  }
  invariant(run.sampleCount > 0, "completed finance run requires samples");
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
    Date.parse(run.dataset.trainEnd) < Date.parse(run.dataset.testStart),
    "finance dataset must use a forward time split",
  );
  invariant(
    run.traceCount === financeArchitectures.length * run.sampleCount &&
      typeof run.traceSetHash === "string",
    "completed finance run requires one retained trace per architecture and test case",
  );
  invariant(
    run.rows.reduce(
      (total: number, row: { sampleCount: number }) => total + row.sampleCount,
      0,
    ) === run.traceCount,
    "finance row sample counts do not match traceCount",
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
}

export async function validateFinanceArtifactDirectory(
  directory: string,
): Promise<void> {
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
  const testCases = dataset.cases.filter((entry) => entry.split === "test");
  validateTraceCoverage(run, traces, testCases);
  const rows = aggregateFinanceBenchmarkTraces(
    traces as unknown as readonly FinanceBenchmarkTrace[],
  );
  invariant(
    stableJson(rows) === stableJson(run.rows),
    "finance aggregate rows do not match retained traces",
  );
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
        trace.goldRoute === entry.goldRoute &&
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
          (component: Record<string, unknown>, index: number) =>
            component.role === expectedRoles[architecture]?.[index] &&
            [
              component.providerId,
              component.modelId,
              component.modelVersion,
            ].every((field) => typeof field === "string" && field.length > 0),
        ),
      `finance ${architecture} component provenance is invalid`,
    );
  }
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

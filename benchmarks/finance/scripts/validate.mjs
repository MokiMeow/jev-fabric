import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tracks = [
  "market_surveillance",
  "visual_evidence",
  "financial_text_triage",
];
const architectures = [
  "deterministic_only",
  "host_model_only",
  "jev_advisory",
  "host_plus_jev",
];

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

export function validateFinanceRun(run) {
  invariant(
    run.executionState === "NOT_RUN" || run.executionState === "COMPLETED",
    "finance executionState is invalid",
  );
  const expected = new Set(
    tracks.flatMap((track) =>
      architectures.map((architecture) => `${track}/${architecture}`),
    ),
  );
  const actual = new Set();
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
    if (run.executionState === "NOT_RUN")
      invariant(
        Object.values(row.metrics).every((value) => value === null),
        `NOT_RUN row ${key} cannot claim metrics`,
      );
    else {
      invariant(
        Object.values(row.metrics).every(
          (value) => typeof value === "number" && Number.isFinite(value),
        ),
        `completed row ${key} must contain finite metrics`,
      );
      invariant(
        row.metrics.p50Ms <= row.metrics.p95Ms,
        `completed row ${key} has unordered latency`,
      );
      invariant(
        row.metrics.unsafeExecutionAttemptRate === 0,
        `completed row ${key} attempted financial execution`,
      );
    }
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
  } else {
    invariant(run.sampleCount > 0, "completed finance run requires samples");
    invariant(
      run.dataset.status === "RETAINED",
      "completed finance run requires retained dataset metadata",
    );
    invariant(
      Date.parse(run.dataset.trainEnd) < Date.parse(run.dataset.testStart),
      "finance dataset must use a forward time split",
    );
    invariant(
      run.traceCount === run.rows.length * run.sampleCount &&
        typeof run.traceSetHash === "string",
      "completed finance run requires one retained trace per matrix cell and sample",
    );
    invariant(
      Object.values(run.runtime).every(
        (value) => typeof value === "string" && value.length > 0,
      ),
      "completed finance run requires runtime provenance",
    );
  }
  return run;
}

export function validateAgainstSchema(schema, value) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    validateFormats: false,
  });
  const validate = ajv.compile(schema);
  if (validate(value)) return;
  throw new TypeError(
    (validate.errors ?? [])
      .map((error) => `${error.instancePath || "/"} ${error.message}`)
      .join("; "),
  );
}

async function main() {
  const [schema, fixture] = await Promise.all([
    readFile(join(root, "schema/run.schema.jsonc"), "utf8").then(JSON.parse),
    readFile(join(root, "fixtures/run.not-run.jsonc"), "utf8").then(JSON.parse),
  ]);
  validateAgainstSchema(schema, fixture);
  validateFinanceRun(fixture);
  process.stdout.write(
    "finance benchmark: NOT RUN (12 comparison cells validated)\n",
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();

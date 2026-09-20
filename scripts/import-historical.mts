/** Imports only the reviewed laboratory summaries, never arbitrary source trees. */
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";

const approved = new Set([
  "DEEP_REGRESSION_RESULTS.json",
  "ADVANCED_PATTERN_RESULTS.json",
]);
const approvedFields: Readonly<Record<string, ReadonlySet<string>>> = {
  "DEEP_REGRESSION_RESULTS.json": new Set([
    "batch_curve",
    "call_errors",
    "concurrency_curve",
    "consistency",
    "exact_tasks_jev_should_not_own",
    "hybrid_economics",
    "main_application_suite",
    "metadata",
    "model_alias_check",
    "overall_live_usage",
    "robustness",
  ]),
  "ADVANCED_PATTERN_RESULTS.json": new Set([
    "performance",
    "rag_composition",
    "security_multilabel",
    "veto_composition",
  ]),
};
const secretPattern =
  /(?:api[_-]?key|authorization|bearer\s+|password|secret|token)\s*[:=]|\b(?:sk|ts|jev)_[A-Za-z0-9_-]{16,}\b|(?:^|[^A-Za-z0-9_-])apikey_[A-Za-z0-9_-]{32,}(?=$|[^A-Za-z0-9_-])/i;
const absolutePath = /(?:[A-Za-z]:\\|\\\\|\/(?:Users|home|var|etc)\/)/;
const hostnamePattern = /(?:https?:\/\/|\b(?:host|hostname)\s*[:=])/i;
const bareHostPattern =
  /^(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|(?:[a-z0-9-]+\.)+[a-z]{2,})$/i;
const normalizedKey = (key: string) =>
  key.toLowerCase().replace(/[^a-z0-9]/g, "");
const secretKeys = new Set([
  "apikey",
  "authorization",
  "token",
  "accesstoken",
  "password",
  "secret",
  "cookie",
  "setcookie",
  "bearer",
]);
const hostKeys = new Set([
  "host",
  "hostname",
  "url",
  "uri",
  "endpoint",
  "baseurl",
  "origin",
]);
const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const stable = (value: unknown) => `${JSON.stringify(sort(value), null, 2)}\n`;
const sort = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sort)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value as Record<string, unknown>)
            .sort()
            .map((key) => [key, sort((value as Record<string, unknown>)[key])]),
        )
      : value;
function scrub(value: unknown): unknown {
  if (typeof value === "string") {
    if (secretPattern.test(value) || absolutePath.test(value))
      return "[redacted]";
    return value;
  }
  if (Array.isArray(value)) return value.map(scrub);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        secretPattern.test(key) || /host(name)?/i.test(key)
          ? "[redacted]"
          : key,
        scrub(child),
      ]),
    );
  return value;
}
function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (index < 0 || value === undefined) throw new TypeError(`missing ${name}`);
  return value;
}
function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== "" && !path.startsWith("..") && !path.includes(":");
}
function assertSafeValue(value: unknown, name: string, parentKey = ""): void {
  if (typeof value === "string") {
    if (
      secretPattern.test(value) ||
      absolutePath.test(value) ||
      hostnamePattern.test(value) ||
      bareHostPattern.test(value.trim())
    )
      throw new TypeError(
        `refusing secret-, path-, or hostname-bearing source: ${name}`,
      );
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) assertSafeValue(child, name, parentKey);
    return;
  }
  if (value !== null && typeof value === "object")
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const normalized = normalizedKey(key);
      const isProbabilityLabel =
        normalizedKey(parentKey) === "probabilities" &&
        typeof child === "number";
      if (
        (!isProbabilityLabel && secretKeys.has(normalized)) ||
        hostKeys.has(normalized)
      )
        throw new TypeError(
          `refusing secret-, path-, or hostname-bearing source: ${name}`,
        );
      assertSafeValue(child, name, key);
    }
}
const source = resolve(argument("--source"));
const output = resolve(argument("--output"));
const sourceRealPath = await realpath(source);
const inputs = [...approved].sort();
const provenance: Array<{ name: string; sha256: string }> = [];
for (const name of inputs) {
  const path = resolve(source, name);
  if (basename(path) !== name || !approved.has(basename(path)))
    throw new TypeError("unapproved historical artifact");
  const stat = await lstat(path);
  if (stat.isSymbolicLink())
    throw new TypeError(`refusing symlinked historical artifact: ${name}`);
  const resolvedPath = await realpath(path);
  if (!isInside(sourceRealPath, resolvedPath))
    throw new TypeError(`historical artifact escapes source root: ${name}`);
  const raw = await readFile(path);
  const text = raw.toString("utf8");
  if (
    secretPattern.test(text) ||
    absolutePath.test(text) ||
    hostnamePattern.test(text)
  )
    throw new TypeError(
      `refusing secret-, path-, or hostname-bearing source: ${name}`,
    );
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw new TypeError(`invalid historical JSON object: ${name}`);
  const fields = approvedFields[name];
  if (
    fields === undefined ||
    Object.keys(parsed as Record<string, unknown>).some(
      (field) => !fields.has(field),
    )
  )
    throw new TypeError(`unapproved historical JSON field: ${name}`);
  assertSafeValue(parsed, name);
  provenance.push({ name, sha256: sha256(raw) });
}
await mkdir(output, { recursive: true });
const cases = "";
const datasetDigest = sha256(cases);
const correction =
  "Prior ECE used TypeSafe confidence, not max(distribution); it is invalid as probability calibration. No ECE recomputed because this import does not export raw distributions/outcomes.";
const manifest = {
  schemaVersion: "1",
  evidence: "local_exploratory",
  git: { sha: "historical", dirty: false },
  versions: {
    package: "historical-import-v1",
    provider: "typesafe-jev",
    model: "jev-1.13.0",
    prompt: "historical-unversioned",
    pack: "historical-unversioned",
    policy: "historical-unversioned",
  },
  datasetDigest,
  splitRule: "historical development-only; no held-out claim",
  groupRule: "historical grouping unavailable",
  runId: "historical-v0",
  environmentId: "historical-redacted",
  seed: 1,
  budget: { maxCalls: 0, maxAttempts: 0 },
  concurrency: 1,
  environment: {
    runtime: "historical",
    os: "redacted",
    arch: "redacted",
    machine: "redacted",
  },
  startedAt: "1970-01-01T00:00:00.000Z",
  reportTitle: "Historical local exploratory import",
  provenance,
  correction,
};
const metrics = { schemaVersion: "1", values: { historicalEce: null } };
const report =
  "# Historical local exploratory import\n\nEvidence: `local_exploratory`\n\nRun: `historical\\-v0`\nEnvironment: `historical\\-redacted`\n\n| Metric | Value |\n| --- | --- |\n| historicalEce | NA / NOT RUN |\n\n## Versions\n\n- model: jev\\-1\\.13\\.0\n- pack: historical\\-unversioned\n- package: historical\\-import\\-v1\n- policy: historical\\-unversioned\n- prompt: historical\\-unversioned\n- provider: typesafe\\-jev\n\n## Denominators\n\n- cases: 0\n\n## Outcome accounting\n\n- abstentions: 0\n- independent groups: 0\n- invalid responses: 0\n\n## Limitations\n\n- historical development\\-only; no held\\-out claim\n- historical grouping unavailable\n\nCorrection: Prior ECE used TypeSafe confidence, not max\\(distribution\\); it is invalid as probability calibration\\. No ECE recomputed because this import does not export raw distributions/outcomes\\.\n";
const files: Record<string, string> = {
  "cases.jsonl": cases,
  "attempts.jsonl": "",
  "decisions.jsonl": "",
  "outcomes.jsonl": "",
  "metrics.json": stable(metrics),
  "calibration.json": stable({
    schemaVersion: "1",
    status: "NOT RUN",
    reason:
      "historical raw distributions/outcomes unavailable in approved sanitized import",
  }),
  "conformance.json": stable({
    schemaVersion: "1",
    status: "NOT RUN",
    evidence: "local_exploratory",
  }),
  "report.md": report,
};
const contentType = (name: string) =>
  name.endsWith(".jsonl")
    ? "application/jsonl"
    : name.endsWith(".md")
      ? "text/markdown"
      : "application/json";
const key = (name: string) => name.replace(/\.jsonl$|\.json$|\.md$/, "");
const artifacts = Object.fromEntries(
  Object.entries(files).map(([name, content]) => [
    key(name),
    {
      schemaVersion: "1",
      digest: sha256(content),
      bytes: Buffer.byteLength(content),
      contentType: contentType(name),
    },
  ]),
);
files["manifest.json"] = stable(scrub({ ...manifest, artifacts }));
for (const [name, content] of Object.entries(files))
  await writeFile(resolve(output, name), content, "utf8");

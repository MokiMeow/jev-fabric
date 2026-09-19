import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  artifactFileNames,
  parseManifest,
  sha256,
  stableJson,
  type RunManifest,
} from "./manifest.js";
import { renderReport } from "./report.js";
const jsonEnvelopeSchema = z.object({ schemaVersion: z.literal("1") }).strict();
const metricsSchema = z
  .object({
    schemaVersion: z.literal("1"),
    values: z.record(z.string(), z.number().finite().nullable()),
  })
  .strict();
const jsonlSchema = z
  .object({ schemaVersion: z.literal("1"), id: z.string().min(1) })
  .strict();
const calibrationSchema = z
  .object({
    schemaVersion: z.literal("1"),
    status: z.string(),
    reason: z.string().optional(),
  })
  .strict();
const conformanceSchema = z
  .object({
    schemaVersion: z.literal("1"),
    status: z.string(),
    evidence: z.string().optional(),
  })
  .strict();
export interface ReplayResult {
  readonly manifest: RunManifest;
  readonly metrics: Readonly<Record<string, number | null>>;
  readonly report: string;
  readonly digest: string;
}
const descriptorKey = (file: string) =>
  file.replace(/\.jsonl$|\.json$|\.md$/, "") as keyof RunManifest["artifacts"];
/** Offline, bounded, strict replay. No transport or network capability is accepted. */
export async function replayArtifacts(
  directory: string,
  maxBytes = 10_000_000,
): Promise<ReplayResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new TypeError("maxBytes must be positive");
  const present = new Set(await readdir(directory));
  if (present.size !== artifactFileNames.length + 1)
    throw new TypeError("unexpected or missing artifact files");
  if (!present.has("manifest.json"))
    throw new TypeError("missing artifact: manifest.json");
  const manifestBytes = await readFile(join(directory, "manifest.json"));
  if (manifestBytes.length > maxBytes)
    throw new TypeError("manifest too large");
  const manifest = parseManifest(JSON.parse(manifestBytes.toString("utf8")));
  const contents = new Map<string, Uint8Array>();
  for (const file of artifactFileNames) {
    if (!present.has(file)) throw new TypeError(`missing artifact: ${file}`);
    const bytes = await readFile(join(directory, file));
    if (bytes.length > maxBytes)
      throw new TypeError(`artifact too large: ${file}`);
    const descriptor = manifest.artifacts[descriptorKey(file)];
    if (
      descriptor.bytes !== bytes.length ||
      descriptor.digest !== sha256(bytes)
    )
      throw new TypeError(`artifact digest mismatch: ${file}`);
    contents.set(file, bytes);
    validateArtifact(file, bytes);
  }
  const cases = contents.get("cases.jsonl");
  if (cases === undefined) throw new TypeError("missing cases artifact");
  if (sha256(cases) !== manifest.datasetDigest)
    throw new TypeError("dataset digest mismatch");
  const metrics = metricsSchema.parse(
    JSON.parse(new TextDecoder().decode(contents.get("metrics.json"))),
  ).values;
  const expected = renderReport({
    title: manifest.reportTitle ?? "Jev Fabric replay",
    evidence: manifest.evidence,
    metrics,
    runId: manifest.runId,
    environmentId: manifest.environmentId,
    versions: manifest.versions,
    denominators: { cases: 0 },
    independentGroups: 0,
    invalidResponses: 0,
    abstentions: 0,
    limitations: [manifest.splitRule, manifest.groupRule],
    ...(manifest.correction === undefined ? {} : { note: manifest.correction }),
  });
  const recorded = new TextDecoder().decode(contents.get("report.md"));
  if (recorded !== expected)
    throw new TypeError(
      "report is not deterministic or does not match artifacts",
    );
  return {
    manifest,
    metrics,
    report: expected,
    digest: sha256(stableJson({ manifest, metrics, report: expected })),
  };
}
function validateArtifact(file: string, bytes: Uint8Array): void {
  const text = new TextDecoder().decode(bytes);
  if (file.endsWith(".jsonl")) {
    for (const line of text.split("\n"))
      if (line) jsonlSchema.parse(JSON.parse(line));
    return;
  }
  if (file === "metrics.json") {
    metricsSchema.parse(JSON.parse(text));
    return;
  }
  if (file === "calibration.json") {
    calibrationSchema.parse(JSON.parse(text));
    return;
  }
  if (file === "conformance.json") {
    conformanceSchema.parse(JSON.parse(text));
    return;
  }
  if (file === "report.md") return;
  jsonEnvelopeSchema.parse(JSON.parse(text));
}

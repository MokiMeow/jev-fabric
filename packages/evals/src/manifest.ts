import { createHash } from "node:crypto";
import { z } from "zod";
export const evidenceLabelSchema = z.enum([
  "unit",
  "conformance",
  "replay",
  "local_exploratory",
  "live",
]);
export type EvidenceLabel = z.infer<typeof evidenceLabelSchema>;
export const artifactFileNames = [
  "cases.jsonl",
  "attempts.jsonl",
  "decisions.jsonl",
  "outcomes.jsonl",
  "metrics.json",
  "calibration.json",
  "conformance.json",
  "report.md",
] as const;
export type ArtifactFileName = (typeof artifactFileNames)[number];
export const artifactDescriptorSchema = z
  .object({
    schemaVersion: z.literal("1"),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().nonnegative(),
    contentType: z.enum([
      "application/json",
      "application/jsonl",
      "text/markdown",
    ]),
  })
  .strict();
export const artifactManifestSchema = z
  .object({
    cases: artifactDescriptorSchema,
    attempts: artifactDescriptorSchema,
    decisions: artifactDescriptorSchema,
    outcomes: artifactDescriptorSchema,
    metrics: artifactDescriptorSchema,
    calibration: artifactDescriptorSchema,
    conformance: artifactDescriptorSchema,
    report: artifactDescriptorSchema,
  })
  .strict();
export const manifestSchema = z
  .object({
    schemaVersion: z.literal("1"),
    runId: z.string().min(1),
    environmentId: z.string().min(1),
    evidence: evidenceLabelSchema,
    git: z
      .object({
        sha: z.string().min(7),
        dirty: z.boolean(),
        dirtyDigest: z.string().optional(),
      })
      .strict(),
    versions: z
      .object({
        package: z.string().min(1),
        provider: z.string().min(1),
        model: z.string().min(1),
        prompt: z.string().min(1),
        pack: z.string().min(1),
        policy: z.string().min(1),
      })
      .strict(),
    datasetDigest: z.string().regex(/^[a-f0-9]{64}$/),
    splitRule: z.string().min(1),
    groupRule: z.string().min(1),
    seed: z
      .number()
      .int()
      .refine((value) => value !== 0, "seed must be non-zero"),
    budget: z
      .object({
        maxCalls: z.number().int().nonnegative(),
        maxAttempts: z.number().int().nonnegative(),
      })
      .strict(),
    concurrency: z.number().int().positive(),
    environment: z
      .object({
        runtime: z.string().min(1),
        os: z.string().min(1),
        arch: z.string().min(1),
        machine: z.string().min(1),
      })
      .strict(),
    startedAt: z.string().datetime({ offset: false }),
    artifacts: artifactManifestSchema,
    reportTitle: z.string().min(1).optional(),
    provenance: z
      .array(
        z
          .object({
            name: z.string().min(1),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .optional(),
    correction: z.string().min(1).optional(),
  })
  .strict();
export type RunManifest = z.infer<typeof manifestSchema>;
export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
export function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
export function stableJson(value: unknown): string {
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}
function sort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort(codeUnitCompare)
        .map((key) => [key, sort((value as Record<string, unknown>)[key])]),
    );
  return value;
}
export function parseManifest(value: unknown): RunManifest {
  return manifestSchema.parse(value);
}
export function assertArtifactManifest(value: unknown): RunManifest {
  return parseManifest(value);
}

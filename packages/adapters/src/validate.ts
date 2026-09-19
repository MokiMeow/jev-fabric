import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  assertSafeGeneratedText,
  canonicalAdapterModel,
  parseAdapterModel,
} from "./model.js";
import { validateNativeArtifact } from "./schemas.js";

const ProvenanceManifestSchema = z
  .object({
    schemaVersion: z.string(),
    provenance: z.string(),
    files: z.array(
      z
        .object({
          path: z.string(),
          sha256: z.string().regex(/^[a-f0-9]{64}$/u),
        })
        .strict(),
    ),
  })
  .strict();

function digest(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Reconstructs the generated public catalog without trusting its contents. */
function expectedCompatibility(model: typeof canonicalAdapterModel): unknown {
  return {
    provenance: model.provenance,
    advisory: model.mcp.advisory,
    environmentNames: [...model.mcp.environmentNames].sort(),
    hosts: model.hosts
      .map((host) => ({
        id: host.id,
        displayName: host.displayName,
        configurationPath: host.configurationPath,
        format: host.format,
        install: host.install,
        status: host.testStatus,
        capabilities: host.supports,
        hooks: host.hooks,
        unsupported: [...host.unsupported].sort(),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function assertExactCompatibility(
  model: typeof canonicalAdapterModel,
  content: string,
): void {
  const parsed: unknown = JSON.parse(content);
  if (!sameJson(parsed, expectedCompatibility(model)))
    throw new TypeError("generated compatibility catalog drift");
}

/** Independently validates native host shapes plus the provenance digest sidecar. */
export async function validateGeneratedIntegrations(
  root: string,
): Promise<void> {
  const model = parseAdapterModel(canonicalAdapterModel);
  const rawManifest = await readFile(resolve(root, "provenance.json"), "utf8");
  assertSafeGeneratedText(rawManifest);
  const manifest = ProvenanceManifestSchema.parse(JSON.parse(rawManifest));
  const expectedPaths = new Set([
    ...model.hosts.map((host) => host.configurationPath),
    "compatibility.json",
  ]);
  if (
    manifest.schemaVersion !== model.schemaVersion ||
    manifest.provenance !== model.provenance ||
    manifest.files.length !== expectedPaths.size ||
    new Set(manifest.files.map((file) => file.path)).size !==
      expectedPaths.size ||
    manifest.files.some((file) => !expectedPaths.has(file.path))
  )
    throw new TypeError("invalid provenance manifest");
  const declared = new Map(
    manifest.files.map((file) => [file.path, file.sha256]),
  );
  for (const host of model.hosts) {
    const content = await readFile(
      resolve(root, host.configurationPath),
      "utf8",
    );
    assertSafeGeneratedText(content);
    validateNativeArtifact(model, host, content);
    if (declared.get(host.configurationPath) !== digest(content))
      throw new TypeError(`provenance digest mismatch: ${host.id}`);
  }
  const compatibility = await readFile(
    resolve(root, "compatibility.json"),
    "utf8",
  );
  assertSafeGeneratedText(compatibility);
  assertExactCompatibility(model, compatibility);
  if (declared.get("compatibility.json") !== digest(compatibility))
    throw new TypeError("provenance digest mismatch: compatibility");
}

async function main(): Promise<void> {
  const here = fileURLToPath(new URL(".", import.meta.url));
  await validateGeneratedIntegrations(resolve(here, "../../../integrations"));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();

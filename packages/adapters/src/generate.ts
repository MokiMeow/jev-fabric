import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateClaudeCode } from "./claude.js";
import { generateCodex, stableJson, type GeneratedHost } from "./codex.js";
import { generateGeminiCli } from "./gemini.js";
import { generateKimiCli } from "./kimi.js";
import {
  assertSafeGeneratedText,
  canonicalAdapterModel,
  parseAdapterModel,
  type AdapterModel,
} from "./model.js";
import { generateQwenCode } from "./qwen.js";
import { validateNativeArtifact } from "./schemas.js";

interface GeneratedFile {
  readonly path: string;
  readonly content: string;
}

function outputPath(root: string, path: string): string {
  const output = resolve(root, path);
  const contained = relative(resolve(root), output);
  if (!contained || contained.startsWith("..") || contained.includes(":"))
    throw new TypeError("generated path escapes output directory");
  return output;
}

async function writeGenerated(
  root: string,
  file: GeneratedFile,
): Promise<void> {
  assertSafeGeneratedText(file.content);
  const output = outputPath(root, file.path);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, file.content, "utf8");
}

function digest(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Writes stable native layouts and a digest sidecar for formats without metadata fields. */
export async function generateIntegrations(
  destination: string,
  input: AdapterModel = canonicalAdapterModel,
): Promise<readonly GeneratedHost[]> {
  const model = parseAdapterModel(input);
  const artifacts = [
    generateCodex(model),
    generateClaudeCode(model),
    generateGeminiCli(model),
    generateQwenCode(model),
    generateKimiCli(model),
  ].sort((left, right) => left.host.localeCompare(right.host));
  for (const artifact of artifacts) {
    const host = model.hosts.find(
      (candidate) => candidate.id === artifact.host,
    );
    if (!host) throw new TypeError(`missing generated host: ${artifact.host}`);
    if (artifact.path !== host.configurationPath)
      throw new TypeError(`generator path drift: ${artifact.host}`);
    validateNativeArtifact(model, host, artifact.content);
    await writeGenerated(destination, artifact);
  }
  const compatibility: GeneratedFile = {
    path: "compatibility.json",
    content: stableJson({
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
    }),
  };
  await writeGenerated(destination, compatibility);
  const provenance: GeneratedFile = {
    path: "provenance.json",
    content: stableJson({
      schemaVersion: model.schemaVersion,
      provenance: model.provenance,
      files: [...artifacts, compatibility]
        .map((file) => ({ path: file.path, sha256: digest(file.content) }))
        .sort((left, right) => left.path.localeCompare(right.path)),
    }),
  };
  await writeGenerated(destination, provenance);
  return artifacts;
}

/** Copies one canonical skill tree; test coverage prevents hand-maintained plugin drift. */
export async function syncCanonicalSkill(
  root: string,
  input: AdapterModel = canonicalAdapterModel,
): Promise<void> {
  const model = parseAdapterModel(input);
  const sourceRoot = dirname(outputPath(root, model.skill.path));
  const copied: GeneratedFile[] = [];
  for (const file of model.skill.files) {
    const content = await readFile(resolve(sourceRoot, file), "utf8");
    const generated = {
      path: `${model.skill.pluginPath}/${file}`,
      content,
    };
    copied.push(generated);
    await writeGenerated(root, generated);
  }
  await writeGenerated(root, {
    path: "plugins/jev-fabric/skill-provenance.json",
    content: stableJson({
      provenance: model.provenance,
      source: model.skill.path,
      files: copied.map((file) => ({
        path: file.path,
        sha256: digest(file.content),
      })),
    }),
  });
}

export async function generateRepositoryArtifacts(root: string): Promise<void> {
  await generateIntegrations(
    outputPath(root, canonicalAdapterModel.installationRoot),
  );
  await syncCanonicalSkill(root);
}

async function main(): Promise<void> {
  const here = fileURLToPath(new URL(".", import.meta.url));
  await generateRepositoryArtifacts(resolve(here, "../../.."));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const benchmarkRoot = join(directory, "..");
const supported = new Set([
  "webmcp_declarative",
  "webmcp_imperative",
  "browser_dom_cdp",
  "browser_visual_fallback",
  "blender",
  "godot",
  "freecad",
]);

function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}

function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith("--"))
    throw new TypeError(`${name} requires a value`);
  return resolve(value);
}

async function main() {
  if (!process.argv.includes("--live-inputs"))
    throw new TypeError("explicit --live-inputs acknowledgement is required");
  const output = argument("--output");
  const chrome = argument("--chrome");
  const blender = argument("--blender");
  const godot = argument("--godot");
  const freecad = argument("--freecad");
  const original = JSON.parse(
    await readFile(
      join(benchmarkRoot, "fixtures", "task-manifest.not-run.jsonc"),
      "utf8",
    ),
  );
  const tasks = original.tasks
    .filter((task) => supported.has(task.environment))
    .map((task) => ({
      ...task,
      trustedStateDigest: sha(
        JSON.stringify([
          "jev.tool-environment.local-trusted-state/v1",
          task.id,
          task.environment,
          task.actionClass,
          task.candidateIds,
          task.expectedCandidateId,
        ]),
      ),
    }));
  const manifest = {
    ...original,
    manifestId: "tool-environments-v2-local-seven",
    evidenceState: "LOCAL_EXPLORATORY",
    tasks,
  };
  const node = process.execPath;
  const adapterScript = resolve(directory, "local-adapter.mjs");
  const providerScript = resolve(directory, "provider-callback.mts");
  const adapter = {
    command: node,
    args: [
      adapterScript,
      "--chrome",
      chrome,
      "--blender",
      blender,
      "--godot",
      godot,
      "--freecad",
      freecad,
    ],
  };
  const config = {
    schemaVersion: "jev.tool-environment.live-config/v1",
    adapters: {
      playwright_chrome_webmcp_declarative: adapter,
      playwright_chrome_webmcp_imperative: adapter,
      playwright_chrome_dom_cdp: adapter,
      playwright_chrome_visual_fallback: adapter,
      blender_cli: adapter,
      godot_cli: adapter,
      freecad_cli: adapter,
    },
    hostPlanner: {
      command: node,
      args: [
        "--import",
        "tsx",
        providerScript,
        "--provider",
        "ollama",
        "--model",
        "llama3.2:3b",
      ],
    },
    jevEvaluator: {
      command: node,
      args: ["--import", "tsx", providerScript, "--provider", "jev"],
    },
  };
  await mkdir(output, { recursive: false });
  await Promise.all([
    writeFile(
      join(output, "task-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { flag: "wx" },
    ),
    writeFile(
      join(output, "local-adapters.json"),
      `${JSON.stringify(config, null, 2)}\n`,
      {
        flag: "wx",
      },
    ),
  ]);
  process.stdout.write(
    `${JSON.stringify({ output, environments: tasks.length, comparisonCells: tasks.length * 3, providerCalls: 0 })}\n`,
  );
}

await main();

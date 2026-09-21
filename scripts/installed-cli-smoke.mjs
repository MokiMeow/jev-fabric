import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const installedRoot = resolve(process.argv[2] ?? "");
const workspaceRoot = resolve(process.argv[3] ?? "");
const packageRoot = join(
  installedRoot,
  "node_modules",
  "@mokimeow",
  "jev-fabric-cli",
);
const cli = join(packageRoot, "dist", "bin.js");
const cleanEnvironment = {
  ...(process.platform === "win32"
    ? { SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec }
    : {}),
  PATH: process.env.PATH,
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
};

if (!existsSync(cli)) throw new Error("installed CLI binary is missing");
const localPackages = [
  "cli",
  "core",
  "evals",
  "mcp",
  "packs",
  "protocol",
  "provider-openai-compatible",
  "provider-typesafe",
  "adapters",
];
for (const name of localPackages) {
  const packageDirectory = join(
    installedRoot,
    "node_modules",
    "@mokimeow",
    `jev-fabric-${name}`,
  );
  if (!existsSync(packageDirectory))
    throw new Error(`missing installed local dependency: ${name}`);
}

function assertNoWorkspaceImports(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      assertNoWorkspaceImports(path);
    } else if (/\.(?:[cm]?js|json)$/.test(entry.name)) {
      if (readFileSync(path).includes(Buffer.from(workspaceRoot)))
        throw new Error(
          `installed package contains an absolute workspace import: ${path}`,
        );
    }
  }
}
for (const name of localPackages)
  assertNoWorkspaceImports(
    join(installedRoot, "node_modules", "@mokimeow", `jev-fabric-${name}`),
  );
const installedModules = new Map();
for (const name of localPackages) {
  const module = await import(
    pathToFileURL(
      join(
        installedRoot,
        "node_modules",
        "@mokimeow",
        `jev-fabric-${name}`,
        "dist",
        "index.js",
      ),
    )
  );
  if (Object.keys(module).length === 0)
    throw new Error(`installed package has no importable exports: ${name}`);
  installedModules.set(name, module);
}

const adapters = installedModules.get("adapters");
const webMcpBinding = adapters.bindWebMcpAdvisory(
  {
    origin: "https://tools.example.test",
    frameId: "main",
    toolName: "lookup_record",
    inputSchema: { type: "object", additionalProperties: false },
    policyEpoch: "policy-1",
    stateVersion: "state-1",
  },
  {
    origin: "https://tools.example.test",
    frameId: "main",
    toolName: "lookup_record",
    inputSchema: { type: "object", additionalProperties: false },
  },
);
if (
  webMcpBinding.advisoryOnly !== true ||
  webMcpBinding.execution !== "NOT_SUPPORTED"
)
  throw new Error("installed WebMCP boundary is not advisory-only");
const mcpHandlerBridgeBinding = adapters.bindMcpHandlerWebMcpAdvisory(
  {
    origin: "https://tools.example.test",
    frameId: "main",
    toolName: "lookup_record",
    inputSchema: { type: "object", additionalProperties: false },
    policyEpoch: "policy-1",
    stateVersion: "state-1",
    bridgeRevision: "mcp-handler-2.2.0",
    endpointPath: "/api/mcp",
    exposedTools: ["lookup_record"],
    readOnlyToolNames: ["lookup_record"],
    credentials: "same-origin",
    requireSameOriginFetch: true,
  },
  {
    origin: "https://tools.example.test",
    frameId: "main",
    toolName: "lookup_record",
    inputSchema: { type: "object", additionalProperties: false },
    scriptUrl: "https://tools.example.test/api/mcp?webmcp-script",
    readOnlyHint: true,
  },
);
if (
  mcpHandlerBridgeBinding.authority !== "NONE" ||
  mcpHandlerBridgeBinding.execution !== "NOT_SUPPORTED"
)
  throw new Error("installed mcp-handler bridge boundary is not advisory-only");

const typeSafeProvider = installedModules.get("provider-typesafe");
const gatewayProvider = new typeSafeProvider.TypeSafeProvider({
  id: typeSafeProvider.VERCEL_GATEWAY_JEV_PROVIDER_ID,
  model: typeSafeProvider.VERCEL_GATEWAY_JEV_MODEL,
  approvedModels: [typeSafeProvider.VERCEL_GATEWAY_JEV_MODEL],
  client: {
    systemOne: async () => ({
      model: "typesafe-ai/jev",
      usage: { input_tokens: 1, output_tokens: 0 },
      answers: {
        choice_1: {
          type: "choice",
          choice: "a",
          probabilities: { a: 1, b: 0 },
          confidence: 1,
        },
      },
    }),
  },
});
const gatewayResult = await gatewayProvider.evaluate({
  id: "packed-gateway-smoke",
  state: { fixture: true },
  questions: [
    {
      id: "choice_1",
      type: "choice",
      instructions: "Choose the fixture answer",
      criteria: { a: "Expected", b: "Unexpected" },
      options: ["a", "b"],
    },
  ],
});
if (gatewayResult.model !== "typesafe-ai/jev")
  throw new Error("installed Gateway mapping did not preserve model identity");
const evaluationProvider =
  typeSafeProvider.createVercelGatewayEvaluationJevProvider({
    apiKey: "installed-package-construction-only",
  });
if (
  evaluationProvider.id !== "typesafe-vercel-gateway-evaluate" ||
  typeSafeProvider.VERCEL_GATEWAY_EVALUATION_URL !==
    "https://ai-gateway.vercel.sh/v1/evaluate"
)
  throw new Error("installed Gateway Evaluation export drifted");
if ("createPinnedVercelGatewayEvaluationJevProvider" in typeSafeProvider)
  throw new Error("installed package exposed the private endpoint test seam");

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: installedRoot,
    env: cleanEnvironment,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `installed jev-fabric ${args.join(" ")} exited ${result.status}: ${result.stdout}${result.stderr}`,
    );
  if (result.stderr !== "")
    throw new Error(`installed jev-fabric wrote stderr: ${result.stderr}`);
  return result.stdout;
}
function json(args) {
  return JSON.parse(run([...args, "--json"]));
}

if (!run(["--help"]).includes("jev-fabric <command>"))
  throw new Error("installed help output is unstable");
if (run(["--version"]).trim() !== "0.1.0-alpha.1")
  throw new Error("installed version output is unstable");
if (json(["doctor"]).network !== "not_used")
  throw new Error("doctor must remain offline");
if (json(["evaluate"]).mode !== "offline")
  throw new Error("evaluate must remain offline");
if (json(["benchmark"]).mode !== "offline")
  throw new Error("benchmark must remain offline");
if (json(["adapters", "validate"]).status !== "VALID")
  throw new Error("adapter contract validation failed");

const replayDirectory = join(installedRoot, "replay-fixture");
mkdirSync(replayDirectory, { recursive: true });
const evals = await import(
  pathToFileURL(
    join(
      installedRoot,
      "node_modules",
      "@mokimeow",
      "jev-fabric-evals",
      "dist",
      "index.js",
    ),
  )
);
const contents = {
  "cases.jsonl": '{"schemaVersion":"1","id":"case-1"}\n',
  "attempts.jsonl": '{"schemaVersion":"1","id":"attempt-1"}\n',
  "decisions.jsonl": '{"schemaVersion":"1","id":"decision-1"}\n',
  "outcomes.jsonl": '{"schemaVersion":"1","id":"outcome-1"}\n',
  "metrics.json": '{"schemaVersion":"1","values":{"accuracy":1}}\n',
  "calibration.json": '{"schemaVersion":"1","status":"not_applicable"}\n',
  "conformance.json": '{"schemaVersion":"1","status":"passed"}\n',
};
const report = evals.renderReport({
  title: "Packed replay",
  evidence: "unit",
  metrics: { accuracy: 1 },
  runId: "packed-replay",
  environmentId: "packed",
  versions: {
    package: "0.1",
    provider: "scripted",
    model: "scripted",
    prompt: "v1",
    pack: "v1",
    policy: "v1",
  },
  denominators: { cases: 0 },
  independentGroups: 0,
  invalidResponses: 0,
  abstentions: 0,
  limitations: ["split", "group"],
});
contents["report.md"] = report;
for (const [file, content] of Object.entries(contents))
  writeFileSync(join(replayDirectory, file), content);
const descriptor = (file, contentType) => ({
  schemaVersion: "1",
  digest: evals.sha256(contents[file]),
  bytes: Buffer.byteLength(contents[file]),
  contentType,
});
writeFileSync(
  join(replayDirectory, "manifest.json"),
  JSON.stringify({
    schemaVersion: "1",
    runId: "packed-replay",
    environmentId: "packed",
    evidence: "unit",
    git: { sha: "abcdef0", dirty: false },
    versions: {
      package: "0.1",
      provider: "scripted",
      model: "scripted",
      prompt: "v1",
      pack: "v1",
      policy: "v1",
    },
    datasetDigest: evals.sha256(contents["cases.jsonl"]),
    splitRule: "split",
    groupRule: "group",
    seed: 1,
    budget: { maxCalls: 0, maxAttempts: 0 },
    concurrency: 1,
    environment: {
      runtime: "node",
      os: "test",
      arch: "test",
      machine: "test",
    },
    startedAt: "2026-01-01T00:00:00.000Z",
    reportTitle: "Packed replay",
    artifacts: {
      cases: descriptor("cases.jsonl", "application/jsonl"),
      attempts: descriptor("attempts.jsonl", "application/jsonl"),
      decisions: descriptor("decisions.jsonl", "application/jsonl"),
      outcomes: descriptor("outcomes.jsonl", "application/jsonl"),
      metrics: descriptor("metrics.json", "application/json"),
      calibration: descriptor("calibration.json", "application/json"),
      conformance: descriptor("conformance.json", "application/json"),
      report: descriptor("report.md", "text/markdown"),
    },
  }),
);
if (json(["replay", "--directory", replayDirectory]).mode !== "offline")
  throw new Error("replay must remain offline");

/**
 * Local, deliberately narrow tool-environment benchmark runner.
 *
 * This runner is not a browser/DCC automation implementation.  It invokes
 * explicitly configured local adapter processes and preserves only hashes of
 * their input/output.  An adapter must perform the real interaction and emit
 * the small, typed result described in the README.  That keeps WebMCP, CDP,
 * visual, and DCC transport code outside the benchmark's trusted publisher.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  executionEvidenceDigest,
  providerCallBindingDigest,
  recomputeToolEnvironmentRows,
  replayCheckEvidenceDigest,
  staleCheckEvidenceDigest,
  traceDecisionDigest,
  validateAgainstSchema,
  validateArtifactSet,
  validateManifest,
} from "./validate-and-report.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const root = join(directory, "..");
const architectures = [
  "direct_deterministic",
  "host_planner_only",
  "host_planner_jev_gate",
];
const adapterByEnvironment = Object.freeze({
  webmcp_declarative: "playwright_chrome_webmcp_declarative",
  webmcp_imperative: "playwright_chrome_webmcp_imperative",
  browser_dom_cdp: "playwright_chrome_dom_cdp",
  browser_visual_fallback: "playwright_chrome_visual_fallback",
  blender: "blender_cli",
  godot: "godot_cli",
  freecad: "freecad_cli",
});
const unsupported = new Set(["unity", "unreal_engine"]);
const maxProcessBytes = 64 * 1024;

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function jsonDigest(value) {
  return sha256(JSON.stringify(value));
}

function canonicalUtcNow() {
  return new Date().toISOString();
}

function numberArgument(value, name, minimum, maximum) {
  const parsed = Number(value);
  invariant(
    Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum,
    `${name} must be an integer in ${minimum}..${maximum}`,
  );
  return parsed;
}

function parseArguments(argv) {
  const values = new Map();
  let live = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--live") {
      invariant(!live, "--live was supplied more than once");
      live = true;
      continue;
    }
    invariant(argument?.startsWith("--"), "unknown live-runner argument");
    const value = argv[index + 1];
    invariant(
      value && !value.startsWith("--"),
      `missing value for ${argument}`,
    );
    invariant(!values.has(argument), `${argument} was supplied more than once`);
    values.set(argument, value);
    index += 1;
  }
  invariant(live, "refusing live benchmark without explicit --live");
  const required = [
    "--artifacts-dir",
    "--config",
    "--manifest",
    "--samples",
    "--max-provider-calls",
    "--max-input-tokens",
    "--max-output-tokens",
    "--deadline-ms",
  ];
  for (const name of required) invariant(values.has(name), `missing ${name}`);
  invariant(values.size === required.length, "unknown live-runner argument");
  return Object.freeze({
    artifactsDir: resolve(values.get("--artifacts-dir")),
    configPath: resolve(values.get("--config")),
    manifestPath: resolve(values.get("--manifest")),
    samples: numberArgument(values.get("--samples"), "--samples", 1, 100),
    maxProviderCalls: numberArgument(
      values.get("--max-provider-calls"),
      "--max-provider-calls",
      0,
      64,
    ),
    maxInputTokens: numberArgument(
      values.get("--max-input-tokens"),
      "--max-input-tokens",
      0,
      10_000_000,
    ),
    maxOutputTokens: numberArgument(
      values.get("--max-output-tokens"),
      "--max-output-tokens",
      0,
      10_000_000,
    ),
    deadlineMs: numberArgument(
      values.get("--deadline-ms"),
      "--deadline-ms",
      1,
      600_000,
    ),
  });
}

async function readJson(path, label, limit = 512 * 1024) {
  const stat = await lstat(path);
  invariant(
    stat.isFile() && !stat.isSymbolicLink(),
    `${label} must be a regular file`,
  );
  invariant(stat.size <= limit, `${label} exceeds its byte limit`);
  return JSON.parse(await readFile(path, "utf8"));
}

function commandSpec(value, label) {
  invariant(value && typeof value === "object", `${label} is missing`);
  invariant(
    typeof value.command === "string" && isAbsolute(value.command),
    `${label} command must be an absolute executable path`,
  );
  invariant(
    Array.isArray(value.args) &&
      value.args.every((arg) => typeof arg === "string"),
    `${label} args must be a string array`,
  );
  return Object.freeze({
    command: value.command,
    args: Object.freeze([...value.args]),
  });
}

async function processIdentity(spec, label) {
  const stat = await lstat(spec.command);
  invariant(
    stat.isFile() && !stat.isSymbolicLink(),
    `${label} executable is not a regular file`,
  );
  const argumentEvidence = [];
  for (const argument of spec.args) {
    if (!isAbsolute(argument)) continue;
    try {
      const argumentStat = await lstat(argument);
      if (!argumentStat.isFile() || argumentStat.isSymbolicLink()) continue;
      argumentEvidence.push([
        argument,
        argumentStat.size,
        argumentStat.mtimeMs,
        argumentStat.size <= 2 * 1024 * 1024
          ? sha256(await readFile(argument))
          : null,
      ]);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  const executableDigest = jsonDigest([
    spec.command,
    stat.size,
    stat.mtimeMs,
    argumentEvidence,
  ]);
  const version = await runJsonProcess(
    spec,
    { schemaVersion: "jev.tool-environment.adapter-version/v1" },
    10_000,
    `${label} readiness`,
    ["--version"],
    true,
  );
  invariant(version.exitCode === 0, `${label} executable version probe failed`);
  return Object.freeze({
    executableDigest,
    executableVersionDigest: sha256(version.stdout),
  });
}

function runJsonProcess(
  spec,
  input,
  deadlineMs,
  label,
  extraArgs = [],
  allowText = false,
) {
  return new Promise((resolvePromise, reject) => {
    const startedAt = performance.now();
    const child = spawn(spec.command, [...spec.args, ...extraArgs], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolvePromise(result);
    };
    const append = (destination, chunk) => {
      bytes += chunk.length;
      if (bytes > maxProcessBytes) {
        child.kill();
        finish(new TypeError(`${label} output exceeds its redaction limit`));
        return;
      }
      destination.push(chunk);
    };
    child.stdout.on("data", (chunk) => append(stdout, chunk));
    child.stderr.on("data", (chunk) => append(stderr, chunk));
    child.on("error", (error) =>
      finish(new TypeError(`${label} failed to start: ${error.message}`)),
    );
    child.on("close", (exitCode, signal) =>
      finish(null, {
        exitCode: exitCode ?? -1,
        signal: signal ?? null,
        durationMs: performance.now() - startedAt,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
    const timer = setTimeout(() => {
      child.kill();
      finish(new TypeError(`${label} exceeded its finite deadline`));
    }, deadlineMs);
    if (!allowText) child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

function parseAdapterResult(processResult, expected) {
  invariant(
    processResult.exitCode === 0 && processResult.signal === null,
    "adapter execution failed",
  );
  let result;
  try {
    result = JSON.parse(processResult.stdout);
  } catch {
    throw new TypeError("adapter did not emit one JSON result");
  }
  invariant(
    result && typeof result === "object" && !Array.isArray(result),
    "adapter result must be an object",
  );
  for (const [key, value] of Object.entries(expected))
    invariant(
      result[key] === value,
      `adapter result ${key} does not bind to the trusted invocation`,
    );
  invariant(
    result.schemaVersion === "jev.tool-environment.adapter-result/v1",
    "adapter result schema version is unsupported",
  );
  invariant(
    result.executionKind === "actual_adapter_execution",
    "adapter result cannot be verification-only evidence",
  );
  invariant(
    typeof result.executionId === "string" && result.executionId.length > 0,
    "adapter result has no execution id",
  );
  invariant(
    Array.isArray(result.phases) && result.phases.length > 0,
    "adapter result has no timings",
  );
  invariant(
    result.phases.every(
      (phase) =>
        phase &&
        typeof phase.name === "string" &&
        Number.isFinite(phase.durationMs) &&
        phase.durationMs >= 0,
    ),
    "adapter result has an invalid phase timing",
  );
  invariant(
    ["success", "failure", "rejected"].includes(result.outcomeStatus),
    "adapter result has invalid outcome",
  );
  invariant(
    Number.isSafeInteger(result.invocationCount) &&
      result.invocationCount >= 0 &&
      result.invocationCount <= 1,
    "adapter result has invalid invocation count",
  );
  return result;
}

function parseProviderResult(processResult, purpose, candidates) {
  if (processResult.exitCode !== 0 || processResult.signal !== null) {
    const category = safeProviderFailureCategory(processResult.stderr);
    throw new TypeError(
      `${purpose} callback failed${category === null ? "" : ` (${category})`}`,
    );
  }
  let result;
  try {
    result = JSON.parse(processResult.stdout);
  } catch {
    throw new TypeError(`${purpose} callback did not emit JSON`);
  }
  invariant(
    result && typeof result === "object" && !Array.isArray(result),
    `${purpose} callback result must be an object`,
  );
  invariant(
    typeof result.candidateId === "string" &&
      candidates.includes(result.candidateId),
    `${purpose} callback selected an unbounded candidate`,
  );
  for (const field of [
    "providerId",
    "modelId",
    "requestContractDigest",
    "usageEvidenceDigest",
  ])
    invariant(
      typeof result[field] === "string" && result[field].length > 0,
      `${purpose} callback omitted ${field}`,
    );
  invariant(
    Number.isSafeInteger(result.inputTokens) && result.inputTokens > 0,
    `${purpose} callback has invalid input tokens`,
  );
  invariant(
    Number.isSafeInteger(result.outputTokens) && result.outputTokens >= 0,
    `${purpose} callback has invalid output tokens`,
  );
  invariant(
    typeof result.costNanoUsd === "string" &&
      /^(?:0|[1-9][0-9]*)$/u.test(result.costNanoUsd),
    `${purpose} callback has invalid cost`,
  );
  invariant(
    result.pricingEvidence && typeof result.pricingEvidence === "object",
    `${purpose} callback omitted pricing evidence`,
  );
  return result;
}

function safeProviderFailureCategory(stderr) {
  try {
    const value = JSON.parse(stderr);
    if (
      value?.error === "provider_callback_failed" &&
      typeof value.category === "string" &&
      /^(?:authentication|authorization|invalid_request|rate_limited|unavailable|timeout|cancelled|invalid_response|configuration|network|unknown)$/u.test(
        value.category,
      )
    )
      return value.status === null
        ? value.category
        : `${value.category}_http_${value.status}`;
  } catch {
    // Backwards-compatible parser for older callback processes.
  }
  const match =
    /^(?:TypeSafe|OpenAI-compatible) provider (authentication|authorization|invalid request|rate limited|unavailable|timeout|cancelled|invalid response|configuration|network)\s*$/u.exec(
      stderr,
    );
  return match?.[1]?.replaceAll(" ", "_") ?? null;
}

function providerCall(trace, result, purpose, sequence) {
  const call = {
    sequence,
    purpose,
    providerId: result.providerId,
    modelId: result.modelId,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costNanoUsd: result.costNanoUsd,
    requestContractDigest: result.requestContractDigest,
    usageEvidenceDigest: result.usageEvidenceDigest,
    pricingEvidence: result.pricingEvidence,
    bindingDigest: "",
  };
  call.bindingDigest = providerCallBindingDigest(trace, call);
  return call;
}

function validateBudgets(calls, options) {
  const inputs = calls.reduce((total, call) => total + call.inputTokens, 0);
  const outputs = calls.reduce((total, call) => total + call.outputTokens, 0);
  invariant(
    calls.length <= options.maxProviderCalls,
    "provider-call budget exceeded",
  );
  invariant(inputs <= options.maxInputTokens, "input-token budget exceeded");
  invariant(outputs <= options.maxOutputTokens, "output-token budget exceeded");
}

function checkSelection(task, proposal, advisory) {
  if (
    proposal !== task.expectedCandidateId ||
    (advisory && advisory !== proposal)
  )
    return Object.freeze({
      decision: "rejected",
      selectedCandidateId: null,
      invocationCount: 0,
    });
  return Object.freeze({
    decision: "allow",
    selectedCandidateId: task.expectedCandidateId,
    invocationCount: 1,
  });
}

function bindChecks(trace) {
  const originalDecisionDigest = traceDecisionDigest(trace);
  const replay = {
    originalDecisionDigest,
    replayedDecisionDigest: originalDecisionDigest,
    evidenceDigest: "",
  };
  replay.evidenceDigest = replayCheckEvidenceDigest(trace, replay);
  const stale = {
    trustedStateDigest: sha256(`stale:${trace.trustedStateDigest}`),
    proposedCandidateId: trace.selection.proposedCandidateId,
    executedCandidateId: null,
    decision: "rejected",
    invocationCount: 0,
    evidenceDigest: "",
  };
  stale.evidenceDigest = staleCheckEvidenceDigest(trace, stale);
  trace.checks = { replay, stale };
}

async function executeTrace(
  task,
  architecture,
  sample,
  manifest,
  config,
  options,
  identities,
) {
  const adapterId = adapterByEnvironment[task.environment];
  invariant(
    adapterId,
    `no executable adapter is available for ${task.environment}`,
  );
  const trialId = `${task.id}-trial-${sample}`;
  const trace = {
    schemaVersion: "2",
    traceId: `${task.id}-${architecture}-${sample}`,
    trialId,
    manifestId: manifest.manifestId,
    taskId: task.id,
    environment: task.environment,
    architecture,
    executionState: "COMPLETED",
    trustedStateDigest: task.trustedStateDigest,
    policyDigest: jsonDigest([
      "jev.tool-environment.local-policy/v1",
      task.candidateIds,
      task.expectedCandidateId,
    ]),
    phases: [],
    selection: {
      proposedCandidateId: null,
      executedCandidateId: null,
      invocationCount: 0,
    },
    outcome: { status: "failure" },
    checks: { replay: null, stale: null },
    accounting: {
      requestCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      costNanoUsd: "0",
      providerIds: [],
      calls: [],
    },
    executionEvidence: null,
  };
  const fixtureDigest = jsonDigest(["jev.tool-environment.fixture/v1", task]);
  const callbackInput = Object.freeze({
    schemaVersion: "jev.tool-environment.callback-input/v1",
    taskId: task.id,
    environment: task.environment,
    architecture,
    trialId,
    trustedStateDigest: task.trustedStateDigest,
    fixtureDigest,
    candidateIds: task.candidateIds,
  });
  let proposal = task.expectedCandidateId;
  let advisory = null;
  const providerPhases = [];
  if (architecture !== "direct_deterministic") {
    const output = await runJsonProcess(
      config.hostPlanner,
      callbackInput,
      options.deadlineMs,
      `${task.id} host planner`,
    );
    const result = parseProviderResult(
      output,
      `${task.id} host planner`,
      task.candidateIds,
    );
    providerPhases.push({
      name: "host_planning",
      durationMs: output.durationMs,
    });
    proposal = result.candidateId;
    trace.accounting.calls.push(
      providerCall(trace, result, "host_planning", 0),
    );
  }
  if (architecture === "host_planner_jev_gate") {
    const output = await runJsonProcess(
      config.jevEvaluator,
      callbackInput,
      options.deadlineMs,
      `${task.id} Jev evaluator`,
    );
    const result = parseProviderResult(
      output,
      `${task.id} Jev evaluator`,
      task.candidateIds,
    );
    providerPhases.push({
      name: "jev_evaluation",
      durationMs: output.durationMs,
    });
    advisory = result.candidateId;
    trace.accounting.calls.push(
      providerCall(trace, result, "jev_evaluation", 1),
    );
  }
  validateBudgets(trace.accounting.calls, options);
  const selection = checkSelection(task, proposal, advisory);
  const adapterInput = Object.freeze({
    schemaVersion: "jev.tool-environment.adapter-input/v1",
    taskId: task.id,
    environment: task.environment,
    architecture,
    trialId,
    trustedStateDigest: task.trustedStateDigest,
    fixtureDigest,
    candidateIds: task.candidateIds,
    proposedCandidateId: proposal,
    policyDecision: selection.decision,
    selectedCandidateId: selection.selectedCandidateId,
    deadlineMs: options.deadlineMs,
  });
  const startedAt = canonicalUtcNow();
  const adapterOutput = await runJsonProcess(
    config.adapters[adapterId],
    adapterInput,
    options.deadlineMs,
    `${adapterId} adapter`,
  );
  const completedAt = canonicalUtcNow();
  const result = parseAdapterResult(adapterOutput, {
    taskId: task.id,
    environment: task.environment,
    architecture,
    trialId,
    trustedStateDigest: task.trustedStateDigest,
    fixtureDigest,
  });
  invariant(
    result.proposedCandidateId === proposal,
    "adapter proposal differs from bounded planner result",
  );
  invariant(
    result.executedCandidateId === selection.selectedCandidateId,
    "adapter executed a candidate not authorized by policy",
  );
  invariant(
    result.invocationCount === selection.invocationCount,
    "adapter invocation count differs from policy",
  );
  trace.phases = [...providerPhases, ...result.phases];
  trace.selection = {
    proposedCandidateId: proposal,
    executedCandidateId: result.executedCandidateId,
    invocationCount: result.invocationCount,
  };
  trace.outcome = { status: result.outcomeStatus };
  const calls = trace.accounting.calls;
  trace.accounting = {
    requestCount: calls.length,
    inputTokens: calls.reduce((total, call) => total + call.inputTokens, 0),
    outputTokens: calls.reduce((total, call) => total + call.outputTokens, 0),
    costNanoUsd: calls
      .reduce((total, call) => total + BigInt(call.costNanoUsd), 0n)
      .toString(),
    providerIds: [...new Set(calls.map((call) => call.providerId))],
    calls,
  };
  trace.executionEvidence = {
    kind: "local_adapter_process",
    adapterId,
    executionId: result.executionId,
    fixtureDigest,
    executableDigest: identities[adapterId].executableDigest,
    executableVersionDigest: identities[adapterId].executableVersionDigest,
    commandDigest: jsonDigest([
      config.adapters[adapterId].command,
      config.adapters[adapterId].args,
      adapterInput,
    ]),
    stdoutDigest: sha256(adapterOutput.stdout),
    stderrDigest: sha256(adapterOutput.stderr),
    startedAt,
    completedAt,
    deadlineMs: options.deadlineMs,
    invocationEvidenceDigest: "",
  };
  trace.executionEvidence.invocationEvidenceDigest = executionEvidenceDigest(
    trace,
    trace.executionEvidence,
  );
  bindChecks(trace);
  return trace;
}

async function atomicWrite(path, value) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  await rename(temporary, path);
}

async function loadSchemas() {
  return Promise.all([
    readJson(join(root, "schema", "task-manifest.schema.jsonc"), "task schema"),
    readJson(join(root, "schema", "trace.schema.jsonc"), "trace schema"),
    readJson(join(root, "schema", "result.schema.jsonc"), "result schema"),
  ]);
}

export async function runLiveBenchmark(options) {
  const [config, originalManifest, schemas] = await Promise.all([
    readJson(options.configPath, "live config"),
    readJson(options.manifestPath, "task manifest"),
    loadSchemas(),
  ]);
  invariant(
    config.schemaVersion === "jev.tool-environment.live-config/v1",
    "live config schema version is unsupported",
  );
  invariant(
    originalManifest.evidenceState !== "NOT_RUN",
    "a NOT_RUN manifest cannot be promoted by a live runner",
  );
  const manifest = structuredClone(originalManifest);
  validateAgainstSchema(schemas[0], manifest, "task manifest");
  validateManifest(manifest);
  invariant(
    manifest.tasks.every((task) => !unsupported.has(task.environment)),
    "Unity and Unreal have no local adapter; refuse to fabricate their cells",
  );
  invariant(
    config.adapters && typeof config.adapters === "object",
    "live config has no adapters",
  );
  const neededAdapters = [
    ...new Set(
      manifest.tasks.map((task) => adapterByEnvironment[task.environment]),
    ),
  ];
  const adapters = Object.fromEntries(
    neededAdapters.map((id) => [
      id,
      commandSpec(config.adapters[id], `${id} adapter`),
    ]),
  );
  const configWithCommands = {
    adapters,
    hostPlanner: commandSpec(config.hostPlanner, "host planner"),
    jevEvaluator: commandSpec(config.jevEvaluator, "Jev evaluator"),
  };
  const identities = Object.fromEntries(
    await Promise.all(
      neededAdapters.map(async (id) => [
        id,
        await processIdentity(adapters[id], `${id} adapter`),
      ]),
    ),
  );
  const artifactStats = await lstat(dirname(options.artifactsDir)).catch(
    () => null,
  );
  invariant(
    artifactStats?.isDirectory(),
    "artifact parent directory does not exist",
  );
  await mkdir(options.artifactsDir);
  await mkdir(join(options.artifactsDir, "traces"));
  const traces = [];
  for (const task of manifest.tasks)
    for (const architecture of architectures)
      for (let sample = 0; sample < options.samples; sample += 1)
        traces.push(
          await executeTrace(
            task,
            architecture,
            sample,
            manifest,
            configWithCommands,
            options,
            identities,
          ),
        );
  const result = {
    schemaVersion: "2",
    manifestId: manifest.manifestId,
    executionState: "COMPLETED",
    sampleCount: options.samples,
    rows: recomputeToolEnvironmentRows(manifest, traces, options.samples),
  };
  const [taskSchema, traceSchema, resultSchema] = schemas;
  validateArtifactSet({
    taskSchema,
    traceSchema,
    resultSchema,
    manifest,
    traces,
    result,
  });
  await atomicWrite(join(options.artifactsDir, "task-manifest.json"), manifest);
  await atomicWrite(join(options.artifactsDir, "result.json"), result);
  for (const trace of traces)
    await atomicWrite(
      join(options.artifactsDir, "traces", `${trace.traceId}.json`),
      trace,
    );
  return Object.freeze({
    artifactDirectory: options.artifactsDir,
    traceCount: traces.length,
  });
}

async function main() {
  const result = await runLiveBenchmark(parseArguments(process.argv.slice(2)));
  process.stdout.write(
    `Retained ${result.traceCount} adapter-executed traces in ${result.artifactDirectory}\n`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();

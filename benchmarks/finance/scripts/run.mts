import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  realpath,
  readdir,
  readFile,
  rename,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  assertSafeRelativePath,
  canonicalJson,
  readSafeRelativeFile,
} from "../builders/lib/canonical.mjs";
import {
  FINANCE_CHART_RENDERER,
  FINANCE_VISUAL_MUTATION_ROUTES,
  renderFinanceChart,
} from "../builders/visual/render.mjs";
import {
  bindFinanceAdvisoryEvidenceWithText,
  FinanceAdvisoryBoundaryError,
  type FinanceAdvisoryState,
  type TrustedFinanceProjection,
  type UntrustedTextFinanceEvidence,
  type UntrustedVisualFinanceEvidence,
} from "../../../packages/adapters/src/index.js";
import {
  aggregateFinanceBenchmarkTraces,
  type FinanceArchitecture,
  type FinanceBenchmarkTrace,
  type FinanceRoute,
  type FinanceRouteProbabilities,
  type FinanceTrack,
  financeArchitectures,
  financeRoutes,
  financeTracks,
  stableJson,
} from "../../../packages/evals/src/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const maximumCases = 100_000;
const maximumDatasetBytes = 100 * 1024 * 1024;
const maximumRuntimeEvidenceFiles = 32;
const maximumRuntimeEvidenceBytes = 64 * 1024;

export interface FinanceBenchmarkCase {
  readonly schemaVersion: "1";
  readonly id: string;
  readonly groupId: string;
  readonly track: FinanceTrack;
  readonly split: "calibration" | "test";
  readonly goldRoute: FinanceRoute;
  readonly lookaheadProbe: boolean;
  readonly evaluationNow: string;
  readonly trustedProjection: TrustedFinanceProjection;
  readonly untrustedEvidence: {
    readonly visual?: UntrustedVisualFinanceEvidence;
    readonly text?: UntrustedTextFinanceEvidence;
  };
  readonly visualArtifact?: {
    readonly svgPath: string;
    readonly compilerInput: unknown;
  };
}

export interface FinanceDatasetManifest {
  readonly schemaVersion: "1";
  readonly datasetId: string;
  readonly sourceUrl: string;
  readonly caseSetHash: string;
  readonly license: string;
  readonly evidenceClass: "SYNTHETIC" | "LOCAL_EXPLORATORY" | "RETAINED_PUBLIC";
  readonly redistributionAllowed: boolean;
  readonly containsSensitiveData: false;
  readonly splitMethod: "forward_chaining_time_split";
  readonly trainEnd: string;
  readonly testStart: string;
}

export interface FinanceComponentAccounting {
  readonly role: "host" | "jev";
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly costNanoUsd: string | null;
}

export type FinanceDriverResult =
  | {
      readonly status: "predicted";
      readonly predictedRoute: FinanceRoute;
      readonly routeQuestionProbabilities: FinanceRouteProbabilities;
      readonly calibrationStatus: "measured";
      readonly abstained: boolean;
      readonly unsafeExecutionAttempt: boolean;
      readonly inputTokens: number | null;
      readonly outputTokens: number | null;
      readonly costNanoUsd: string | null;
      readonly componentAccounting: readonly FinanceComponentAccounting[];
    }
  | {
      readonly status: "predicted";
      readonly predictedRoute: FinanceRoute;
      readonly routeQuestionProbabilities: null;
      readonly calibrationStatus: "unavailable";
      readonly calibrationReason:
        | "deterministic_only"
        | "composite_no_distribution";
      readonly abstained: boolean;
      readonly unsafeExecutionAttempt: boolean;
      readonly inputTokens: number | null;
      readonly outputTokens: number | null;
      readonly costNanoUsd: string | null;
      readonly componentAccounting: readonly FinanceComponentAccounting[];
    };

export interface FinanceDriverContext {
  readonly signal: AbortSignal;
  readonly architecture: FinanceArchitecture;
  readonly track: FinanceTrack;
  /** Trusted case evaluation time; never sourced from provider-visible state. */
  readonly evaluationNowEpochMs: number;
}

export type FinanceBenchmarkDriver = (
  state: FinanceAdvisoryState,
  context: FinanceDriverContext,
) => Promise<FinanceDriverResult> | FinanceDriverResult;

export type FinanceBenchmarkDrivers = Readonly<
  Record<FinanceArchitecture, FinanceBenchmarkDriver>
>;

export interface ArchitectureRuntimePricing {
  /** Exact integer nano-USD charged per input token. */
  readonly inputNanoUsdPerToken: string;
  /** Exact integer nano-USD charged per output token. */
  readonly outputNanoUsdPerToken: string;
  /** Canonical credential-free public source for the retained price record. */
  readonly sourceUrl: string;
  readonly observedAt: string;
  readonly priceVersion: string;
  /** SHA-256 of the independently retained price evidence. */
  readonly priceHash: string;
}

export type ArchitectureRuntimeModelVersionEvidence =
  | Readonly<{ kind: "response_exact" }>
  | Readonly<{
      kind: "external_attestation";
      sourceUrl: string;
      observedAt: string;
      evidenceHash: string;
    }>;

export interface ArchitectureRuntimeComponent {
  readonly role: "deterministic" | "host" | "jev";
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  /** Exact model or route string returned by the provider. */
  readonly responseModel: string;
  readonly modelVersionEvidence: ArchitectureRuntimeModelVersionEvidence;
  readonly probabilitySemantics:
    | "none"
    | "native_calibrated"
    | "normalized_logits"
    | "self_reported"
    | "synthetic"
    | "unknown";
  readonly pricing: ArchitectureRuntimePricing | null;
}

export interface ArchitectureRuntime {
  readonly components: readonly ArchitectureRuntimeComponent[];
  readonly combinerId: string;
  readonly combinerVersion: string;
}

export interface FinanceRuntimeProvenance {
  readonly questionSetHash: string;
  readonly policyVersion: string;
  readonly featureSetHash: string;
  readonly hardware: string;
  readonly region: string;
  readonly concurrency: number;
  readonly timeoutMs: number;
  readonly architectures: Readonly<
    Record<FinanceArchitecture, ArchitectureRuntime>
  >;
}

export type FinanceRuntimeEvidence =
  | Readonly<{
      schemaVersion: "1";
      kind: "pricing";
      inputNanoUsdPerToken: string;
      outputNanoUsdPerToken: string;
      sourceUrl: string;
      observedAt: string;
      priceVersion: string;
    }>
  | Readonly<{
      schemaVersion: "1";
      kind: "model_version";
      sourceUrl: string;
      observedAt: string;
      providerId: string;
      modelId: string;
      modelVersion: string;
      responseModel: string;
    }>;

export interface LoadedFinanceDataset {
  readonly manifest: FinanceDatasetManifest;
  readonly cases: readonly FinanceBenchmarkCase[];
  readonly casesBytes: Uint8Array;
  readonly visualArtifacts: readonly Readonly<{
    path: string;
    bytes: Uint8Array;
  }>[];
}

export interface FinanceRunArtifacts {
  readonly run: Record<string, unknown>;
  readonly traces: readonly Record<string, unknown>[];
  readonly tracesJsonl: string;
  readonly dataset: LoadedFinanceDataset;
  readonly runtimeEvidence: readonly FinanceRuntimeEvidence[];
}

export async function loadFinanceDataset(
  directory: string,
): Promise<LoadedFinanceDataset> {
  const manifestPath = join(directory, "dataset-manifest.json");
  const casesPath = join(directory, "cases.jsonl");
  await Promise.all([
    assertRegularFile(manifestPath),
    assertRegularFile(casesPath),
  ]);
  const [manifestBytes, casesBytes, manifestSchema, caseSchema] =
    await Promise.all([
      boundedRead(manifestPath, 1_000_000),
      boundedRead(casesPath, maximumDatasetBytes),
      readSchema("dataset-manifest.schema.jsonc"),
      readSchema("case.schema.jsonc"),
    ]);
  const manifest = JSON.parse(
    new TextDecoder().decode(manifestBytes),
  ) as FinanceDatasetManifest;
  validateSchema(manifestSchema, manifest, "finance dataset manifest");
  invariant(
    manifest.caseSetHash === sha256(casesBytes),
    "finance dataset caseSetHash does not match cases.jsonl",
  );
  const text = new TextDecoder("utf-8", { fatal: true }).decode(casesBytes);
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  invariant(lines.length > 0, "finance dataset has no cases");
  invariant(lines.length <= maximumCases, "finance dataset has too many cases");
  const cases = lines.map((line, index) => {
    invariant(
      line.length > 0,
      `finance dataset has a blank line at ${index + 1}`,
    );
    const value = JSON.parse(line) as FinanceBenchmarkCase;
    validateSchema(caseSchema, value, `finance case ${index + 1}`);
    return value;
  });
  validateDatasetSemantics(manifest, cases);
  const visualArtifacts = await validateRetainedVisualArtifacts(
    directory,
    cases,
  );
  return {
    manifest: deepFreeze(structuredClone(manifest)),
    cases: deepFreeze(structuredClone(cases)),
    casesBytes,
    visualArtifacts,
  };
}

export async function runFinanceBenchmark(options: {
  readonly runId: string;
  readonly dataset: LoadedFinanceDataset;
  readonly drivers: FinanceBenchmarkDrivers;
  readonly runtime: FinanceRuntimeProvenance;
  readonly runtimeEvidence: readonly FinanceRuntimeEvidence[];
  readonly now?: () => number;
}): Promise<FinanceRunArtifacts> {
  portableIdentifier(options.runId, "finance runId", 160);
  validateDrivers(options.drivers);
  validateRuntime(options.runtime);
  const runtimeEvidence = validateAndBindRuntimeEvidence(
    options.runtime,
    options.runtimeEvidence,
  );
  const testCases = options.dataset.cases.filter(
    (entry) => entry.split === "test",
  );
  invariant(testCases.length > 0, "finance benchmark has no test cases");
  const tasks = financeArchitectures.flatMap((architecture) =>
    testCases.map((benchmarkCase) => ({ architecture, benchmarkCase })),
  );
  const now = options.now ?? performance.now.bind(performance);
  const traces = new Array<Record<string, unknown>>(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(options.runtime.concurrency, tasks.length) },
      async () => {
        while (true) {
          const index = next++;
          const task = tasks[index];
          if (task === undefined) return;
          traces[index] = await executeTask(
            options.runId,
            task.architecture,
            task.benchmarkCase,
            options.drivers[task.architecture],
            options.runtime.architectures[task.architecture],
            options.runtime.timeoutMs,
            now,
          );
        }
      },
    ),
  );
  const ordered = traces.sort((left, right) =>
    codeUnitCompare(String(left.traceId), String(right.traceId)),
  );
  const rows = aggregateFinanceBenchmarkTraces(
    ordered as unknown as readonly FinanceBenchmarkTrace[],
  );
  const tracesJsonl = `${ordered.map(canonicalCompactJson).join("\n")}\n`;
  const run = {
    schemaVersion: "1",
    runId: options.runId,
    executionState: "COMPLETED",
    sampleCount: testCases.length,
    traceCount: ordered.length,
    traceSetHash: sha256(tracesJsonl),
    dataset: {
      status: "RETAINED",
      datasetId: options.dataset.manifest.datasetId,
      sourceUrl: options.dataset.manifest.sourceUrl,
      digest: options.dataset.manifest.caseSetHash,
      license: options.dataset.manifest.license,
      evidenceClass: options.dataset.manifest.evidenceClass,
      redistributionAllowed: options.dataset.manifest.redistributionAllowed,
      splitMethod: options.dataset.manifest.splitMethod,
      trainEnd: options.dataset.manifest.trainEnd,
      testStart: options.dataset.manifest.testStart,
    },
    runtime: structuredClone(options.runtime),
    rows,
  };
  validateSchema(await readSchema("run.schema.jsonc"), run, "finance run");
  return {
    run,
    traces: ordered,
    tracesJsonl,
    dataset: options.dataset,
    runtimeEvidence,
  };
}

/**
 * Atomically publishes a local retained artifact directory.
 *
 * The output parent is a trusted, single-writer boundary. Node does not expose
 * portable directory-relative open/rename primitives, so this function does
 * not claim safety against another same-privilege process replacing entries in
 * that parent while publication is in progress. Failed staging directories are
 * intentionally retained instead of being recursively removed through a path.
 */
export async function writeFinanceArtifacts(
  directory: string,
  artifacts: FinanceRunArtifacts,
): Promise<void> {
  const run = structuredClone(artifacts.run);
  const manifest = structuredClone(artifacts.dataset.manifest);
  const casesBytes = Uint8Array.from(artifacts.dataset.casesBytes);
  const tracesJsonl = String(artifacts.tracesJsonl);
  const visualArtifacts = validateVisualArtifactsForWrite(artifacts.dataset);
  const runtimeEvidence = validateAndBindRuntimeEvidence(
    run.runtime as FinanceRuntimeProvenance,
    structuredClone(artifacts.runtimeEvidence),
  );
  invariant(
    sha256(casesBytes) === manifest.caseSetHash,
    "finance cases bytes do not match the retained manifest",
  );
  invariant(
    run.traceSetHash === sha256(tracesJsonl),
    "finance traces bytes do not match the retained run",
  );
  const runJson = stableJson(run);
  const manifestJson = stableJson(manifest);
  const evidenceFiles = runtimeEvidence.map((evidence) => ({
    name: evidenceFileName(evidence),
    bytes: stableJson(evidence),
  }));
  try {
    await lstat(directory);
    throw new TypeError("finance artifact directory already exists");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const outputParent = dirname(resolve(directory));
  const outputParentInfo = await lstat(outputParent);
  invariant(
    outputParentInfo.isDirectory() && !outputParentInfo.isSymbolicLink(),
    "finance artifact output parent must be a regular directory",
  );
  const canonicalOutputParent = await realpath(outputParent);
  const pinnedOutputParent = Object.freeze({
    path: outputParent,
    canonicalPath: canonicalOutputParent,
    dev: outputParentInfo.dev,
    ino: outputParentInfo.ino,
  });
  const stagingPath = `${resolve(directory)}.tmp-${process.pid}-${randomUUID()}`;
  await verifyPinnedDirectory(pinnedOutputParent);
  await mkdir(stagingPath, { recursive: false, mode: 0o700 });
  const staging = await pinNewDirectory(
    stagingPath,
    canonicalOutputParent,
    "finance staging directory",
  );
  const evidenceDirectory = await createPinnedChildDirectory(
    staging,
    "evidence",
  );
  if (visualArtifacts.length > 0)
    await createPinnedChildDirectory(staging, "assets");
  await Promise.all([
    writePinnedFile(staging, "run.json", runJson),
    writePinnedFile(staging, "dataset-manifest.json", manifestJson),
    writePinnedFile(staging, "cases.jsonl", casesBytes),
    writePinnedFile(staging, "traces.jsonl", tracesJsonl),
    ...visualArtifacts.map((artifact) =>
      writePinnedFile(staging, artifact.path, artifact.bytes),
    ),
    ...evidenceFiles.map((evidence) =>
      writePinnedFile(staging, `evidence/${evidence.name}`, evidence.bytes),
    ),
  ]);
  await verifyPinnedDirectory(evidenceDirectory);
  await verifyPinnedDirectory(staging);
  await verifyPinnedDirectory(pinnedOutputParent);
  await rename(staging.path, directory);
  await verifyPublishedDirectory(
    staging,
    resolve(directory),
    canonicalOutputParent,
  );
}

function validateVisualArtifactsForWrite(
  dataset: LoadedFinanceDataset,
): readonly Readonly<{ path: string; bytes: Uint8Array }>[] {
  invariant(
    Array.isArray(dataset.cases) && Array.isArray(dataset.visualArtifacts),
    "finance dataset visual artifacts must be arrays",
  );
  const expected = new Map<string, string>();
  for (const benchmarkCase of dataset.cases) {
    if (benchmarkCase.track !== "visual_evidence") {
      invariant(
        benchmarkCase.visualArtifact === undefined,
        `non-visual finance case ${benchmarkCase.id} has a visual artifact`,
      );
      continue;
    }
    const retained = benchmarkCase.visualArtifact;
    invariant(
      retained !== undefined,
      `finance visual case ${benchmarkCase.id} has no retained artifact`,
    );
    assertFinanceVisualArtifactPath(retained.svgPath);
    invariant(
      !expected.has(retained.svgPath),
      `finance visual artifact path is reused: ${retained.svgPath}`,
    );
    const rendered = renderFinanceChart(retained.compilerInput);
    const visual = benchmarkCase.trustedProjection.visual;
    invariant(
      visual !== undefined &&
        rendered.imageHash === visual.imageHash &&
        rendered.sourceBindingHash === visual.sourceBindingHash &&
        rendered.artifactBindingHash === visual.artifactBindingHash &&
        rendered.mutationId === visual.mutationId &&
        rendered.expectedRoute === benchmarkCase.goldRoute,
      `finance visual case ${benchmarkCase.id} compiler output mismatch`,
    );
    expected.set(retained.svgPath, rendered.svg);
  }

  invariant(
    dataset.visualArtifacts.length === expected.size,
    "finance visual artifact set does not match visual cases",
  );
  const actualPaths = new Set<string>();
  const validated: Array<Readonly<{ path: string; bytes: Uint8Array }>> = [];
  for (const artifact of dataset.visualArtifacts) {
    assertFinanceVisualArtifactPath(artifact.path);
    invariant(
      !actualPaths.has(artifact.path),
      `finance visual artifact path is duplicated: ${artifact.path}`,
    );
    actualPaths.add(artifact.path);
    invariant(
      artifact.bytes instanceof Uint8Array,
      `finance visual artifact ${artifact.path} bytes are invalid`,
    );
    const expectedSvg = expected.get(artifact.path);
    invariant(
      expectedSvg !== undefined &&
        Buffer.from(artifact.bytes).equals(Buffer.from(expectedSvg, "utf8")),
      `finance visual artifact ${artifact.path} does not match its case`,
    );
    validated.push(
      Object.freeze({
        path: artifact.path,
        bytes: new TextEncoder().encode(expectedSvg),
      }),
    );
  }
  return Object.freeze(validated);
}

function assertFinanceVisualArtifactPath(path: string): void {
  assertSafeRelativePath(path, "finance visual artifact path");
  invariant(
    /^assets\/[A-Za-z0-9._-]+\.svg$/u.test(path),
    "finance visual artifact path must be a flat assets/*.svg path",
  );
}

interface PinnedDirectory {
  readonly path: string;
  readonly canonicalPath: string;
  readonly dev: number;
  readonly ino: number;
}

async function pinNewDirectory(
  path: string,
  canonicalParent: string,
  label: string,
): Promise<PinnedDirectory> {
  const [info, canonicalPath] = await Promise.all([
    lstat(path),
    realpath(path),
  ]);
  invariant(
    info.isDirectory() &&
      !info.isSymbolicLink() &&
      dirname(canonicalPath) === canonicalParent,
    `${label} is not a new directory under its pinned parent`,
  );
  return Object.freeze({
    path,
    canonicalPath,
    dev: info.dev,
    ino: info.ino,
  });
}

async function createPinnedChildDirectory(
  root: PinnedDirectory,
  name: "assets" | "evidence",
): Promise<PinnedDirectory> {
  await verifyPinnedDirectory(root);
  const path = join(root.path, name);
  await mkdir(path, { recursive: false, mode: 0o700 });
  return pinNewDirectory(path, root.canonicalPath, `finance ${name} directory`);
}

async function verifyPinnedDirectory(
  directory: PinnedDirectory,
): Promise<void> {
  const [info, canonicalPath] = await Promise.all([
    lstat(directory.path),
    realpath(directory.path),
  ]);
  invariant(
    info.isDirectory() &&
      !info.isSymbolicLink() &&
      info.dev === directory.dev &&
      info.ino === directory.ino &&
      canonicalPath === directory.canonicalPath,
    `finance artifact directory identity changed: ${directory.path}`,
  );
}

async function writePinnedFile(
  root: PinnedDirectory,
  relativePath: string,
  bytes: string | Uint8Array,
): Promise<void> {
  assertSafeRelativePath(relativePath, "finance artifact output path");
  await verifyPinnedDirectory(root);
  const target = resolve(root.path, ...relativePath.split("/"));
  const parentPath = dirname(target);
  const [parentBefore, canonicalParent] = await Promise.all([
    lstat(parentPath),
    realpath(parentPath),
  ]);
  const fromRoot = relative(root.canonicalPath, canonicalParent);
  invariant(
    parentBefore.isDirectory() &&
      !parentBefore.isSymbolicLink() &&
      fromRoot !== ".." &&
      !fromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(fromRoot),
    "finance artifact output parent escapes staging",
  );
  const handle = await open(target, "wx", 0o600);
  try {
    const [opened, pathInfo, canonicalTarget, parentAfter] = await Promise.all([
      handle.stat(),
      lstat(target),
      realpath(target),
      lstat(parentPath),
    ]);
    const targetFromRoot = relative(root.canonicalPath, canonicalTarget);
    invariant(
      opened.isFile() &&
        pathInfo.isFile() &&
        !pathInfo.isSymbolicLink() &&
        opened.dev === pathInfo.dev &&
        opened.ino === pathInfo.ino &&
        parentBefore.dev === parentAfter.dev &&
        parentBefore.ino === parentAfter.ino &&
        targetFromRoot !== ".." &&
        !targetFromRoot.startsWith(`..${sep}`) &&
        !isAbsolute(targetFromRoot),
      "finance artifact output path changed before write",
    );
    await handle.writeFile(bytes);
    await handle.sync();
    const [written, finalPathInfo, finalParentInfo] = await Promise.all([
      handle.stat(),
      lstat(target),
      lstat(parentPath),
      verifyPinnedDirectory(root),
    ]);
    invariant(
      written.dev === finalPathInfo.dev &&
        written.ino === finalPathInfo.ino &&
        !finalPathInfo.isSymbolicLink() &&
        parentBefore.dev === finalParentInfo.dev &&
        parentBefore.ino === finalParentInfo.ino,
      "finance artifact output path changed during write",
    );
  } finally {
    await handle.close();
  }
}

async function verifyPublishedDirectory(
  staged: PinnedDirectory,
  publishedPath: string,
  canonicalParent: string,
): Promise<void> {
  const [info, canonicalPath] = await Promise.all([
    lstat(publishedPath),
    realpath(publishedPath),
  ]);
  invariant(
    info.isDirectory() &&
      !info.isSymbolicLink() &&
      info.dev === staged.dev &&
      info.ino === staged.ino &&
      dirname(canonicalPath) === canonicalParent,
    "published finance artifact directory identity changed",
  );
}

async function executeTask(
  runId: string,
  architecture: FinanceArchitecture,
  benchmarkCase: FinanceBenchmarkCase,
  driver: FinanceBenchmarkDriver,
  architectureRuntime: ArchitectureRuntime,
  timeoutMs: number,
  now: () => number,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = finiteClock(now(), "finance benchmark start clock");
  try {
    let state: FinanceAdvisoryState;
    try {
      state = bindFinanceAdvisoryEvidenceWithText(
        benchmarkCase.trustedProjection,
        benchmarkCase.untrustedEvidence.visual,
        benchmarkCase.untrustedEvidence.text,
        timestamp(benchmarkCase.evaluationNow, "evaluationNow"),
      );
    } catch (error) {
      if (
        benchmarkCase.lookaheadProbe &&
        error instanceof FinanceAdvisoryBoundaryError &&
        (error.code === "NO_LOOKAHEAD_ORDER" ||
          error.code === "SIGNAL_OUTSIDE_WINDOW")
      ) {
        const ended = finiteClock(now(), "finance benchmark end clock");
        invariant(ended >= started, "finance benchmark clock moved backwards");
        return {
          ...traceBase(runId, architecture, benchmarkCase, ended - started),
          status: "rejected_lookahead",
          lookaheadRejected: true,
          inputTokens: 0,
          outputTokens: 0,
          costNanoUsd: "0",
          componentAccounting: [],
          boundaryCode: error.code,
        };
      }
      throw error;
    }
    invariant(
      !benchmarkCase.lookaheadProbe,
      `finance lookahead probe ${benchmarkCase.id} crossed the adapter boundary`,
    );
    const result = await Promise.race([
      Promise.resolve(
        driver(state, {
          signal: controller.signal,
          architecture,
          track: benchmarkCase.track,
          evaluationNowEpochMs: timestamp(
            benchmarkCase.evaluationNow,
            "evaluationNow",
          ),
        }),
      ),
      new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(new Error("finance benchmark driver timed out")),
          { once: true },
        );
      }),
    ]);
    const ended = finiteClock(now(), "finance benchmark end clock");
    invariant(ended >= started, "finance benchmark clock moved backwards");
    validateDriverResult(result, architecture, architectureRuntime);
    invariant(
      !result.unsafeExecutionAttempt,
      `finance driver ${architecture} attempted financial execution`,
    );
    return {
      ...traceBase(runId, architecture, benchmarkCase, ended - started),
      status: "predicted",
      lookaheadRejected: false,
      predictedRoute: result.predictedRoute,
      routeQuestionProbabilities: result.routeQuestionProbabilities,
      calibrationStatus: result.calibrationStatus,
      ...(result.calibrationStatus === "unavailable"
        ? { calibrationReason: result.calibrationReason }
        : {}),
      abstained: result.abstained,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costNanoUsd: result.costNanoUsd,
      componentAccounting: result.componentAccounting,
      responseDigest: sha256(canonicalCompactJson(result)),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function traceBase(
  runId: string,
  architecture: FinanceArchitecture,
  benchmarkCase: FinanceBenchmarkCase,
  durationMs: number,
): Record<string, unknown> {
  return {
    schemaVersion: "1",
    traceId: `${runId}/${architecture}/${benchmarkCase.id}`,
    runId,
    caseId: benchmarkCase.id,
    groupId: benchmarkCase.groupId,
    track: benchmarkCase.track,
    architecture,
    goldRoute: benchmarkCase.goldRoute,
    lookaheadProbe: benchmarkCase.lookaheadProbe,
    unsafeExecutionAttempt: false,
    durationMs,
    stateDigest: financeCaseStateDigest(benchmarkCase),
  };
}

/** Binds trusted projection, untrusted evidence, and the fixed evaluation clock. */
export function financeCaseStateDigest(
  benchmarkCase: FinanceBenchmarkCase,
): string {
  return sha256(
    canonicalCompactJson({
      evaluationNow: benchmarkCase.evaluationNow,
      trustedProjection: benchmarkCase.trustedProjection,
      untrustedEvidence: benchmarkCase.untrustedEvidence,
    }),
  );
}

function validateDriverResult(
  value: FinanceDriverResult,
  architecture: FinanceArchitecture,
  architectureRuntime: ArchitectureRuntime,
): void {
  const common = [
    "abstained",
    "calibrationStatus",
    "componentAccounting",
    "costNanoUsd",
    "inputTokens",
    "outputTokens",
    "predictedRoute",
    "routeQuestionProbabilities",
    "status",
    "unsafeExecutionAttempt",
  ];
  const expected =
    value?.calibrationStatus === "unavailable"
      ? [...common, "calibrationReason"]
      : common;
  exactPlainObject(value, expected, "finance driver result");
  invariant(
    value.status === "predicted",
    "finance driver result status is invalid",
  );
  invariant(
    financeRoutes.includes(value.predictedRoute),
    "finance driver returned an invalid route",
  );
  invariant(typeof value.abstained === "boolean", "abstained must be boolean");
  invariant(
    typeof value.unsafeExecutionAttempt === "boolean",
    "unsafeExecutionAttempt must be boolean",
  );
  const expectedUncalibratedReason =
    architecture === "deterministic_only"
      ? "deterministic_only"
      : architecture === "host_plus_jev"
        ? "composite_no_distribution"
        : undefined;
  if (expectedUncalibratedReason === undefined) {
    invariant(
      value.calibrationStatus === "measured" &&
        value.routeQuestionProbabilities !== null,
      `${architecture} must retain measured route-question probabilities`,
    );
    validateProbabilities(value.routeQuestionProbabilities);
  } else {
    invariant(
      value.calibrationStatus === "unavailable" &&
        value.routeQuestionProbabilities === null &&
        value.calibrationReason === expectedUncalibratedReason,
      `${architecture} cannot claim a final route distribution`,
    );
  }
  invariant(
    (value.inputTokens === null) === (value.outputTokens === null),
    "finance input and output token accounting must be measured or unknown together",
  );
  if (value.inputTokens !== null && value.outputTokens !== null) {
    invariant(
      Number.isSafeInteger(value.inputTokens) && value.inputTokens >= 0,
      "finance inputTokens must be a non-negative safe integer",
    );
    invariant(
      Number.isSafeInteger(value.outputTokens) && value.outputTokens >= 0,
      "finance outputTokens must be a non-negative safe integer",
    );
  }
  if (value.costNanoUsd !== null)
    invariant(
      /^(0|[1-9][0-9]*)$/u.test(value.costNanoUsd),
      "finance costNanoUsd must be a non-negative integer string",
    );
  validateComponentAccounting(value, architecture, architectureRuntime);
}

function validateComponentAccounting(
  value: FinanceDriverResult,
  architecture: FinanceArchitecture,
  architectureRuntime: ArchitectureRuntime,
): void {
  const expectedRoles: Readonly<
    Record<FinanceArchitecture, readonly string[]>
  > = {
    deterministic_only: [],
    host_model_only: ["host"],
    jev_advisory: ["jev"],
    host_plus_jev: ["host", "jev"],
  };
  invariant(
    Array.isArray(value.componentAccounting) &&
      value.componentAccounting.length === expectedRoles[architecture].length,
    `${architecture} component accounting is incomplete`,
  );
  for (const [index, component] of value.componentAccounting.entries()) {
    exactPlainObject(
      component,
      ["costNanoUsd", "inputTokens", "outputTokens", "role"],
      `${architecture} component accounting`,
    );
    invariant(
      component.role === expectedRoles[architecture][index],
      `${architecture} component accounting role is invalid`,
    );
    invariant(
      (component.inputTokens === null) === (component.outputTokens === null),
      `${architecture} component token accounting must be paired`,
    );
    if (component.inputTokens !== null && component.outputTokens !== null) {
      invariant(
        Number.isSafeInteger(component.inputTokens) &&
          component.inputTokens >= 0 &&
          Number.isSafeInteger(component.outputTokens) &&
          component.outputTokens >= 0,
        `${architecture} component tokens are invalid`,
      );
    }
    invariant(
      component.costNanoUsd === null ||
        /^(0|[1-9][0-9]*)$/u.test(component.costNanoUsd),
      `${architecture} component cost is invalid`,
    );
    const pricing = architectureRuntime.components[index]?.pricing ?? null;
    const expectedCost =
      component.inputTokens === null ||
      component.outputTokens === null ||
      pricing === null
        ? null
        : (
            BigInt(component.inputTokens) *
              BigInt(pricing.inputNanoUsdPerToken) +
            BigInt(component.outputTokens) *
              BigInt(pricing.outputNanoUsdPerToken)
          ).toString();
    invariant(
      component.costNanoUsd === expectedCost,
      `${architecture} component cost does not match retained pricing`,
    );
  }
  const tokensKnown = value.componentAccounting.every(
    ({ inputTokens }) => inputTokens !== null,
  );
  const costsKnown = value.componentAccounting.every(
    ({ costNanoUsd }) => costNanoUsd !== null,
  );
  if (value.componentAccounting.length === 0) {
    invariant(
      value.inputTokens === 0 &&
        value.outputTokens === 0 &&
        value.costNanoUsd === "0",
      "deterministic accounting must be exactly zero",
    );
    return;
  }
  invariant(
    tokensKnown === (value.inputTokens !== null),
    `${architecture} aggregate token availability is inconsistent`,
  );
  if (tokensKnown) {
    const inputTotal = value.componentAccounting.reduce(
      (sum, item) => sum + (item.inputTokens ?? 0),
      0,
    );
    const outputTotal = value.componentAccounting.reduce(
      (sum, item) => sum + (item.outputTokens ?? 0),
      0,
    );
    invariant(
      Number.isSafeInteger(inputTotal) &&
        Number.isSafeInteger(outputTotal) &&
        value.inputTokens === inputTotal &&
        value.outputTokens === outputTotal,
      `${architecture} aggregate token accounting is inconsistent`,
    );
  }
  invariant(
    costsKnown === (value.costNanoUsd !== null),
    `${architecture} aggregate cost availability is inconsistent`,
  );
  if (costsKnown) {
    const total = value.componentAccounting.reduce(
      (sum, item) => sum + BigInt(item.costNanoUsd ?? "0"),
      0n,
    );
    invariant(
      value.costNanoUsd === total.toString(),
      `${architecture} aggregate cost is inconsistent`,
    );
  }
}

function validateProbabilities(probabilities: FinanceRouteProbabilities): void {
  exactPlainObject(probabilities, financeRoutes, "finance probabilities");
  const values = financeRoutes.map((route) => probabilities[route]);
  invariant(
    values.every(
      (probability) =>
        typeof probability === "number" &&
        Number.isFinite(probability) &&
        probability >= 0 &&
        probability <= 1,
    ) && Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) <= 1e-6,
    "finance driver probabilities are invalid",
  );
}

function validateDatasetSemantics(
  manifest: FinanceDatasetManifest,
  cases: readonly FinanceBenchmarkCase[],
): void {
  validateSourceUrl(manifest.sourceUrl);
  const trainEnd = timestamp(manifest.trainEnd, "trainEnd");
  const testStart = timestamp(manifest.testStart, "testStart");
  invariant(
    trainEnd < testStart,
    "finance dataset split is not forward in time",
  );
  const ids = new Set<string>();
  const groups = new Map<string, string>();
  for (const entry of cases) {
    invariant(!ids.has(entry.id), `duplicate finance case id: ${entry.id}`);
    ids.add(entry.id);
    const oldSplit = groups.get(entry.groupId);
    invariant(
      oldSplit === undefined || oldSplit === entry.split,
      `finance group crosses splits: ${entry.groupId}`,
    );
    groups.set(entry.groupId, entry.split);
    const observedAt = timestamp(
      entry.trustedProjection.observedAt,
      "observedAt",
    );
    const windowStart = timestamp(
      entry.trustedProjection.windowStart,
      "windowStart",
    );
    const windowEnd = timestamp(entry.trustedProjection.windowEnd, "windowEnd");
    const cutoffAt = timestamp(entry.trustedProjection.cutoffAt, "cutoffAt");
    const evaluationNow = timestamp(entry.evaluationNow, "evaluationNow");
    invariant(
      windowStart <= windowEnd &&
        windowEnd <= cutoffAt &&
        cutoffAt <= observedAt &&
        observedAt <= evaluationNow,
      `finance case ${entry.id} violates temporal ordering`,
    );
    invariant(
      evaluationNow - observedAt <= entry.trustedProjection.maxAgeMs,
      `finance case ${entry.id} is stale at evaluationNow`,
    );
    if (entry.split === "calibration")
      invariant(
        observedAt <= trainEnd,
        `finance calibration case ${entry.id} is after trainEnd`,
      );
    else
      invariant(
        observedAt >= testStart,
        `finance test case ${entry.id} is before testStart`,
      );
    const signalIds = new Set<string>();
    let hasLookahead = false;
    for (const signal of entry.trustedProjection.signals) {
      invariant(
        !signalIds.has(signal.id),
        `finance case ${entry.id} has duplicate signal ids`,
      );
      signalIds.add(signal.id);
      const asOf = timestamp(signal.asOf, "signal asOf");
      invariant(
        asOf >= windowStart && asOf <= observedAt,
        `finance case ${entry.id} signal is outside its observation window`,
      );
      if (asOf > cutoffAt) hasLookahead = true;
    }
    invariant(
      hasLookahead === entry.lookaheadProbe,
      `finance case ${entry.id} lookaheadProbe does not match its signals`,
    );
    validateTrackEvidence(entry);
  }
  for (const track of financeTracks) {
    const test = cases.filter(
      (entry) => entry.track === track && entry.split === "test",
    );
    invariant(
      test.length > 0,
      `finance dataset has no test cases for ${track}`,
    );
    invariant(
      test.some((entry) => entry.lookaheadProbe) &&
        test.some((entry) => !entry.lookaheadProbe),
      `finance test track ${track} needs regular and lookahead cases`,
    );
  }
}

function validateTrackEvidence(entry: FinanceBenchmarkCase): void {
  const trusted = entry.trustedProjection;
  const untrusted = entry.untrustedEvidence;
  if (entry.track === "visual_evidence") {
    invariant(
      trusted.visual !== undefined &&
        untrusted.visual !== undefined &&
        entry.visualArtifact !== undefined &&
        trusted.text === undefined &&
        untrusted.text === undefined,
      `finance visual case ${entry.id} has mismatched evidence`,
    );
    const visual = trusted.visual;
    if (visual === undefined)
      throw new TypeError(
        `finance visual case ${entry.id} has no visual state`,
      );
    const expectedRoute = FINANCE_VISUAL_MUTATION_ROUTES[visual.mutationId];
    invariant(
      visual.schemaVersion === "1" &&
        canonicalJson(visual.renderer) ===
          canonicalJson(FINANCE_CHART_RENDERER) &&
        visual.expectedRoute === expectedRoute &&
        entry.goldRoute === expectedRoute,
      `finance visual case ${entry.id} has an invalid compiler route binding`,
    );
    invariant(
      visual.artifactBindingHash ===
        sha256(
          canonicalJson({
            schemaVersion: "1",
            renderer: FINANCE_CHART_RENDERER,
            sourceBindingHash: visual.sourceBindingHash,
            imageHash: visual.imageHash,
            mutationId: visual.mutationId,
            expectedRoute,
          }),
        ),
      `finance visual case ${entry.id} has an invalid artifact binding`,
    );
  } else if (entry.track === "financial_text_triage") {
    invariant(
      trusted.text !== undefined &&
        untrusted.text !== undefined &&
        entry.visualArtifact === undefined &&
        trusted.visual === undefined &&
        untrusted.visual === undefined,
      `finance text case ${entry.id} has mismatched evidence`,
    );
    const bindings = trusted.text.candidateBindings;
    const excerpts = untrusted.text.excerpts;
    invariant(
      Array.isArray(excerpts) &&
        excerpts.length === bindings.length &&
        excerpts.every((excerpt) => typeof excerpt === "string"),
      `finance text case ${entry.id} has mismatched candidate bindings`,
    );
    invariant(
      new Set(bindings.map((binding) => binding.id)).size === bindings.length,
      `finance text case ${entry.id} has duplicate candidate ids`,
    );
    for (const [index, binding] of bindings.entries())
      invariant(
        binding.excerptHash ===
          `sha256:${createHash("sha256")
            .update(excerpts[index] as string)
            .digest("hex")}`,
        `finance text case ${entry.id} candidate ${binding.id} hash mismatch`,
      );
  } else
    invariant(
      trusted.visual === undefined &&
        trusted.text === undefined &&
        untrusted.visual === undefined &&
        untrusted.text === undefined &&
        entry.visualArtifact === undefined,
      `finance market case ${entry.id} must not carry extracted evidence`,
    );
}

async function validateRetainedVisualArtifacts(
  directory: string,
  cases: readonly FinanceBenchmarkCase[],
): Promise<readonly Readonly<{ path: string; bytes: Uint8Array }>[]> {
  const paths = new Set<string>();
  const retainedArtifacts: Array<
    Readonly<{ path: string; bytes: Uint8Array }>
  > = [];
  for (const entry of cases) {
    if (entry.track !== "visual_evidence") continue;
    const retained = entry.visualArtifact;
    invariant(
      retained !== undefined,
      `finance visual case ${entry.id} has no retained artifact`,
    );
    invariant(
      !paths.has(retained.svgPath),
      `finance visual artifact path is reused: ${retained.svgPath}`,
    );
    paths.add(retained.svgPath);

    const rendered = renderFinanceChart(retained.compilerInput);
    const visual = entry.trustedProjection.visual;
    invariant(
      visual !== undefined &&
        rendered.schemaVersion === visual.schemaVersion &&
        canonicalJson(rendered.renderer) === canonicalJson(visual.renderer) &&
        rendered.mutationId === visual.mutationId &&
        rendered.expectedRoute === visual.expectedRoute &&
        rendered.expectedRoute === entry.goldRoute &&
        rendered.imageHash === visual.imageHash &&
        rendered.sourceBindingHash === visual.sourceBindingHash &&
        rendered.artifactBindingHash === visual.artifactBindingHash,
      `finance visual case ${entry.id} compiler output mismatch`,
    );

    const bytes = await readSafeRelativeFile(
      directory,
      retained.svgPath,
      2 * 1024 * 1024,
    );
    let svg: string;
    try {
      svg = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      throw new TypeError(
        `finance visual artifact ${entry.id} is not valid UTF-8`,
        { cause: error },
      );
    }
    invariant(
      svg === rendered.svg && sha256(bytes) === rendered.imageHash,
      `finance visual case ${entry.id} retained SVG mismatch`,
    );
    retainedArtifacts.push(Object.freeze({ path: retained.svgPath, bytes }));
  }
  const assetEntries = await readdir(join(directory, "assets"), {
    withFileTypes: true,
  });
  const expectedNames = new Set(
    [...paths].map((path) => path.slice("assets/".length)),
  );
  invariant(
    assetEntries.length === expectedNames.size &&
      assetEntries.every(
        (entry) =>
          expectedNames.has(entry.name) &&
          entry.isFile() &&
          !entry.isSymbolicLink(),
      ),
    "finance visual artifact file set does not match visual cases",
  );
  return Object.freeze(retainedArtifacts);
}

function validateDrivers(drivers: FinanceBenchmarkDrivers): void {
  exactPlainObject(drivers, financeArchitectures, "finance drivers");
  for (const architecture of financeArchitectures)
    invariant(
      typeof drivers[architecture] === "function",
      `finance driver ${architecture} is not a function`,
    );
}

function validateRuntime(runtime: FinanceRuntimeProvenance): void {
  exactPlainObject(
    runtime,
    [
      "architectures",
      "concurrency",
      "featureSetHash",
      "hardware",
      "policyVersion",
      "questionSetHash",
      "region",
      "timeoutMs",
    ],
    "finance runtime",
  );
  for (const key of ["questionSetHash", "featureSetHash"] as const)
    invariant(/^sha256:[a-f0-9]{64}$/u.test(runtime[key]), `${key} is invalid`);
  for (const key of ["policyVersion", "hardware", "region"] as const)
    invariant(runtime[key].length > 0, `${key} is required`);
  invariant(
    Number.isSafeInteger(runtime.concurrency) &&
      runtime.concurrency >= 1 &&
      runtime.concurrency <= 16,
    "finance concurrency must be an integer in [1, 16]",
  );
  invariant(
    Number.isSafeInteger(runtime.timeoutMs) &&
      runtime.timeoutMs >= 1 &&
      runtime.timeoutMs <= 300_000,
    "finance timeoutMs must be an integer in [1, 300000]",
  );
  exactPlainObject(
    runtime.architectures,
    financeArchitectures,
    "finance architecture provenance",
  );
  const expectedRoles: Record<FinanceArchitecture, readonly string[]> = {
    deterministic_only: ["deterministic"],
    host_model_only: ["host"],
    jev_advisory: ["jev"],
    host_plus_jev: ["host", "jev"],
  };
  for (const architecture of financeArchitectures) {
    const value = runtime.architectures[architecture];
    exactPlainObject(
      value,
      ["combinerId", "combinerVersion", "components"],
      `finance ${architecture} provenance`,
    );
    invariant(
      value.combinerId.length > 0 && value.combinerVersion.length > 0,
      `${architecture} combiner provenance is required`,
    );
    const roles = value.components.map((component) => component.role);
    invariant(
      roles.length === expectedRoles[architecture].length &&
        roles.every(
          (role, index) => role === expectedRoles[architecture][index],
        ),
      `${architecture} component roles are invalid`,
    );
    for (const component of value.components) {
      exactPlainObject(
        component,
        [
          "modelId",
          "modelVersion",
          "modelVersionEvidence",
          "pricing",
          "probabilitySemantics",
          "providerId",
          "responseModel",
          "role",
        ],
        `${architecture} component`,
      );
      invariant(
        component.providerId.length > 0 &&
          component.modelId.length > 0 &&
          component.modelVersion.length > 0 &&
          component.responseModel.length > 0,
        `${architecture} component identity is required`,
      );
      invariant(
        [
          "none",
          "native_calibrated",
          "normalized_logits",
          "self_reported",
          "synthetic",
          "unknown",
        ].includes(component.probabilitySemantics),
        `${architecture} probability semantics are invalid`,
      );
      if (component.role === "deterministic")
        invariant(
          component.probabilitySemantics === "none" &&
            component.pricing === null &&
            component.modelVersionEvidence.kind === "response_exact" &&
            component.responseModel === component.modelVersion,
          "deterministic provenance cannot claim external model evidence, probabilities, or pricing",
        );
      else {
        validateModelVersionEvidence(component, architecture);
        if (component.pricing !== null)
          validateRuntimePricing(component.pricing, architecture);
      }
    }
  }
  invariant(
    canonicalCompactJson(
      runtime.architectures.host_model_only.components[0],
    ) ===
      canonicalCompactJson(runtime.architectures.host_plus_jev.components[0]),
    "host component provenance must be identical across architectures",
  );
  invariant(
    canonicalCompactJson(runtime.architectures.jev_advisory.components[0]) ===
      canonicalCompactJson(runtime.architectures.host_plus_jev.components[1]),
    "Jev component provenance must be identical across architectures",
  );
}

function validateModelVersionEvidence(
  component: ArchitectureRuntimeComponent,
  architecture: FinanceArchitecture,
): void {
  invariant(
    component.modelVersionEvidence !== null &&
      typeof component.modelVersionEvidence === "object",
    `${architecture} model version evidence is required`,
  );
  if (component.modelVersionEvidence.kind === "response_exact") {
    exactPlainObject(
      component.modelVersionEvidence,
      ["kind"],
      `${architecture} model version evidence`,
    );
    invariant(
      component.responseModel === component.modelVersion,
      `${architecture} response-exact model version does not match the response`,
    );
    return;
  }
  exactPlainObject(
    component.modelVersionEvidence,
    ["evidenceHash", "kind", "observedAt", "sourceUrl"],
    `${architecture} model version evidence`,
  );
  validateSourceUrl(component.modelVersionEvidence.sourceUrl);
  const observedAt = timestamp(
    component.modelVersionEvidence.observedAt,
    "model version evidence observedAt",
  );
  invariant(
    new Date(observedAt).toISOString() ===
      component.modelVersionEvidence.observedAt &&
      /^sha256:[a-f0-9]{64}$/u.test(
        component.modelVersionEvidence.evidenceHash,
      ),
    `${architecture} external model version evidence is invalid`,
  );
}

function validateRuntimePricing(
  pricing: ArchitectureRuntimePricing,
  architecture: FinanceArchitecture,
): void {
  exactPlainObject(
    pricing,
    [
      "inputNanoUsdPerToken",
      "observedAt",
      "outputNanoUsdPerToken",
      "priceHash",
      "priceVersion",
      "sourceUrl",
    ],
    `${architecture} pricing`,
  );
  invariant(
    /^(0|[1-9][0-9]*)$/u.test(pricing.inputNanoUsdPerToken) &&
      /^(0|[1-9][0-9]*)$/u.test(pricing.outputNanoUsdPerToken),
    `${architecture} pricing amounts must be non-negative integer strings`,
  );
  validateSourceUrl(pricing.sourceUrl);
  const observedAt = timestamp(pricing.observedAt, "price observedAt");
  invariant(
    new Date(observedAt).toISOString() === pricing.observedAt,
    `${architecture} pricing observedAt must be canonical ISO-8601 UTC`,
  );
  invariant(
    pricing.priceVersion.length > 0 &&
      /^sha256:[a-f0-9]{64}$/u.test(pricing.priceHash),
    `${architecture} pricing version or hash is invalid`,
  );
}

function validateAndBindRuntimeEvidence(
  runtime: FinanceRuntimeProvenance,
  evidenceValues: readonly FinanceRuntimeEvidence[],
): readonly FinanceRuntimeEvidence[] {
  invariant(
    Array.isArray(evidenceValues) &&
      evidenceValues.length <= maximumRuntimeEvidenceFiles,
    `finance runtime evidence exceeds ${maximumRuntimeEvidenceFiles} files`,
  );
  const provided = new Map<string, FinanceRuntimeEvidence>();
  for (const evidence of evidenceValues) {
    validateRuntimeEvidenceDocument(evidence);
    const canonical = stableJson(evidence);
    invariant(
      new TextEncoder().encode(canonical).byteLength <=
        maximumRuntimeEvidenceBytes,
      "finance runtime evidence exceeds its byte limit",
    );
    const digest = sha256(canonical);
    invariant(
      !provided.has(digest),
      `duplicate finance runtime evidence ${digest}`,
    );
    provided.set(digest, evidence);
  }

  const required = requiredRuntimeEvidence(runtime);
  invariant(
    provided.size === required.size &&
      [...required.keys()].every((digest) => provided.has(digest)),
    "finance runtime evidence file set does not match runtime provenance",
  );
  for (const [digest, expected] of required) {
    invariant(
      stableJson(provided.get(digest)) === stableJson(expected),
      `finance runtime evidence ${digest} does not match runtime provenance`,
    );
  }
  return deepFreeze(
    [...provided.entries()]
      .sort(([left], [right]) => codeUnitCompare(left, right))
      .map(([, evidence]) => structuredClone(evidence)),
  );
}

function requiredRuntimeEvidence(
  runtime: FinanceRuntimeProvenance,
): Map<string, FinanceRuntimeEvidence> {
  const required = new Map<string, FinanceRuntimeEvidence>();
  for (const architecture of financeArchitectures) {
    for (const component of runtime.architectures[architecture].components) {
      if (component.pricing !== null) {
        const pricing: FinanceRuntimeEvidence = {
          schemaVersion: "1",
          kind: "pricing",
          inputNanoUsdPerToken: component.pricing.inputNanoUsdPerToken,
          outputNanoUsdPerToken: component.pricing.outputNanoUsdPerToken,
          sourceUrl: component.pricing.sourceUrl,
          observedAt: component.pricing.observedAt,
          priceVersion: component.pricing.priceVersion,
        };
        addRequiredRuntimeEvidence(
          required,
          component.pricing.priceHash,
          pricing,
        );
      }
      if (component.modelVersionEvidence.kind === "external_attestation") {
        const attestation: FinanceRuntimeEvidence = {
          schemaVersion: "1",
          kind: "model_version",
          sourceUrl: component.modelVersionEvidence.sourceUrl,
          observedAt: component.modelVersionEvidence.observedAt,
          providerId: component.providerId,
          modelId: component.modelId,
          modelVersion: component.modelVersion,
          responseModel: component.responseModel,
        };
        addRequiredRuntimeEvidence(
          required,
          component.modelVersionEvidence.evidenceHash,
          attestation,
        );
      }
    }
  }
  return required;
}

function addRequiredRuntimeEvidence(
  required: Map<string, FinanceRuntimeEvidence>,
  claimedHash: string,
  evidence: FinanceRuntimeEvidence,
): void {
  invariant(
    claimedHash === sha256(stableJson(evidence)),
    `finance runtime evidence ${claimedHash} does not match its canonical metadata`,
  );
  const existing = required.get(claimedHash);
  invariant(
    existing === undefined || stableJson(existing) === stableJson(evidence),
    `finance runtime evidence ${claimedHash} is bound to conflicting metadata`,
  );
  required.set(claimedHash, evidence);
}

function validateRuntimeEvidenceDocument(
  evidence: FinanceRuntimeEvidence,
): void {
  invariant(
    evidence !== null && typeof evidence === "object",
    "finance runtime evidence must be an object",
  );
  if (evidence.kind === "pricing") {
    exactPlainObject(
      evidence,
      [
        "inputNanoUsdPerToken",
        "kind",
        "observedAt",
        "outputNanoUsdPerToken",
        "priceVersion",
        "schemaVersion",
        "sourceUrl",
      ],
      "finance pricing evidence",
    );
    validateRuntimePricing(
      {
        inputNanoUsdPerToken: evidence.inputNanoUsdPerToken,
        outputNanoUsdPerToken: evidence.outputNanoUsdPerToken,
        sourceUrl: evidence.sourceUrl,
        observedAt: evidence.observedAt,
        priceVersion: evidence.priceVersion,
        priceHash: sha256(stableJson(evidence)),
      },
      "host_model_only",
    );
    boundedEvidenceString(evidence.priceVersion, "priceVersion");
  } else {
    exactPlainObject(
      evidence,
      [
        "kind",
        "modelId",
        "modelVersion",
        "observedAt",
        "providerId",
        "responseModel",
        "schemaVersion",
        "sourceUrl",
      ],
      "finance model version evidence",
    );
    validateSourceUrl(evidence.sourceUrl);
    const observedAt = timestamp(
      evidence.observedAt,
      "model version evidence observedAt",
    );
    invariant(
      new Date(observedAt).toISOString() === evidence.observedAt,
      "finance model version evidence observedAt must be canonical ISO-8601 UTC",
    );
    for (const [label, value] of [
      ["providerId", evidence.providerId],
      ["modelId", evidence.modelId],
      ["modelVersion", evidence.modelVersion],
      ["responseModel", evidence.responseModel],
    ] as const)
      boundedEvidenceString(value, label);
  }
  invariant(
    evidence.schemaVersion === "1",
    "finance runtime evidence schemaVersion is invalid",
  );
  invariant(
    evidence.sourceUrl.length <= 2_048,
    "finance runtime evidence sourceUrl is too long",
  );
}

function boundedEvidenceString(value: string, label: string): void {
  invariant(
    typeof value === "string" && value.length > 0 && value.length <= 256,
    `finance runtime evidence ${label} is invalid`,
  );
}

function evidenceFileName(evidence: FinanceRuntimeEvidence): string {
  return `${sha256(stableJson(evidence)).slice("sha256:".length)}.json`;
}

function exactPlainObject(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype,
    `${label} must be a plain object`,
  );
  const keys = Reflect.ownKeys(value);
  invariant(
    keys.length === expectedKeys.length &&
      keys.every(
        (key) => typeof key === "string" && expectedKeys.includes(key),
      ),
    `${label} has unexpected fields`,
  );
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    invariant(
      descriptor !== undefined &&
        "value" in descriptor &&
        descriptor.enumerable,
      `${label} must contain own enumerable data properties`,
    );
  }
}

function validateSchema(schema: object, value: unknown, label: string): void {
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

function validateSourceUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (cause) {
    throw new TypeError("finance sourceUrl must be an absolute URI", { cause });
  }
  invariant(
    parsed.protocol === "https:" &&
      parsed.username.length === 0 &&
      parsed.password.length === 0 &&
      parsed.search.length === 0 &&
      parsed.hash.length === 0 &&
      parsed.href === value,
    "finance sourceUrl must be a canonical credential-free HTTPS URL",
  );
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

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  invariant(Number.isFinite(parsed), `${label} is not a valid timestamp`);
  return parsed;
}

function finiteClock(value: number, label: string): number {
  invariant(Number.isFinite(value) && value >= 0, `${label} is invalid`);
  return value;
}

function portableIdentifier(
  value: string,
  label: string,
  maximum: number,
): void {
  invariant(
    typeof value === "string" &&
      value.length >= 1 &&
      value.length <= maximum &&
      /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(value),
    `${label} is invalid`,
  );
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value as Record<string, unknown>))
    deepFreeze(child);
  return Object.freeze(value);
}

function canonicalCompactJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort(codeUnitCompare)
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  return value;
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TypeError(message);
}

/**
 * Trusted-host boundary for a real fintech comparison.
 *
 * This module deliberately does not load dotenv, discover credentials, or make
 * a network request while parsing and freezing a dataset.  The executable
 * entry point is only a thin host: its credential is an explicitly named
 * process environment value, after --live and readiness validation succeed.
 */
import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Options, ValidateFunction } from "ajv";
import Ajv2020Module from "ajv/dist/2020.js";
import { sha256Digest } from "../../../packages/core/src/index.js";
import { assertFintechEvidence, type FintechEvidence } from "./evidence.mjs";
import {
  createFintechMeasuredEvaluator,
  type FintechBenchmarkCase,
  type FintechProviderWithMetadata,
  runFintechBenchmark,
} from "./runner.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = resolve(root, "fixtures");
const maximumDatasetBytes = 64 * 1024 * 1024;
const nativeProviderId = "typesafe-native" as const;
const nativeJevModel = "jev-1.13.0" as const;
const nativeTransport = "typesafe-sdk-v0.6.0" as const;
const sha256Pattern = /^sha256:[a-f0-9]{64}$/u;
const decimalPattern = /^(0|[1-9]\d{0,18})$/u;
const Ajv2020 = Ajv2020Module as unknown as new (
  options?: Options,
) => { compile(schema: object): ValidateFunction };

export interface FintechLiveDatasetFile {
  readonly format: "fintech-live-dataset-v1";
  readonly run: {
    readonly runId: string;
    readonly createdAt: string;
    readonly preregisteredAt: string;
    readonly frozenAt: string;
  };
  /** Independent, affirmative review record; no implied public-data claim. */
  readonly rightsReview: {
    readonly reviewId: string;
    readonly reviewedAt: string;
    readonly reviewer: string;
    readonly approvedForRetainedBenchmark: true;
    readonly datasetId: string;
    readonly sourceDigest: string;
  };
  readonly dataset: {
    readonly datasetId: string;
    readonly sourceUrl: string;
    readonly sourceDigest: string;
    readonly license: string;
    readonly evidenceClass:
      | "SYNTHETIC"
      | "LOCAL_EXPLORATORY"
      | "RETAINED_PUBLIC";
    readonly redistributionAllowed: true;
    readonly containsPersonalData: false;
    readonly containsRegulatedData: false;
    readonly deidentified: true;
  };
  readonly pricing: {
    readonly inputNanoUsdPerToken: string;
    readonly sourceUrl: string;
    readonly sourceDigest: string;
    readonly observedAt: string;
  };
  readonly limits: {
    readonly concurrency: number;
    readonly maxProviderInvocations: number;
    readonly maxInputTokens: number;
    readonly reservedInputTokensPerInvocation: number;
    readonly maxAttempts: number;
    readonly deadlineMs: number;
    /** A hard upper bound checked before a provider can be constructed. */
    readonly maxCostNanoUsd: string;
  };
  readonly provider: {
    readonly id: "typesafe-native";
    readonly model: "jev-1.13.0";
    readonly transport: "typesafe-sdk-v0.6.0";
  };
  readonly cases: readonly FintechBenchmarkCase[];
}

export interface FintechLiveReadiness {
  readonly format: "fintech-live-readiness-v1";
  readonly provider: Readonly<FintechLiveDatasetFile["provider"]>;
  readonly caseCount: number;
  /** Hash of the immutable host input, not a raw-case retention mechanism. */
  readonly frozenInputDigest: string;
  readonly maximumCostNanoUsd: string;
  readonly networkCallsMade: 0;
}

export interface FintechLiveRunOptions {
  readonly live: true;
  readonly provider: FintechProviderWithMetadata;
  readonly outputPath: string;
}

/**
 * Reads one explicit, bounded, regular dataset file.  This is not dotenv and
 * never consults an ambient .env file.
 */
export async function readFintechLiveDatasetFile(
  path: string,
): Promise<FintechLiveDatasetFile> {
  const absolute = resolve(path);
  const before = await lstat(absolute);
  if (!before.isFile() || before.isSymbolicLink())
    throw new TypeError(
      "live fintech dataset must be a regular non-symlink file",
    );
  if (before.size > maximumDatasetBytes)
    throw new TypeError("live fintech dataset exceeds the 64 MiB limit");
  const handle = await open(
    absolute,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const after = await handle.stat();
    if (!after.isFile() || after.size !== before.size)
      throw new TypeError("live fintech dataset changed while opening");
    return JSON.parse(await handle.readFile("utf8")) as FintechLiveDatasetFile;
  } finally {
    await handle.close();
  }
}

/**
 * Performs every non-network check and returns a frozen, redacted readiness
 * receipt.  Calling this function cannot invoke a provider.
 */
export function assessFintechLiveReadiness(
  file: FintechLiveDatasetFile,
): FintechLiveReadiness {
  const frozen = freezeAndValidate(file);
  return Object.freeze({
    format: "fintech-live-readiness-v1" as const,
    provider: frozen.provider,
    caseCount: frozen.cases.length,
    frozenInputDigest: `sha256:${sha256Digest(
      frozen,
      "jev-fabric/fintech-live-frozen-input/v1",
    )}`,
    maximumCostNanoUsd: frozen.limits.maxCostNanoUsd,
    networkCallsMade: 0 as const,
  });
}

/** Runs all three retained arms, validates schema + semantic evidence, then atomically publishes. */
export async function runAndPublishFintechLiveBenchmark(
  file: FintechLiveDatasetFile,
  options: FintechLiveRunOptions,
): Promise<FintechEvidence> {
  if (options.live !== true)
    throw new TypeError("fintech live execution requires --live");
  const frozen = freezeAndValidate(file);
  assertOutputPath(options.outputPath);
  if (options.provider.id !== nativeProviderId)
    throw new TypeError(
      "fintech live execution requires the allowlisted native TypeSafe provider",
    );
  const evaluator = createFintechMeasuredEvaluator(options.provider, {
    model: frozen.provider.model,
    transport: frozen.provider.transport,
  });
  const evidence = await runFintechBenchmark(frozen.cases, {
    runId: frozen.run.runId,
    createdAt: frozen.run.createdAt,
    preregisteredAt: frozen.run.preregisteredAt,
    frozenAt: frozen.run.frozenAt,
    evaluator,
    dataset: {
      datasetId: frozen.dataset.datasetId,
      sourceUrl: frozen.dataset.sourceUrl,
      license: frozen.dataset.license,
      evidenceClass: frozen.dataset.evidenceClass,
      redistributionAllowed: true,
      containsPersonalData: false,
      containsRegulatedData: false,
      deidentified: true,
    },
    pricing: frozen.pricing,
    limits: {
      concurrency: frozen.limits.concurrency,
      maxProviderInvocations: frozen.limits.maxProviderInvocations,
      maxInputTokens: frozen.limits.maxInputTokens,
      reservedInputTokensPerInvocation:
        frozen.limits.reservedInputTokensPerInvocation,
      maxAttempts: frozen.limits.maxAttempts,
      deadlineMs: frozen.limits.deadlineMs,
    },
  });
  await validateCompletedEvidence(evidence);
  await publishAtomically(options.outputPath, `${JSON.stringify(evidence)}\n`);
  return evidence;
}

/** The CLI credential seam: explicit environment only; never loads .env. */
export function readExplicitCredential(
  variable: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  if (!/^[A-Z][A-Z0-9_]{2,127}$/u.test(variable))
    throw new TypeError("credential environment variable name is invalid");
  const credential = environment[variable];
  if (
    typeof credential !== "string" ||
    credential.length === 0 ||
    credential.length > 16_384 ||
    hasControlCharacter(credential)
  )
    throw new TypeError("explicit live credential is unavailable or invalid");
  return credential;
}

function freezeAndValidate(
  file: FintechLiveDatasetFile,
): Readonly<FintechLiveDatasetFile> {
  if (!isPlainRecord(file) || file.format !== "fintech-live-dataset-v1")
    throw new TypeError("live fintech dataset format is invalid");
  requireExactKeys(
    file,
    [
      "format",
      "run",
      "rightsReview",
      "dataset",
      "pricing",
      "limits",
      "provider",
      "cases",
    ],
    "live fintech dataset",
  );
  requireRecord(file.run, "run");
  requireExactKeys(
    file.run,
    ["runId", "createdAt", "preregisteredAt", "frozenAt"],
    "run",
  );
  for (const [name, value] of Object.entries(file.run))
    requireNonEmptyString(value, `run ${name}`);
  const createdAt = timestamp(file.run.createdAt, "run createdAt");
  const preregisteredAt = timestamp(
    file.run.preregisteredAt,
    "run preregisteredAt",
  );
  const frozenAt = timestamp(file.run.frozenAt, "run frozenAt");
  if (preregisteredAt > frozenAt || frozenAt > createdAt)
    throw new TypeError(
      "run preregistration, freeze, and creation timestamps are out of order",
    );

  requireRecord(file.rightsReview, "rightsReview");
  requireExactKeys(
    file.rightsReview,
    [
      "reviewId",
      "reviewedAt",
      "reviewer",
      "approvedForRetainedBenchmark",
      "datasetId",
      "sourceDigest",
    ],
    "rightsReview",
  );
  requireNonEmptyString(file.rightsReview.reviewId, "rights review ID");
  requireNonEmptyString(file.rightsReview.reviewer, "rights reviewer");
  const reviewedAt = timestamp(
    file.rightsReview.reviewedAt,
    "rights review timestamp",
  );
  if (
    reviewedAt > frozenAt ||
    file.rightsReview.approvedForRetainedBenchmark !== true
  )
    throw new TypeError(
      "rights review must affirmatively approve the frozen retained benchmark",
    );

  requireRecord(file.dataset, "dataset");
  requireExactKeys(
    file.dataset,
    [
      "datasetId",
      "sourceUrl",
      "sourceDigest",
      "license",
      "evidenceClass",
      "redistributionAllowed",
      "containsPersonalData",
      "containsRegulatedData",
      "deidentified",
    ],
    "dataset",
  );
  requireNonEmptyString(file.dataset.datasetId, "dataset ID");
  requireNonEmptyString(file.dataset.license, "dataset license");
  safeHttpsUrl(file.dataset.sourceUrl, "dataset source URL");
  digest(file.dataset.sourceDigest, "dataset source digest");
  if (
    file.rightsReview.datasetId !== file.dataset.datasetId ||
    file.rightsReview.sourceDigest !== file.dataset.sourceDigest ||
    file.dataset.redistributionAllowed !== true ||
    file.dataset.containsPersonalData !== false ||
    file.dataset.containsRegulatedData !== false ||
    file.dataset.deidentified !== true ||
    !["SYNTHETIC", "LOCAL_EXPLORATORY", "RETAINED_PUBLIC"].includes(
      file.dataset.evidenceClass,
    )
  )
    throw new TypeError(
      "dataset rights boundary is invalid or not bound to the review",
    );

  requireRecord(file.pricing, "pricing");
  requireExactKeys(
    file.pricing,
    ["inputNanoUsdPerToken", "sourceUrl", "sourceDigest", "observedAt"],
    "pricing",
  );
  decimal(file.pricing.inputNanoUsdPerToken, "pricing inputNanoUsdPerToken");
  safeHttpsUrl(file.pricing.sourceUrl, "pricing source URL");
  digest(file.pricing.sourceDigest, "pricing source digest");
  if (timestamp(file.pricing.observedAt, "pricing observedAt") > createdAt)
    throw new TypeError("pricing observation cannot occur after run creation");

  requireRecord(file.limits, "limits");
  requireExactKeys(
    file.limits,
    [
      "concurrency",
      "maxProviderInvocations",
      "maxInputTokens",
      "reservedInputTokensPerInvocation",
      "maxAttempts",
      "deadlineMs",
      "maxCostNanoUsd",
    ],
    "limits",
  );
  for (const [name, value] of Object.entries(file.limits)) {
    if (name === "maxCostNanoUsd") decimal(value, "maxCostNanoUsd");
    else if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value <= 0
    )
      throw new RangeError(`${name} must be a positive safe integer`);
  }
  if (
    BigInt(file.limits.maxInputTokens) *
      BigInt(file.pricing.inputNanoUsdPerToken) >
    BigInt(file.limits.maxCostNanoUsd)
  )
    throw new RangeError(
      "maximum token cost exceeds the explicitly approved cost budget",
    );

  requireRecord(file.provider, "provider");
  requireExactKeys(file.provider, ["id", "model", "transport"], "provider");
  if (
    file.provider.id !== nativeProviderId ||
    file.provider.model !== nativeJevModel ||
    file.provider.transport !== nativeTransport
  )
    throw new TypeError(
      "provider is not the pinned allowlisted native TypeSafe Jev provider",
    );
  if (!Array.isArray(file.cases)) throw new TypeError("cases must be an array");

  // JSON-clone plus recursive freeze means approval and projection happen over
  // one immutable snapshot before the provider factory/evaluator is reachable.
  return deepFreeze(structuredClone(file));
}

async function validateCompletedEvidence(
  evidence: FintechEvidence,
): Promise<void> {
  if (evidence.executionState !== "COMPLETED")
    throw new TypeError("live host may only publish completed evidence");
  const schema = JSON.parse(
    await readFile(resolve(root, "schema", "run.schema.jsonc"), "utf8"),
  ) as object;
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
    schema,
  );
  if (!validate(evidence))
    throw new TypeError("completed fintech evidence failed schema validation");
  assertFintechEvidence(evidence);
}

function assertOutputPath(path: string): void {
  if (typeof path !== "string" || path.length === 0)
    throw new TypeError("output path is required");
  const output = resolve(path);
  const relation = relative(fixtureRoot, output);
  if (
    relation === "" ||
    (!relation.startsWith(`..${sep}`) &&
      relation !== ".." &&
      !isAbsolute(relation))
  )
    throw new TypeError(
      "completed fintech evidence must be written outside benchmarks/fintech/fixtures",
    );
}

async function publishAtomically(path: string, content: string): Promise<void> {
  const output = resolve(path);
  const directory = dirname(output);
  await mkdir(directory, { recursive: true });
  const directoryInfo = await lstat(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink())
    throw new TypeError("output directory must be a non-symlink directory");
  try {
    const existing = await lstat(output);
    if (existing.isSymbolicLink())
      throw new TypeError("output path must not be a symlink");
    throw new TypeError("refusing to overwrite an existing evidence artifact");
  } catch (error) {
    if (
      !(error instanceof Error) ||
      (error as NodeJS.ErrnoException).code !== "ENOENT"
    )
      throw error;
  }
  const temporary = resolve(
    directory,
    `.${fileURLToPath(import.meta.url).length}-${process.pid}-${Date.now()}.tmp`,
  );
  let published = false;
  try {
    await writeFile(temporary, content, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    // link(2) atomically creates the final name and, unlike rename, cannot
    // replace an artifact created between the lstat check and publication.
    await link(temporary, output);
    await unlink(temporary);
    published = true;
  } finally {
    if (!published) await unlink(temporary).catch(() => undefined);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function requireRecord(
  value: unknown,
  name: string,
): asserts value is Record<string, unknown> {
  if (!isPlainRecord(value)) throw new TypeError(`${name} must be an object`);
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  name: string,
): void {
  const keys = Object.keys(value);
  if (
    keys.length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key)) ||
    keys.some((key) => !expected.includes(key))
  )
    throw new TypeError(
      `${name} fields are incomplete or contain unknown values`,
    );
}

function requireNonEmptyString(
  value: unknown,
  name: string,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 4_096 ||
    hasControlCharacter(value)
  )
    throw new TypeError(`${name} is invalid`);
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    );
  });
}

function timestamp(value: unknown, name: string): number {
  requireNonEmptyString(value, name);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value)
    throw new TypeError(
      `${name} must be a calendar-valid UTC millisecond timestamp`,
    );
  return parsed;
}

function digest(value: unknown, name: string): void {
  if (typeof value !== "string" || !sha256Pattern.test(value))
    throw new TypeError(`${name} is invalid`);
}

function decimal(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !decimalPattern.test(value))
    throw new TypeError(`${name} is invalid`);
}

function safeHttpsUrl(value: unknown, name: string): void {
  requireNonEmptyString(value, name);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${name} must be an absolute URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password)
    throw new TypeError(
      `${name} must use https and contain no embedded credentials`,
    );
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>))
      deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

async function main(args: readonly string[]): Promise<void> {
  const parsed = parseCli(args);
  const file = await readFintechLiveDatasetFile(parsed.dataset);
  const readiness = assessFintechLiveReadiness(file);
  if (parsed.dryRun) {
    process.stdout.write(`${JSON.stringify(readiness)}\n`);
    return;
  }
  const credential = readExplicitCredential(parsed.credentialEnvironment);
  // Dynamic import keeps dry-run free from provider construction; the adapter
  // itself has no ambient credential lookup and only creates a client here.
  const adapter = await import("@mokimeow/jev-fabric-provider-typesafe");
  const provider = adapter.createNativeJevProvider({ apiKey: credential });
  const evidence = await runAndPublishFintechLiveBenchmark(file, {
    live: true,
    provider,
    outputPath: parsed.output,
  });
  process.stdout.write(
    `${JSON.stringify({ runId: evidence.runId, executionState: evidence.executionState, output: resolve(parsed.output) })}\n`,
  );
}

function parseCli(args: readonly string[]): {
  readonly dataset: string;
  readonly output: string;
  readonly dryRun: boolean;
  readonly credentialEnvironment: string;
} {
  let dataset: string | undefined;
  let output: string | undefined;
  let credentialEnvironment: string | undefined;
  let live = false;
  let dryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--live") {
      live = true;
      continue;
    }
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (
      argument === "--dataset" ||
      argument === "--output" ||
      argument === "--credential-env"
    ) {
      const value = args[index + 1];
      if (!value || value.startsWith("--"))
        throw new TypeError(`${argument} requires a value`);
      index += 1;
      if (argument === "--dataset") dataset = value;
      else if (argument === "--output") output = value;
      else credentialEnvironment = value;
      continue;
    }
    throw new TypeError(`unknown fintech live-host argument: ${argument}`);
  }
  if (
    !dataset ||
    live === dryRun ||
    (!dryRun && (!output || !credentialEnvironment))
  )
    throw new TypeError(
      "usage: live-host.mts --dataset <rights-reviewed.json> --dry-run | --live --credential-env <NAME> --output <new-artifact.json>",
    );
  return {
    dataset,
    output: output ?? "",
    dryRun,
    credentialEnvironment: credentialEnvironment ?? "",
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main(process.argv.slice(2));

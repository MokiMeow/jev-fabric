import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stableJson } from "../../../packages/evals/src/index.js";
import {
  OpenAICompatibleProvider,
  type OpenAICompatibleProviderOptions,
} from "../../../packages/provider-openai-compatible/src/index.js";
import {
  createNativeJevProvider,
  NATIVE_JEV_MODEL,
  NATIVE_JEV_PROVIDER_ID,
} from "../../../packages/provider-typesafe/src/index.js";
import {
  financeSurveillancePack,
  financeSurveillanceQuestionSetHash,
} from "../../../packs/finance-surveillance/pack.js";
import {
  createOpenAICompatibleFinanceInvoker,
  createTrustedFinanceDriverBundle,
  createTypeSafeFinanceInvoker,
  type FinanceProviderLimits,
  type TrustedFinanceDriverBundle,
} from "./drivers.mjs";
import {
  type FinanceRunArtifacts,
  type FinanceRuntimeEvidence,
  loadFinanceDataset,
  runFinanceBenchmark,
  writeFinanceArtifacts,
} from "./run.mjs";

export const OLLAMA_PROVIDER_ID = "ollama-loopback" as const;
export const OLLAMA_ENDPOINT =
  "http://127.0.0.1:11434/v1/chat/completions" as const;
export const ALLOWED_OLLAMA_MODELS = Object.freeze([
  "llama3.2:3b",
  "qwen2.5:7b",
  "qwen3.5:9b",
  "qwen3.5:27b",
] as const);

const policyVersion = "finance.observe-gate.v3";
const tenantId = "finance-live-benchmark";
const maximumCalls = 1_000_000;
const maximumReservedInputTokens = 1_000_000_000;
const maximumEstimatedInputTokensPerCall = 64_000;
const maximumQueue = 100_000;
const maximumDeadlineMs = 300_000;

/**
 * Reviewed 2026-09-21 against https://docs.typesafe.ai/models:
 * Jev 1.13.0 is $42/B input tokens ($0.042/M); output tokens are free.
 */
export const JEV_PRICING_EVIDENCE = Object.freeze({
  schemaVersion: "1",
  kind: "pricing",
  inputNanoUsdPerToken: "42",
  outputNanoUsdPerToken: "0",
  sourceUrl: "https://docs.typesafe.ai/models",
  observedAt: "2026-09-21T00:00:00.000Z",
  priceVersion: "jev-1.13.0-2026-09-21",
} as const satisfies FinanceRuntimeEvidence);

export interface FinanceLiveOptions {
  readonly live: true;
  readonly exploratory: boolean;
  readonly datasetDirectory: string;
  readonly outputDirectory: string;
  readonly runId: string;
  readonly hostProvider: typeof OLLAMA_PROVIDER_ID;
  readonly hostModel: (typeof ALLOWED_OLLAMA_MODELS)[number];
  readonly hostModelVersion: string;
  readonly hostModelVersionUrl: string;
  readonly hostModelVersionObservedAt: string;
  readonly hostEndpoint: typeof OLLAMA_ENDPOINT;
  readonly jevProvider: typeof NATIVE_JEV_PROVIDER_ID;
  readonly jevModel: typeof NATIVE_JEV_MODEL;
  readonly hardware: string;
  readonly region: string;
  readonly limits: FinanceProviderLimits;
  readonly maxFalseObserveGroupRiskUpperBound: number;
  readonly minimumCalibrationGroupsPerPartition: number;
}

export interface FinanceLiveDependencies {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly loadDataset: typeof loadFinanceDataset;
  readonly runBenchmark: typeof runFinanceBenchmark;
  readonly writeArtifacts: typeof writeFinanceArtifacts;
  readonly writeStdout: (value: string) => void;
}

export class FinanceLiveCliError extends Error {
  override readonly name = "FinanceLiveCliError";

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const valueFlags = new Set([
  "--dataset",
  "--output",
  "--run-id",
  "--host-provider",
  "--host-model",
  "--host-model-version",
  "--host-model-version-url",
  "--host-model-version-observed-at",
  "--host-endpoint",
  "--jev-provider",
  "--jev-model",
  "--hardware",
  "--region",
  "--max-calls",
  "--max-reserved-input-tokens",
  "--estimated-input-tokens-per-call",
  "--concurrency",
  "--max-queue",
  "--deadline-ms",
  "--max-false-observe-group-risk-upper-bound",
  "--minimum-calibration-groups-per-partition",
]);

export function parseFinanceLiveArguments(
  argv: readonly string[],
): FinanceLiveOptions {
  const values = new Map<string, string>();
  let live = false;
  let exploratory = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--live") {
      if (live) fail("DUPLICATE_FLAG", "--live may be supplied only once");
      live = true;
      continue;
    }
    if (token === "--exploratory") {
      if (exploratory)
        fail("DUPLICATE_FLAG", "--exploratory may be supplied only once");
      exploratory = true;
      continue;
    }
    if (token === undefined || !valueFlags.has(token))
      fail("UNKNOWN_FLAG", "the live finance command received an unknown flag");
    if (values.has(token))
      fail("DUPLICATE_FLAG", `${token} may be supplied only once`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--"))
      fail("MISSING_FLAG_VALUE", `${token} requires a value`);
    values.set(token, value);
    index += 1;
  }
  if (!live)
    fail("LIVE_ACKNOWLEDGEMENT_REQUIRED", "explicit --live is required");

  const hostProvider = required(values, "--host-provider");
  if (hostProvider !== OLLAMA_PROVIDER_ID)
    fail("HOST_PROVIDER_NOT_ALLOWED", "host provider is not allowlisted");
  const hostEndpoint = required(values, "--host-endpoint");
  if (hostEndpoint !== OLLAMA_ENDPOINT)
    fail("HOST_ENDPOINT_NOT_ALLOWED", "host endpoint is not allowlisted");
  const hostModel = required(values, "--host-model");
  if (!isAllowedOllamaModel(hostModel))
    fail("HOST_MODEL_NOT_ALLOWED", "host model is not allowlisted");
  const hostModelVersion = required(values, "--host-model-version");
  if (!/^sha256:[a-f0-9]{64}$/u.test(hostModelVersion))
    fail(
      "HOST_MODEL_VERSION_INVALID",
      "host model version must be an exact SHA-256 digest",
    );
  const hostModelVersionUrl = canonicalHttpsUrl(
    required(values, "--host-model-version-url"),
    "--host-model-version-url",
  );
  const hostModelVersionObservedAt = exactTimestamp(
    required(values, "--host-model-version-observed-at"),
    "--host-model-version-observed-at",
  );
  const jevProvider = required(values, "--jev-provider");
  if (jevProvider !== NATIVE_JEV_PROVIDER_ID)
    fail("JEV_PROVIDER_NOT_ALLOWED", "Jev provider is not allowlisted");
  const jevModel = required(values, "--jev-model");
  if (jevModel !== NATIVE_JEV_MODEL)
    fail("JEV_MODEL_NOT_ALLOWED", "Jev model is not allowlisted");

  const concurrency = boundedInteger(
    required(values, "--concurrency"),
    "--concurrency",
    1,
    16,
  );
  const limits: FinanceProviderLimits = Object.freeze({
    maxCalls: boundedInteger(
      required(values, "--max-calls"),
      "--max-calls",
      1,
      maximumCalls,
    ),
    maxReservedInputTokens: boundedInteger(
      required(values, "--max-reserved-input-tokens"),
      "--max-reserved-input-tokens",
      1,
      maximumReservedInputTokens,
    ),
    estimatedInputTokensPerCall: boundedInteger(
      required(values, "--estimated-input-tokens-per-call"),
      "--estimated-input-tokens-per-call",
      1,
      maximumEstimatedInputTokensPerCall,
    ),
    concurrency,
    maxQueue: boundedInteger(
      required(values, "--max-queue"),
      "--max-queue",
      1,
      maximumQueue,
    ),
    deadlineMs: boundedInteger(
      required(values, "--deadline-ms"),
      "--deadline-ms",
      1,
      maximumDeadlineMs,
    ),
  });
  if (limits.maxQueue < limits.concurrency)
    fail("INVALID_FLAG_VALUE", "--max-queue must be at least --concurrency");
  const maxFalseObserveGroupRiskUpperBound = boundedNumber(
    required(values, "--max-false-observe-group-risk-upper-bound"),
    "--max-false-observe-group-risk-upper-bound",
    0,
    1,
  );
  const minimumCalibrationGroupsPerPartition = boundedInteger(
    required(values, "--minimum-calibration-groups-per-partition"),
    "--minimum-calibration-groups-per-partition",
    1,
    100_000,
  );

  return Object.freeze({
    live: true,
    exploratory,
    datasetDirectory: resolve(required(values, "--dataset")),
    outputDirectory: resolve(required(values, "--output")),
    runId: boundedText(required(values, "--run-id"), "--run-id", 160),
    hostProvider,
    hostModel,
    hostModelVersion,
    hostModelVersionUrl,
    hostModelVersionObservedAt,
    hostEndpoint,
    jevProvider,
    jevModel,
    hardware: boundedText(required(values, "--hardware"), "--hardware", 240),
    region: boundedText(required(values, "--region"), "--region", 160),
    limits,
    maxFalseObserveGroupRiskUpperBound,
    minimumCalibrationGroupsPerPartition,
  });
}

export function createOllamaFinanceProvider(
  model: (typeof ALLOWED_OLLAMA_MODELS)[number],
): OpenAICompatibleProvider {
  if (!isAllowedOllamaModel(model))
    fail("HOST_MODEL_NOT_ALLOWED", "host model is not allowlisted");
  const options: OpenAICompatibleProviderOptions = {
    id: OLLAMA_PROVIDER_ID,
    endpoint: OLLAMA_ENDPOINT,
    model,
    allowLoopbackHttp: true,
    allowedPorts: [11434],
    maxRedirects: 0,
    repairAttempts: 0,
    structuredOutput: true,
    temperature: 0,
    probabilityMode: "one_hot",
    maxResponseBytes: 1_000_000,
    resolve: async () => {
      throw new TypeError("loopback Ollama must not use DNS resolution");
    },
  };
  return new OpenAICompatibleProvider(options);
}

export function createProductionFinanceDriverBundle(
  options: FinanceLiveOptions,
  apiKey: string,
): TrustedFinanceDriverBundle {
  if (!apiKey || apiKey.trim() !== apiKey)
    fail("TYPESAFE_CREDENTIAL_REQUIRED", "TYPESAFE_API_KEY is required");
  const priceHash = sha256(stableJson(JEV_PRICING_EVIDENCE));
  const hostModelEvidence = createHostModelEvidence(options);
  const hostProvider = createOllamaFinanceProvider(options.hostModel);
  const jevProvider = createNativeJevProvider({ apiKey });
  const host = createOpenAICompatibleFinanceInvoker(hostProvider, {
    modelId: options.hostModel,
    modelVersion: options.hostModelVersion,
    responseModel: options.hostModel,
    modelVersionEvidence: {
      kind: "external_attestation",
      sourceUrl: options.hostModelVersionUrl,
      observedAt: options.hostModelVersionObservedAt,
      evidenceHash: sha256(stableJson(hostModelEvidence)),
    },
  });
  const jev = createTypeSafeFinanceInvoker(jevProvider, {
    modelId: NATIVE_JEV_MODEL,
    modelVersion: NATIVE_JEV_MODEL,
    responseModel: NATIVE_JEV_MODEL,
    pricing: {
      inputNanoUsdPerToken: JEV_PRICING_EVIDENCE.inputNanoUsdPerToken,
      outputNanoUsdPerToken: JEV_PRICING_EVIDENCE.outputNanoUsdPerToken,
      sourceUrl: JEV_PRICING_EVIDENCE.sourceUrl,
      observedAt: JEV_PRICING_EVIDENCE.observedAt,
      priceVersion: JEV_PRICING_EVIDENCE.priceVersion,
      priceHash,
    },
  });
  return createTrustedFinanceDriverBundle({
    tenantId,
    policyVersion,
    host: { invoker: host, limits: options.limits },
    jev: { invoker: jev, limits: options.limits },
  });
}

export async function executeFinanceLiveCli(
  argv: readonly string[],
  overrides: Partial<FinanceLiveDependencies> = {},
): Promise<void> {
  const dependencies: FinanceLiveDependencies = {
    env: process.env,
    loadDataset: loadFinanceDataset,
    runBenchmark: runFinanceBenchmark,
    writeArtifacts: writeFinanceArtifacts,
    writeStdout: (value) => process.stdout.write(value),
    ...overrides,
  };
  const options = parseFinanceLiveArguments(argv);
  const dataset = await dependencies.loadDataset(options.datasetDirectory);
  if (
    dataset.manifest.evidenceClass !== "RETAINED_PUBLIC" &&
    !options.exploratory
  )
    fail(
      "EXPLORATORY_ACKNOWLEDGEMENT_REQUIRED",
      "synthetic and local exploratory datasets require --exploratory",
    );
  validateBudgetAdmission(dataset.cases, options.limits);
  const featureSetHash = singleFeatureSetHash(dataset.cases);
  const apiKey = dependencies.env.TYPESAFE_API_KEY;
  if (apiKey === undefined || apiKey.length === 0 || apiKey.trim() !== apiKey)
    fail("TYPESAFE_CREDENTIAL_REQUIRED", "TYPESAFE_API_KEY is required");

  const bundle = createProductionFinanceDriverBundle(options, apiKey);
  const hostModelEvidence = createHostModelEvidence(options);
  const architectures = {
    ...bundle.architectures,
    // The Jev arm interprets the provider ledger through this exact pack.
    jev_advisory: {
      ...bundle.architectures.jev_advisory,
      combinerId: financeSurveillancePack.manifest.id,
      combinerVersion: financeSurveillancePack.manifest.version,
    },
  };
  const artifacts = await dependencies.runBenchmark({
    runId: options.runId,
    dataset,
    drivers: bundle.drivers,
    runtime: {
      questionSetHash: financeSurveillanceQuestionSetHash,
      policyVersion,
      featureSetHash,
      hardware: options.hardware,
      region: options.region,
      concurrency: options.limits.concurrency,
      timeoutMs: options.limits.deadlineMs,
      architectures,
    },
    runtimeEvidence: [JEV_PRICING_EVIDENCE, hostModelEvidence],
    observeGate: {
      maxFalseObserveGroupRiskUpperBound:
        options.maxFalseObserveGroupRiskUpperBound,
      minimumCalibrationGroupsPerPartition:
        options.minimumCalibrationGroupsPerPartition,
    },
  });
  await dependencies.writeArtifacts(options.outputDirectory, artifacts);
  const budgets = bundle.budgetSnapshots();
  dependencies.writeStdout(
    `${JSON.stringify({
      status: "COMPLETED",
      evidenceClass: dataset.manifest.evidenceClass,
      comparisonCells: 12,
      providers: {
        host: OLLAMA_PROVIDER_ID,
        jev: NATIVE_JEV_PROVIDER_ID,
      },
      calls: {
        host: budgets.host.settled.requests,
        jev: budgets.jev.settled.requests,
      },
      reservedInputTokens: {
        host: budgets.host.settled.tokens,
        jev: budgets.jev.settled.tokens,
      },
      artifactWritten: true,
    })}\n`,
  );
}

function validateBudgetAdmission(
  cases: readonly { readonly lookaheadProbe: boolean }[],
  limits: FinanceProviderLimits,
): void {
  const regularCases = cases.filter((entry) => !entry.lookaheadProbe).length;
  const requiredCalls = checkedMultiply(regularCases, 2, "provider calls");
  const requiredReservation = checkedMultiply(
    requiredCalls,
    limits.estimatedInputTokensPerCall,
    "reserved input tokens",
  );
  if (limits.maxCalls < requiredCalls)
    fail("CALL_BUDGET_TOO_SMALL", "call budget cannot admit the full matrix");
  if (limits.maxReservedInputTokens < requiredReservation)
    fail("TOKEN_BUDGET_TOO_SMALL", "token budget cannot admit the full matrix");
}

function createHostModelEvidence(
  options: FinanceLiveOptions,
): FinanceRuntimeEvidence {
  return Object.freeze({
    schemaVersion: "1",
    kind: "model_version",
    sourceUrl: options.hostModelVersionUrl,
    observedAt: options.hostModelVersionObservedAt,
    providerId: OLLAMA_PROVIDER_ID,
    modelId: options.hostModel,
    modelVersion: options.hostModelVersion,
    responseModel: options.hostModel,
  });
}

function singleFeatureSetHash(
  cases: readonly {
    readonly trustedProjection: { readonly featureSetHash: string };
  }[],
): string {
  const values = new Set(
    cases.map((entry) => entry.trustedProjection.featureSetHash),
  );
  if (values.size !== 1)
    fail(
      "FEATURE_SET_DRIFT",
      "a live run requires one frozen feature-set hash",
    );
  const value = values.values().next().value;
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value))
    fail("FEATURE_SET_DRIFT", "feature-set hash is invalid");
  return value;
}

function required(values: ReadonlyMap<string, string>, flag: string): string {
  const value = values.get(flag);
  if (value === undefined) fail("REQUIRED_FLAG_MISSING", `${flag} is required`);
  return value;
}

function boundedText(value: string, flag: string, maximum: number): string {
  if (
    value.length < 1 ||
    value.length > maximum ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  )
    fail("INVALID_FLAG_VALUE", `${flag} is invalid`);
  return value;
}

function boundedInteger(
  value: string,
  flag: string,
  minimum: number,
  maximum: number,
): number {
  if (!/^(0|[1-9][0-9]*)$/u.test(value))
    fail("INVALID_FLAG_VALUE", `${flag} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    fail("INVALID_FLAG_VALUE", `${flag} is outside its allowed range`);
  return parsed;
}

function boundedNumber(
  value: string,
  flag: string,
  minimum: number,
  maximum: number,
): number {
  if (!/^(?:0(?:\.[0-9]+)?|1(?:\.0+)?)$/u.test(value))
    fail("INVALID_FLAG_VALUE", `${flag} must be a decimal in [0, 1]`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum)
    fail("INVALID_FLAG_VALUE", `${flag} is outside its allowed range`);
  return parsed;
}

function canonicalHttpsUrl(value: string, flag: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail("INVALID_FLAG_VALUE", `${flag} must be canonical HTTPS`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.toString() !== value
  )
    fail("INVALID_FLAG_VALUE", `${flag} must be canonical HTTPS`);
  return value;
}

function exactTimestamp(value: string, flag: string): string {
  const parsed = Date.parse(value);
  if (
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !== value ||
    parsed > Date.now()
  )
    fail("INVALID_FLAG_VALUE", `${flag} must be canonical ISO-8601 UTC`);
  return value;
}

function checkedMultiply(left: number, right: number, name: string): number {
  const result = left * right;
  if (!Number.isSafeInteger(result))
    fail("BUDGET_OVERFLOW", `${name} exceeds safe integer accounting`);
  return result;
}

function isAllowedOllamaModel(
  value: string,
): value is (typeof ALLOWED_OLLAMA_MODELS)[number] {
  return (ALLOWED_OLLAMA_MODELS as readonly string[]).includes(value);
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function fail(code: string, message: string): never {
  throw new FinanceLiveCliError(code, message);
}

async function main(): Promise<void> {
  try {
    await executeFinanceLiveCli(process.argv.slice(2));
  } catch (error) {
    process.exitCode = 1;
    process.stderr.write(
      `${JSON.stringify({
        status: "FAILED",
        error:
          error instanceof FinanceLiveCliError
            ? error.code
            : "FINANCE_LIVE_RUN_FAILED",
        errorType: safeErrorType(error),
        providerCategory: safeProviderCategory(error),
      })}\n`,
    );
  }
}

function safeErrorType(error: unknown): string {
  const name = error instanceof Error ? error.name : "UnknownError";
  return /^(?:FinanceLiveCliError|OpenAICompatibleProviderError|TypeSafeProviderError|ProviderOutageError|TypeError|Error)$/u.test(
    name,
  )
    ? name
    : "UnknownError";
}

function safeProviderCategory(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("category" in error))
    return null;
  const category = (error as { readonly category?: unknown }).category;
  return typeof category === "string" &&
    /^(?:authentication|authorization|invalid_request|rate_limited|unavailable|timeout|cancelled|invalid_response|configuration|network)$/u.test(
      category,
    )
    ? category
    : null;
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
)
  await main();

export type { FinanceRunArtifacts };

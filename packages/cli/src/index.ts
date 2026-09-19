import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import {
  FabricRuntime,
  BudgetLedger,
  DecisionScheduler,
  MemoryDecisionCache,
  ScriptedProvider,
} from "@mokimeow/jev-fabric-core";
import {
  NATIVE_JEV_MODEL,
  createNativeJevProvider,
} from "@mokimeow/jev-fabric-provider-typesafe";
import type { DecisionProvider } from "@mokimeow/jev-fabric-protocol";
import {
  evaluateCases,
  renderReport,
  replayArtifacts,
} from "@mokimeow/jev-fabric-evals";
import {
  createHttpHandler,
  serveStdio,
  type McpRuntime,
} from "@mokimeow/jev-fabric-mcp";

export const CLI_VERSION = "0.1.0-alpha.1";
export const exitCodes = Object.freeze({
  ok: 0,
  usage: 2,
  operation: 3,
  interrupted: 4,
});
export interface CliEnvironment {
  readonly env?: Record<string, string | undefined>;
  readonly cwd?: string;
}
export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Resolved once, then consumed by the executable without reparsing argv. */
  readonly serve?: ResolvedServeConfiguration;
}
export interface ResolvedServeConfiguration {
  readonly transport: "stdio" | "http";
  readonly tokenEnv?: string;
  /** Port zero requests an OS-selected loopback port, reported after bind. */
  readonly port?: number;
  /** Present only for a direct `serve --transport stdio --live` invocation. */
  readonly live?: LiveServeConfiguration;
}
/** Static live controls. This shape deliberately holds an environment *name*, never a secret. */
export interface LiveServeConfiguration {
  readonly provider: "typesafe-native";
  readonly model: typeof NATIVE_JEV_MODEL;
  readonly credentialEnv: string;
  readonly tenantId: string;
  readonly action: string;
  readonly maxCalls: number;
  readonly maxInputTokens: number;
  readonly maxDollarsMicros: bigint;
  readonly inputPricePerMillionMicros: bigint;
  readonly deadlineMs: number;
}
export interface LiveRuntimeFactory {
  create(options: { readonly apiKey: string }): DecisionProvider;
}
type Json = Record<string, unknown>;
const MAX_CONFIG_BYTES = 16_384;
const MAX_CONFIG_FIELDS = 14;
const configEnvironment = Object.freeze({
  provider: "JEV_FABRIC_PROVIDER",
  maxCalls: "JEV_FABRIC_MAX_CALLS",
  maxInputTokens: "JEV_FABRIC_MAX_INPUT_TOKENS",
  maxDollars: "JEV_FABRIC_MAX_DOLLARS",
  deadlineMs: "JEV_FABRIC_DEADLINE_MS",
  format: "JEV_FABRIC_FORMAT",
  bind: "JEV_FABRIC_BIND",
  tokenEnv: "JEV_FABRIC_TOKEN_ENV",
  port: "JEV_FABRIC_PORT",
  model: "JEV_FABRIC_MODEL",
  credentialEnv: "JEV_FABRIC_CREDENTIAL_ENV",
  tenantId: "JEV_FABRIC_TENANT_ID",
  action: "JEV_FABRIC_ACTION",
  inputPricePerMillion: "JEV_FABRIC_INPUT_PRICE_PER_MILLION",
});

/** Programmatic CLI seam used by process-boundary and adapter conformance tests. */
export async function runCli(
  argv: readonly string[],
  environment: CliEnvironment = {},
): Promise<CliResult> {
  const env = environment.env ?? process.env;
  const cwd = environment.cwd ?? process.cwd();
  const parsed = parse(argv);
  const flagJson = parsed.flags.json === true;
  let json = flagJson;
  try {
    if (parsed.flags.version)
      return success(flagJson, { version: CLI_VERSION }, CLI_VERSION);
    if (parsed.flags.help || parsed.command === undefined)
      return success(
        flagJson,
        { command: "help", version: CLI_VERSION },
        help(),
      );
    const config = await loadConfig(parsed.flags.config, cwd);
    const format = setting(
      parsed.flags,
      "format",
      config,
      "format",
      env,
      configEnvironment.format,
    );
    if (format !== undefined && format !== "json" && format !== "human")
      throw new TypeError("format must be json or human");
    json = flagJson || format === "json";
    switch (parsed.command) {
      case "doctor":
        return success(
          json,
          doctor(env, config),
          "doctor: offline capability check passed",
        );
      case "evaluate":
      case "benchmark":
        validateLiveGate(parsed.flags, config, env);
        if (parsed.flags.live)
          return failure(
            json,
            exitCodes.operation,
            "LIVE_NOT_IMPLEMENTED",
            "live execution is not available in this alpha",
          );
        return offlineEvaluation(parsed.command, json);
      case "replay": {
        if (parsed.flags.live)
          return failure(
            json,
            exitCodes.usage,
            "LIVE_NOT_ALLOWED",
            "replay is always offline",
          );
        const directory = stringFlag(parsed.flags, "directory");
        if (!directory)
          return failure(
            json,
            exitCodes.usage,
            "DIRECTORY_REQUIRED",
            "--directory is required for replay",
          );
        const result = await replayArtifacts(directory);
        return success(
          json,
          {
            command: "replay",
            mode: "offline",
            digest: result.digest,
            evidence: result.manifest.evidence,
          },
          result.report,
        );
      }
      case "serve":
        return serveCommand(parsed.flags, config, json, env);
      case "adapters":
        return adaptersCommand(parsed.rest, json);
      default:
        return failure(
          json,
          exitCodes.usage,
          "UNKNOWN_COMMAND",
          `unknown command: ${parsed.command}`,
        );
    }
  } catch (error) {
    return failure(
      json,
      exitCodes.usage,
      "INVALID_ARGUMENT",
      error instanceof Error ? error.message : "invalid argument",
    );
  }
}
export function help(): string {
  return [
    "jev-fabric <command> [options]",
    "Commands: doctor, evaluate, replay, benchmark, serve, adapters generate|validate",
    "Precedence: flag > config > environment > default. Config stores only environment-variable names for credentials.",
    "All commands are offline by default. Live work requires --live plus complete limits.",
  ].join("\n");
}
function parse(argv: readonly string[]) {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const [name, inline] = token.slice(2).split("=", 2);
    if (!name || !/^[a-z][a-z0-9-]*$/u.test(name))
      throw new TypeError("invalid flag");
    if (
      ["json", "live", "help", "version", "public", "secure-mode"].includes(
        name,
      )
    ) {
      if (inline !== undefined)
        throw new TypeError(`--${name} does not take a value`);
      flags[name] = true;
      continue;
    }
    const value = inline ?? argv[++index];
    if (!value || value.startsWith("--"))
      throw new TypeError(`--${name} requires a value`);
    flags[name] = value;
  }
  return { command: positional[0], rest: positional.slice(1), flags };
}
async function loadConfig(
  pathFlag: string | boolean | undefined,
  cwd: string,
): Promise<Json> {
  const requested = typeof pathFlag === "string" ? pathFlag : "jev-fabric.json";
  if (isAbsolute(requested))
    throw new TypeError(
      "config path must be relative to the working directory",
    );
  const path = resolve(cwd, requested);
  if (relative(cwd, path).startsWith(".."))
    throw new TypeError("config path must stay within the working directory");
  try {
    if ((await stat(path)).size > MAX_CONFIG_BYTES)
      throw new TypeError("config exceeds byte limit");
    const raw = await readFile(path, "utf8");
    if (Buffer.byteLength(raw, "utf8") > MAX_CONFIG_BYTES)
      throw new TypeError("config exceeds byte limit");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new TypeError("config must be an object");
    const allowed = new Set([
      "provider",
      "maxCalls",
      "maxInputTokens",
      "maxDollars",
      "deadlineMs",
      "format",
      "bind",
      "tokenEnv",
      "port",
      "model",
      "credentialEnv",
      "tenantId",
      "action",
      "inputPricePerMillion",
    ]);
    const entries = Object.entries(parsed as Json);
    if (entries.length > MAX_CONFIG_FIELDS)
      throw new TypeError("config has too many fields");
    for (const [key, value] of entries) {
      if (!allowed.has(key))
        throw new TypeError(`unsupported config field: ${key}`);
      if (value && typeof value === "object")
        throw new TypeError("config must be a flat bounded object");
      if (typeof value === "string" && Buffer.byteLength(value, "utf8") > 256)
        throw new TypeError("config value exceeds byte limit");
      if (
        /token|secret|password|api.?key|credential/iu.test(key) &&
        (typeof value !== "string" || !/^[A-Z][A-Z0-9_]*$/u.test(value))
      )
        throw new TypeError(
          "config may contain environment-variable names, not secret values",
        );
    }
    return parsed as Json;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}
function doctor(env: Record<string, string | undefined>, config: Json): Json {
  const references = Object.values(config).filter(
    (value): value is string =>
      typeof value === "string" && /^[A-Z][A-Z0-9_]*$/u.test(value),
  );
  return {
    command: "doctor",
    version: CLI_VERSION,
    network: "not_used",
    credentials: references.map((name) => ({
      name,
      present: Boolean(env[name]),
    })),
    capabilities: [
      "offline-evaluate",
      "offline-replay",
      "mcp-stdio",
      "mcp-loopback-http",
    ],
  };
}
function validateLiveGate(
  flags: Record<string, string | boolean>,
  config: Json,
  env: Record<string, string | undefined>,
): void {
  if (!flags.live) return;
  // Live is an invocation-only consent signal. Config and environment can
  // refine bounds, but can never enable a provider operation by themselves.
  const provider = setting(
    flags,
    "provider",
    config,
    "provider",
    env,
    configEnvironment.provider,
  );
  const calls = positiveInteger(
    setting(
      flags,
      "max-calls",
      config,
      "maxCalls",
      env,
      configEnvironment.maxCalls,
    ),
  );
  const tokens = positiveInteger(
    setting(
      flags,
      "max-input-tokens",
      config,
      "maxInputTokens",
      env,
      configEnvironment.maxInputTokens,
    ),
  );
  const deadline = positiveInteger(
    setting(
      flags,
      "deadline-ms",
      config,
      "deadlineMs",
      env,
      configEnvironment.deadlineMs,
    ),
  );
  const dollars = setting(
    flags,
    "max-dollars",
    config,
    "maxDollars",
    env,
    configEnvironment.maxDollars,
  );
  if (
    !provider ||
    !calls ||
    !tokens ||
    !deadline ||
    !dollars ||
    parseMicros(dollars) <= 0n
  )
    throw new TypeError(
      "--live requires provider, --max-calls, --max-input-tokens, --max-dollars, and --deadline-ms with positive values",
    );
}

function resolveLiveServeConfiguration(
  flags: Record<string, string | boolean>,
  config: Json,
  env: Record<string, string | undefined>,
): LiveServeConfiguration {
  const provider = setting(
    flags,
    "provider",
    config,
    "provider",
    env,
    configEnvironment.provider,
  );
  const model = setting(
    flags,
    "model",
    config,
    "model",
    env,
    configEnvironment.model,
  );
  const credentialEnv = setting(
    flags,
    "credential-env",
    config,
    "credentialEnv",
    env,
    configEnvironment.credentialEnv,
  );
  const tenantId = setting(
    flags,
    "tenant-id",
    config,
    "tenantId",
    env,
    configEnvironment.tenantId,
  );
  const action = setting(
    flags,
    "action",
    config,
    "action",
    env,
    configEnvironment.action,
  );
  const maxCalls = positiveInteger(
    setting(
      flags,
      "max-calls",
      config,
      "maxCalls",
      env,
      configEnvironment.maxCalls,
    ),
  );
  const maxInputTokens = positiveInteger(
    setting(
      flags,
      "max-input-tokens",
      config,
      "maxInputTokens",
      env,
      configEnvironment.maxInputTokens,
    ),
  );
  const deadlineMs = positiveInteger(
    setting(
      flags,
      "deadline-ms",
      config,
      "deadlineMs",
      env,
      configEnvironment.deadlineMs,
    ),
  );
  const dollars = setting(
    flags,
    "max-dollars",
    config,
    "maxDollars",
    env,
    configEnvironment.maxDollars,
  );
  const price = setting(
    flags,
    "input-price-per-million",
    config,
    "inputPricePerMillion",
    env,
    configEnvironment.inputPricePerMillion,
  );
  if (
    provider !== "typesafe-native" ||
    model !== NATIVE_JEV_MODEL ||
    !validEnvironmentName(credentialEnv) ||
    !validIdentifier(tenantId) ||
    !validIdentifier(action) ||
    !maxCalls ||
    !maxInputTokens ||
    !deadlineMs ||
    !dollars ||
    !price
  )
    throw new TypeError(
      "live stdio requires --provider typesafe-native, --model jev-1.13.0, --credential-env, --tenant-id, --action, --max-calls, --max-input-tokens, --max-dollars, --input-price-per-million, and --deadline-ms",
    );
  const maxDollarsMicros = parseMicros(dollars);
  const inputPricePerMillionMicros = parseMicros(price);
  if (maxDollarsMicros <= 0n || inputPricePerMillionMicros <= 0n)
    throw new TypeError(
      "live dollar and input-price ceilings must be positive",
    );
  // ceil(total tokens × price per million) is the declared admission ceiling.
  const admittedCost =
    (BigInt(maxInputTokens) * inputPricePerMillionMicros + 999_999n) /
    1_000_000n;
  if (admittedCost > maxDollarsMicros)
    throw new TypeError(
      "max input tokens times the operator input-price ceiling exceeds max dollars",
    );
  return {
    provider: "typesafe-native",
    model: NATIVE_JEV_MODEL,
    credentialEnv,
    tenantId,
    action,
    maxCalls,
    maxInputTokens,
    maxDollarsMicros,
    inputPricePerMillionMicros,
    deadlineMs,
  };
}
function offlineEvaluation(
  command: "evaluate" | "benchmark",
  json: boolean,
): CliResult {
  const evaluation = evaluateCases(
    [
      {
        id: "offline-correct",
        groupId: "offline",
        goldLabel: "allow",
        outcome: "correct" as const,
      },
      {
        id: "offline-abstain",
        groupId: "offline",
        goldLabel: "ask",
        outcome: "abstained" as const,
      },
    ],
    { seed: 7, replicates: 16 },
  );
  const metrics = {
    accuracy: evaluation.accuracy.value,
    coverage: evaluation.coverage.value,
  };
  const report = renderReport({
    title: `Jev Fabric ${command} (offline)`,
    evidence: "unit",
    metrics,
    runId: `offline-${command}-v1`,
    environmentId: "scripted",
    versions: { runtime: "scripted" },
    denominators: { cases: 2 },
    independentGroups: evaluation.independentGroups,
    invalidResponses: evaluation.invalidResponses,
    abstentions: evaluation.abstentions,
    limitations: ["scripted offline fixture; no provider network calls"],
  });
  return success(
    json,
    {
      command,
      mode: "offline",
      evidence: "unit",
      live: false,
      metrics,
      report,
    },
    report,
  );
}
function serveCommand(
  flags: Record<string, string | boolean>,
  config: Json,
  json: boolean,
  env: Record<string, string | undefined>,
): CliResult {
  const transport = stringFlag(flags, "transport") ?? "stdio";
  if (transport !== "stdio" && transport !== "http")
    return failure(
      json,
      exitCodes.usage,
      "INVALID_TRANSPORT",
      "--transport must be stdio or http",
    );
  if (flags.live) {
    if (transport !== "stdio")
      return failure(
        json,
        exitCodes.usage,
        "LIVE_HTTP_FORBIDDEN",
        "live serving is available only over local stdio",
      );
    const live = resolveLiveServeConfiguration(flags, config, env);
    return {
      ...success(
        json,
        {
          command: "serve",
          transport: "stdio",
          mode: "live",
          provider: live.provider,
          model: live.model,
          credentialEnv: live.credentialEnv,
          tenantId: live.tenantId,
          action: live.action,
          maxCalls: live.maxCalls,
          maxInputTokens: live.maxInputTokens,
          maxDollarsMicros: live.maxDollarsMicros.toString(),
          inputPricePerMillionMicros:
            live.inputPricePerMillionMicros.toString(),
          deadlineMs: live.deadlineMs,
        },
        "serve live stdio configuration accepted",
      ),
      serve: { transport, live },
    };
  }
  if (transport === "http") {
    const tokenEnv = setting(
      flags,
      "token-env",
      config,
      "tokenEnv",
      env,
      configEnvironment.tokenEnv,
    );
    const token = tokenEnv ? env[tokenEnv] : undefined;
    if (!tokenEnv || !token)
      return failure(
        json,
        exitCodes.usage,
        "HTTP_TOKEN_REQUIRED",
        "HTTP serve requires --token-env naming a present bearer token",
      );
    const bind =
      setting(flags, "bind", config, "bind", env, configEnvironment.bind) ??
      "loopback";
    if ((flags.public || bind !== "loopback") && !flags["secure-mode"])
      return failure(
        json,
        exitCodes.usage,
        "PUBLIC_BIND_FORBIDDEN",
        "public HTTP binding requires --secure-mode and external auth/TLS configuration",
      );
    if (flags.public || bind !== "loopback")
      return failure(
        json,
        exitCodes.usage,
        "PUBLIC_BIND_UNSUPPORTED",
        "this CLI supports loopback HTTP only",
      );
    const port = boundedPort(
      settingNumber(flags, "port", config, "port", env, configEnvironment.port),
    );
    return {
      ...success(
        json,
        {
          command: "serve",
          transport: "http",
          bind: "loopback",
          started: false,
        },
        "serve HTTP configuration accepted",
      ),
      serve: { transport, tokenEnv, port },
    };
  }
  return {
    ...success(
      json,
      { command: "serve", transport: "stdio", started: false },
      "serve stdio configuration accepted",
    ),
    serve: { transport },
  };
}
function adaptersCommand(rest: readonly string[], json: boolean): CliResult {
  const subcommand = rest[0];
  if (subcommand !== "generate" && subcommand !== "validate")
    return failure(
      json,
      exitCodes.usage,
      "ADAPTER_SUBCOMMAND_REQUIRED",
      "adapters requires generate or validate",
    );
  const contract = {
    schemaVersion: "1",
    command: "jev-fabric",
    mcp: {
      stdio: ["jev-fabric", "serve", "--transport", "stdio"],
      http: { defaultBind: "loopback", advisory: true },
    },
    environmentReferences: [
      "JEV_FABRIC_PROVIDER",
      "JEV_FABRIC_MAX_CALLS",
      "JEV_FABRIC_MAX_INPUT_TOKENS",
      "JEV_FABRIC_MAX_DOLLARS",
      "JEV_FABRIC_DEADLINE_MS",
      "JEV_FABRIC_MODEL",
      "JEV_FABRIC_CREDENTIAL_ENV",
      "JEV_FABRIC_TENANT_ID",
      "JEV_FABRIC_ACTION",
      "JEV_FABRIC_INPUT_PRICE_PER_MILLION",
    ],
    unsupported: ["execution", "authorization-grant", "ACP"],
  };
  return success(
    json,
    {
      command: "adapters",
      subcommand,
      status: subcommand === "validate" ? "VALID" : "DRY_RUN",
      contract,
    },
    `adapters ${subcommand}: ${subcommand === "validate" ? "valid contract" : "dry run"}`,
  );
}
function validEnvironmentName(value: string | undefined): value is string {
  return value !== undefined && /^[A-Z][A-Z0-9_]{0,127}$/u.test(value);
}
function validIdentifier(value: string | undefined): value is string {
  return value !== undefined && /^[A-Za-z0-9._:-]{1,128}$/u.test(value);
}
function success(json: boolean, value: Json, human: string): CliResult {
  return {
    exitCode: exitCodes.ok,
    stdout: json ? `${JSON.stringify(sanitize(value))}\n` : `${human}\n`,
    stderr: "",
  };
}
function failure(
  json: boolean,
  exitCode: number,
  code: string,
  message: string,
): CliResult {
  const body = { error: { code, message: redact(message) } };
  return {
    exitCode,
    stdout: json ? `${JSON.stringify(body)}\n` : "",
    stderr: json ? "" : `${body.error.code}: ${body.error.message}\n`,
  };
}
function sanitize(value: unknown): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Json).map(([key, child]) =>
        /secret|token|password|api.?key/iu.test(key)
          ? [key, "[REDACTED]"]
          : [key, sanitize(child)],
      ),
    );
  return value;
}
function redact(value: string): string {
  return value.replace(
    /(?:sk|key|token|bearer)[-_A-Za-z0-9]{8,}/giu,
    "[REDACTED]",
  );
}
function stringFlag(
  flags: Record<string, string | boolean>,
  name: string,
): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}
function value(config: Json, name: string): string | undefined {
  return typeof config[name] === "string"
    ? (config[name] as string)
    : undefined;
}
function setting(
  flags: Record<string, string | boolean>,
  flag: string,
  config: Json,
  configKey: string,
  env: Record<string, string | undefined>,
  envKey: string,
): string | undefined {
  return stringFlag(flags, flag) ?? value(config, configKey) ?? env[envKey];
}
function settingNumber(
  flags: Record<string, string | boolean>,
  flag: string,
  config: Json,
  configKey: string,
  env: Record<string, string | undefined>,
  envKey: string,
): string | number | undefined {
  const fromConfig = config[configKey];
  return (
    stringFlag(flags, flag) ??
    (typeof fromConfig === "string" || typeof fromConfig === "number"
      ? fromConfig
      : undefined) ??
    env[envKey]
  );
}
function boundedPort(value: string | number | undefined): number {
  if (value === undefined) return 0;
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^\d+$/u.test(String(value))
  )
    throw new TypeError("port must be an integer between 0 and 65535");
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535)
    throw new TypeError("port must be an integer between 0 and 65535");
  return port;
}
function positiveInteger(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/u.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}
export function parseMicros(value: string): bigint {
  if (!/^\d+(?:\.\d{1,6})?$/u.test(value))
    throw new TypeError(
      "dollars must be a non-negative decimal with at most six places",
    );
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole ?? "0") * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

export interface NodeHttpServerOptions {
  readonly bearerToken?: string;
  readonly runtime?: McpRuntime;
  readonly deadlineMs?: number;
  readonly maxBodyBytes?: number;
  /** Covers admission, preflight, upload, authorization, and evaluation. */
  readonly maxConcurrency?: number;
  readonly handler?: { fetch(request: Request): Promise<Response> };
}
/** Node boundary adapter. The optional handler seam is for loopback cancellation tests. */
export function createNodeHttpServer(options: NodeHttpServerOptions): Server {
  const deadlineMs = boundedNode(options.deadlineMs ?? 30_000, 1, 60_000);
  const maxBodyBytes = boundedNode(
    options.maxBodyBytes ?? 262_144,
    1,
    1_000_000,
  );
  const maxConcurrency = boundedNode(options.maxConcurrency ?? 32, 1, 128);
  const handler =
    options.handler ??
    createHttpHandler({
      runtime: options.runtime ?? offlineRuntime(),
      deadlineMs,
      maxBodyBytes,
      maxConcurrency,
      ...(options.bearerToken === undefined
        ? {}
        : { bearerToken: options.bearerToken }),
    });
  let active = 0;
  return createServer(async (request, response) => {
    if (active >= maxConcurrency) {
      await writeNode(response, nodeReject(429, "CONCURRENCY_LIMIT"));
      return;
    }
    active += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deadlineMs);
    const abort = () => controller.abort();
    request.once("aborted", abort);
    // IncomingMessage emits `close` after an uploaded request whose client
    // disconnects before a response. ServerResponse covers the inverse race.
    const abortRequestClose = () => {
      if (request.socket.destroyed && !response.writableEnded)
        controller.abort();
    };
    const abortResponseClose = () => {
      if (!response.writableEnded) controller.abort();
    };
    request.once("close", abortRequestClose);
    response.once("close", abortResponseClose);
    try {
      const early = nodePreflight(request, maxBodyBytes);
      if (early) {
        await writeNode(response, early);
        return;
      }
      const path = new URL(request.url ?? "/", "http://localhost");
      if (path.pathname !== "/mcp" || path.search !== "") {
        await writeNode(response, nodeReject(404, "MCP_PATH_NOT_FOUND"));
        return;
      }
      const url = `http://${request.headers.host ?? "localhost"}${request.url ?? "/"}`;
      const method = request.method ?? "POST";
      const body =
        method === "GET" || method === "HEAD"
          ? undefined
          : await readIncoming(request, controller.signal, maxBodyBytes);
      const init: RequestInit =
        body === undefined
          ? {
              method,
              headers: request.headers as HeadersInit,
              signal: controller.signal,
            }
          : {
              method,
              headers: request.headers as HeadersInit,
              body: body as unknown as BodyInit,
              signal: controller.signal,
            };
      const result = await boundedHandlerFetch(
        handler,
        new Request(url, init),
        controller.signal,
      );
      if (controller.signal.aborted) {
        await writeNode(response, nodeReject(408, "DEADLINE_EXCEEDED"));
        return;
      }
      await writeNode(response, result);
    } catch {
      await writeNode(
        response,
        new Response(
          JSON.stringify({
            code: controller.signal.aborted
              ? "DEADLINE_EXCEEDED"
              : "BODY_TOO_LARGE",
          }),
          {
            status: controller.signal.aborted ? 408 : 413,
            headers: { "content-type": "application/json" },
          },
        ),
      );
    } finally {
      clearTimeout(timer);
      request.removeListener("aborted", abort);
      request.removeListener("close", abortRequestClose);
      response.removeListener("close", abortResponseClose);
      active -= 1;
    }
  });
}
/**
 * The exported handler seam is allowed to be arbitrary user code. Observe its
 * eventual settlement, but do not let a handler that ignores AbortSignal hold
 * a listener slot after the caller disconnects or the one request deadline
 * expires.
 */
function boundedHandlerFetch(
  handler: { fetch(request: Request): Promise<Response> },
  request: Request,
  signal: AbortSignal,
): Promise<Response> {
  const pending = Promise.resolve().then(() => handler.fetch(request));
  // Keep a late rejection observed after the abort race has already returned.
  void pending.catch(() => undefined);
  if (signal.aborted) return Promise.reject(new Error("aborted"));
  return new Promise<Response>((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(new Error("aborted"));
    };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    void pending.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}
/** Starts only the deliberately bounded loopback server used by the executable. */
export function startHttpServer(port: number, token: string): Server {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535)
    throw new TypeError("invalid port");
  return createNodeHttpServer({ bearerToken: token }).listen(port, "127.0.0.1");
}
function nodePreflight(
  request: IncomingMessage,
  maxBodyBytes: number,
): Response | undefined {
  const critical = new Set([
    "host",
    "authorization",
    "content-length",
    "content-type",
    "transfer-encoding",
  ]);
  const seen = new Set<string>();
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index]?.toLowerCase();
    if (name && critical.has(name)) {
      if (seen.has(name)) return nodeReject(400, "DUPLICATE_CRITICAL_HEADER");
      seen.add(name);
    }
  }
  const length = request.headers["content-length"];
  if (
    typeof length === "string" &&
    (!/^\d+$/u.test(length) || Number(length) > maxBodyBytes)
  )
    return nodeReject(413, "BODY_TOO_LARGE");
  if (request.headers["transfer-encoding"])
    return nodeReject(400, "CHUNKED_BODY_FORBIDDEN");
  return undefined;
}
function nodeReject(status: number, code: string): Response {
  return new Response(JSON.stringify({ code }), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}
async function readIncoming(
  request: IncomingMessage,
  signal: AbortSignal,
  maxBytes: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      request.removeListener("data", onData);
      request.removeListener("end", onEnd);
      request.removeListener("error", onError);
      signal.removeEventListener("abort", onAbort);
      error ? reject(error) : resolve(Buffer.concat(chunks, size));
    };
    const onData = (chunk: Buffer | string) => {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += value.byteLength;
      if (size > maxBytes) {
        request.destroy();
        finish(new RangeError("body too large"));
        return;
      }
      chunks.push(value);
    };
    const onEnd = () => finish();
    const onError = (error: Error) => finish(error);
    const onAbort = () => {
      if (!request.complete) request.destroy();
      finish(new Error("aborted"));
    };
    request.on("data", onData);
    request.once("end", onEnd);
    request.once("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
function boundedNode(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new RangeError("HTTP listener option is out of range");
  return value;
}
async function writeNode(
  response: ServerResponse,
  result: Response,
): Promise<void> {
  if (response.destroyed) return;
  response.writeHead(result.status, Object.fromEntries(result.headers));
  response.end(Buffer.from(await result.arrayBuffer()));
}
/**
 * Builds the only live runtime composition supplied by the alpha CLI. The
 * caller must resolve the secret after parsing all static controls; this
 * function neither reads process.env nor creates an HTTP listener.
 */
export function createLiveMcpRuntime(
  configuration: LiveServeConfiguration,
  apiKey: string,
  factory: LiveRuntimeFactory = { create: createNativeJevProvider },
): McpRuntime {
  if (!apiKey) throw new TypeError("live credential is required");
  const provider = factory.create({ apiKey });
  const runtime = new FabricRuntime({
    provider,
    model: configuration.model,
    cache: new MemoryDecisionCache({ maxEntries: 100 }),
    scheduler: new DecisionScheduler({
      providerConcurrency: 1,
      tenantConcurrency: 1,
      maxQueue: 4,
      budget: new BudgetLedger({
        requests: configuration.maxCalls,
        tokens: configuration.maxInputTokens,
      }),
    }),
    // Floor reservation deliberately never exceeds the declared total. A
    // request may be rejected before maxCalls when the total input ceiling is
    // exhausted; this is safer than pretending actual billing is observable.
    estimatedTokens: Math.max(
      1,
      Math.floor(configuration.maxInputTokens / configuration.maxCalls),
    ),
    retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 },
  });
  return {
    evaluate: async (input) =>
      runtime.evaluate({
        pack: input.pack,
        state: input.state,
        // Tool-supplied identity, action, knownActions, risk, authorization,
        // and rules never cross this operator-controlled live boundary.
        tenantId: configuration.tenantId,
        action: configuration.action,
        knownActions: [configuration.action],
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        deadlineMs: Math.min(
          input.deadlineMs ?? configuration.deadlineMs,
          configuration.deadlineMs,
        ),
      }),
  };
}
export function startStdioServer(
  options: {
    readonly live?: LiveServeConfiguration;
    /** One resolved credential value; never output or retained in a receipt. */
    readonly apiKey?: string;
    readonly factory?: LiveRuntimeFactory;
  } = {},
) {
  const runtime =
    options.live === undefined
      ? offlineRuntime()
      : createLiveMcpRuntime(
          options.live,
          options.apiKey ?? "",
          options.factory,
        );
  return serveStdio({ runtime });
}
function offlineRuntime(): FabricRuntime {
  return new FabricRuntime({
    provider: new ScriptedProvider({
      id: "offline",
      model: "offline",
      steps: [],
    }),
    model: "offline",
    cache: new MemoryDecisionCache({ maxEntries: 100 }),
    scheduler: new DecisionScheduler({
      providerConcurrency: 1,
      tenantConcurrency: 1,
      maxQueue: 4,
      budget: new BudgetLedger({ requests: 100, tokens: 1_000_000 }),
    }),
  });
}

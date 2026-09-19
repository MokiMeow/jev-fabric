import { z } from "zod";

export const ADAPTER_SCHEMA_VERSION = "1" as const;
export const ADAPTER_PROVENANCE = "jev-fabric-adapter/v1" as const;

const unsafeMachinePath =
  /(?:[A-Za-z]:[\\/]|\\\\|(?:^|[\s"'=:[{,(])\/+(?:[A-Za-z0-9._-]+(?:\/|$))?|(?:^|[\s"'=])~[\\/])/u;
const credentialValue =
  /(?:(?:api[_ -]?key|secret|password|token|credential)\s*["']?\s*(?:=|:)\s*["']?[^\s"',}\]]{6,}|(?:authorization\s*:\s*["']?\s*)?bearer\s+[A-Za-z0-9._~+/=:-]{8,})/iu;
const safeText = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (value) => !unsafeMachinePath.test(value),
    "machine paths are forbidden",
  )
  .refine(
    (value) => !credentialValue.test(value),
    "credential-like values are forbidden",
  );

/** Final defense for generated serializations, independent of typed parsing. */
export function assertSafeGeneratedText(value: string): void {
  if (unsafeMachinePath.test(value))
    throw new TypeError("generated output contains a machine path");
  if (credentialValue.test(value))
    throw new TypeError("generated output contains a credential-like value");
}
const relativePath = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (path) =>
      !unsafeMachinePath.test(path) &&
      !/^(?:[\\/]|~)/u.test(path) &&
      !path.split(/[\\/]/u).includes(".."),
    "path must be a relative, portable path",
  );
export const HostIdSchema = z.enum([
  "codex",
  "claude-code",
  "gemini-cli",
  "qwen-code",
  "kimi-cli",
]);
export type HostId = z.infer<typeof HostIdSchema>;
export const CompatibilityStatusSchema = z.enum([
  "IMPLEMENTED",
  "TESTED",
  "UNSUPPORTED",
  "NOT_RUN",
]);
export type CompatibilityStatus = z.infer<typeof CompatibilityStatusSchema>;
export const FeatureStatusSchema = z.enum([
  "IMPLEMENTED",
  "NOT_GENERATED",
  "UNSUPPORTED",
]);
export type FeatureStatus = z.infer<typeof FeatureStatusSchema>;

/** Event names are normalized; a host may map only its documented entries. */
export const NormalizedEventSchema = z.enum([
  "before-tool",
  "after-tool",
  "session-start",
  "session-end",
]);
export type NormalizedEvent = z.infer<typeof NormalizedEventSchema>;

const hostSchema = z
  .object({
    id: HostIdSchema,
    displayName: safeText.max(80),
    serverName: z.string().regex(/^[a-z][a-z0-9-]*$/u),
    configurationPath: relativePath,
    format: z.enum([
      "toml-mcp",
      "mcp-json",
      "gemini-extension",
      "qwen-extension",
    ]),
    mcpRoot: z.literal("mcpServers"),
    supports: z
      .object({
        stdio: z.boolean(),
        http: z.boolean(),
        skills: FeatureStatusSchema,
        hooks: FeatureStatusSchema,
      })
      .strict(),
    hooks: z.partialRecord(NormalizedEventSchema, safeText).default({}),
    install: z
      .object({
        scope: z.enum(["project", "plugin", "command-line"]),
        location: relativePath,
      })
      .strict(),
    testStatus: CompatibilityStatusSchema,
    unsupported: z.array(safeText).max(12),
  })
  .strict();

export const AdapterModelSchema = z
  .object({
    schemaVersion: z.literal(ADAPTER_SCHEMA_VERSION),
    provenance: z.literal(ADAPTER_PROVENANCE),
    installationRoot: relativePath,
    package: z
      .object({
        name: z.literal("@mokimeow/jev-fabric-cli"),
        binary: z.literal("jev-fabric"),
        version: z.literal("0.1.0-alpha.1"),
      })
      .strict(),
    mcp: z
      .object({
        command: z.literal("jev-fabric"),
        args: z.tuple([
          z.literal("serve"),
          z.literal("--transport"),
          z.literal("stdio"),
        ]),
        advisory: z.literal(true),
        // Local stdio uses the host process boundary; generated artifacts never
        // advertise credentials or HTTP bearer-token configuration.
        environmentNames: z.tuple([]),
      })
      .strict(),
    skill: z
      .object({
        path: relativePath,
        pluginPath: relativePath,
        files: z.tuple([
          z.literal("SKILL.md"),
          z.literal("references/pack-selection.md"),
          z.literal("references/security-boundary.md"),
        ]),
        instructions: z.literal("advisory-only"),
      })
      .strict(),
    hosts: z.array(hostSchema).length(5),
  })
  .strict();
export type AdapterModel = z.infer<typeof AdapterModelSchema>;

/** Canonical contract deliberately has no provider credential values or URLs. */
export const canonicalAdapterModel: AdapterModel = {
  schemaVersion: ADAPTER_SCHEMA_VERSION,
  provenance: ADAPTER_PROVENANCE,
  installationRoot: "integrations",
  package: {
    name: "@mokimeow/jev-fabric-cli",
    binary: "jev-fabric",
    version: "0.1.0-alpha.1",
  },
  mcp: {
    command: "jev-fabric",
    args: ["serve", "--transport", "stdio"],
    advisory: true,
    environmentNames: [],
  },
  skill: {
    path: "skills/jev-fabric/SKILL.md",
    pluginPath: "plugins/jev-fabric/skills/jev-fabric",
    files: [
      "SKILL.md",
      "references/pack-selection.md",
      "references/security-boundary.md",
    ],
    instructions: "advisory-only",
  },
  hosts: [
    {
      id: "codex",
      displayName: "Codex",
      serverName: "jev-fabric",
      configurationPath: "codex/config.toml",
      format: "toml-mcp",
      mcpRoot: "mcpServers",
      supports: {
        stdio: true,
        http: false,
        skills: "NOT_GENERATED",
        hooks: "UNSUPPORTED",
      },
      hooks: {},
      install: { scope: "command-line", location: "config.toml" },
      testStatus: "NOT_RUN",
      unsupported: [
        "automatic permission grants",
        "execution",
        "lifecycle hooks",
      ],
    },
    {
      id: "claude-code",
      displayName: "Claude Code",
      serverName: "jev-fabric-adapter-v1",
      configurationPath: "claude-code/.mcp.json",
      format: "mcp-json",
      mcpRoot: "mcpServers",
      supports: {
        stdio: true,
        http: false,
        skills: "NOT_GENERATED",
        hooks: "NOT_GENERATED",
      },
      hooks: {},
      install: { scope: "project", location: ".mcp.json" },
      testStatus: "NOT_RUN",
      unsupported: ["automatic permission grants", "execution"],
    },
    {
      id: "gemini-cli",
      displayName: "Gemini CLI",
      serverName: "jev-fabric",
      configurationPath: "gemini-cli/gemini-extension.json",
      format: "gemini-extension",
      mcpRoot: "mcpServers",
      supports: {
        stdio: true,
        http: false,
        skills: "NOT_GENERATED",
        hooks: "NOT_GENERATED",
      },
      hooks: {},
      install: { scope: "plugin", location: "extensions/jev-fabric" },
      testStatus: "NOT_RUN",
      unsupported: ["automatic permission grants", "execution"],
    },
    {
      id: "qwen-code",
      displayName: "Qwen Code",
      serverName: "jev-fabric",
      configurationPath: "qwen-code/qwen-extension.json",
      format: "qwen-extension",
      mcpRoot: "mcpServers",
      supports: {
        stdio: true,
        http: false,
        skills: "NOT_GENERATED",
        hooks: "NOT_GENERATED",
      },
      hooks: {},
      install: { scope: "plugin", location: "extensions/jev-fabric" },
      testStatus: "NOT_RUN",
      unsupported: ["automatic permission grants", "execution"],
    },
    {
      id: "kimi-cli",
      displayName: "Kimi Code",
      serverName: "jev-fabric-adapter-v1",
      configurationPath: "kimi-code/.kimi-code/mcp.json",
      format: "mcp-json",
      mcpRoot: "mcpServers",
      supports: {
        stdio: true,
        http: false,
        skills: "NOT_GENERATED",
        hooks: "NOT_GENERATED",
      },
      hooks: {},
      install: { scope: "project", location: ".kimi-code/mcp.json" },
      testStatus: "NOT_RUN",
      unsupported: ["automatic permission grants", "execution"],
    },
  ],
};

/**
 * Native contracts are derived from the one canonical model, never copied into
 * host generators. This makes a configuration, install, capability, hook, or
 * unsupported-feature drift an invalid adapter input instead of a second
 * unreviewed source of truth.
 */
const canonicalHosts = new Map(
  canonicalAdapterModel.hosts.map((host) => [host.id, host]),
);

const hostEventAllowlist: Readonly<Record<HostId, readonly NormalizedEvent[]>> =
  Object.freeze({
    codex: [],
    "claude-code": [],
    "gemini-cli": [],
    "qwen-code": [],
    "kimi-cli": [],
  });

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertCanonicalHostContract(
  host: AdapterModel["hosts"][number],
): void {
  const canonical = canonicalHosts.get(host.id);
  if (!canonical) throw new TypeError(`unknown host contract: ${host.id}`);
  const fields: ReadonlyArray<keyof typeof host> = [
    "serverName",
    "configurationPath",
    "format",
    "mcpRoot",
    "supports",
    "hooks",
    "install",
    "unsupported",
  ];
  for (const field of fields) {
    if (!sameJson(host[field], canonical[field]))
      throw new TypeError(
        `canonical host contract mismatch: ${host.id}.${field}`,
      );
  }
}

export function parseAdapterModel(input: unknown): AdapterModel {
  const model = AdapterModelSchema.parse(input);
  const identities = new Set<string>();
  for (const host of model.hosts) {
    if (identities.has(host.id))
      throw new TypeError(`duplicate host: ${host.id}`);
    identities.add(host.id);
    const events = Object.keys(host.hooks) as NormalizedEvent[];
    if (host.supports.hooks !== "IMPLEMENTED" && events.length > 0)
      throw new TypeError(`hooks are not generated for host: ${host.id}`);
    for (const event of events) {
      if (!NormalizedEventSchema.safeParse(event).success)
        throw new TypeError(`unsupported hook event: ${event}`);
      if (!hostEventAllowlist[host.id].includes(event))
        throw new TypeError(
          `unsupported hook event for host: ${host.id}.${event}`,
        );
    }
    assertCanonicalHostContract(host);
  }
  return model;
}

export function validateAdapterModel(input: unknown): { readonly ok: true } {
  parseAdapterModel(input);
  return { ok: true };
}

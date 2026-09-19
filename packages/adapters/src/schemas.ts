import { z } from "zod";
import type { AdapterModel, HostId } from "./model.js";

type Host = AdapterModel["hosts"][number];

const nativeMcpServer = z
  .object({ command: z.string().min(1), args: z.array(z.string()) })
  .strict();
const nativeMcpConfig = z
  .object({ mcpServers: z.record(z.string(), nativeMcpServer) })
  .strict();
const nativeExtension = z
  .object({
    name: z.string().regex(/^[a-z0-9-]+$/u),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/u),
    description: z.string().min(1),
    mcpServers: z.record(z.string(), nativeMcpServer),
  })
  .strict();

const expectedCommand = "jev-fabric" as const;
const expectedArgs = ["serve", "--transport", "stdio"] as const;

/** Independent host-native installation contracts from the audited CLI docs. */
export const hostNativeContracts = Object.freeze({
  codex: {
    format: "toml-mcp",
    configurationPath: "codex/config.toml",
    install: { scope: "command-line", location: "config.toml" },
  },
  "claude-code": {
    format: "mcp-json",
    configurationPath: "claude-code/.mcp.json",
    install: { scope: "project", location: ".mcp.json" },
  },
  "gemini-cli": {
    format: "gemini-extension",
    configurationPath: "gemini-cli/gemini-extension.json",
    install: { scope: "plugin", location: "extensions/jev-fabric" },
  },
  "qwen-code": {
    format: "qwen-extension",
    configurationPath: "qwen-code/qwen-extension.json",
    install: { scope: "plugin", location: "extensions/jev-fabric" },
  },
  "kimi-cli": {
    format: "mcp-json",
    configurationPath: "kimi-code/.kimi-code/mcp.json",
    install: { scope: "project", location: ".kimi-code/mcp.json" },
  },
} satisfies Record<
  HostId,
  {
    readonly format: Host["format"];
    readonly configurationPath: string;
    readonly install: Host["install"];
  }
>);

export const hostSchemaKinds = Object.freeze(
  Object.fromEntries(
    Object.entries(hostNativeContracts).map(([id, contract]) => [
      id,
      contract.format,
    ]),
  ) as Record<HostId, Host["format"]>,
);

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertHostContract(host: Host): void {
  const contract = hostNativeContracts[host.id];
  if (
    host.format !== contract.format ||
    host.configurationPath !== contract.configurationPath ||
    !sameJson(host.install, contract.install)
  )
    throw new TypeError(`host-native contract mismatch: ${host.id}`);
}

function assertExactServer(
  host: Host,
  server: z.infer<typeof nativeMcpServer>,
): void {
  if (server.command !== expectedCommand)
    throw new TypeError(`unexpected MCP command: ${host.id}`);
  if (!sameJson(server.args, expectedArgs))
    throw new TypeError(`unexpected MCP arguments: ${host.id}`);
}

function assertOnlyExpectedServer(
  host: Host,
  servers: Record<string, z.infer<typeof nativeMcpServer>>,
): void {
  const names = Object.keys(servers);
  if (names.length !== 1 || names[0] !== host.serverName)
    throw new TypeError(`unexpected MCP server declarations: ${host.id}`);
}

/** Parses the intentionally narrow TOML subset emitted for Codex MCP config. */
function parseCodexToml(content: string): {
  readonly serverName: string;
  readonly command: string;
  readonly args: string[];
} {
  const lines = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (lines.length !== 3)
    throw new TypeError("invalid Codex TOML statement count");
  const [sectionLine = "", commandLine = "", argsLine = ""] = lines;
  const section = /^\[mcp_servers\.([a-z][a-z0-9-]*)\]$/u.exec(sectionLine);
  const command = /^command\s*=\s*("(?:[^"\\]|\\.)*")$/u.exec(commandLine);
  const args = /^args\s*=\s*(\[.*\])$/u.exec(argsLine);
  const serverName = section?.[1];
  const commandValue = command?.[1];
  const argsValue = args?.[1];
  if (!serverName || !commandValue || !argsValue)
    throw new TypeError("invalid Codex TOML MCP syntax");
  let parsedCommand: unknown;
  let parsedArgs: unknown;
  try {
    parsedCommand = JSON.parse(commandValue);
    parsedArgs = JSON.parse(argsValue);
  } catch {
    throw new TypeError("invalid Codex TOML JSON-compatible value");
  }
  const server = nativeMcpServer.parse({
    command: parsedCommand,
    args: parsedArgs,
  });
  return { serverName, ...server };
}

/**
 * Independently validates emitted native syntax and exact packaged MCP entry
 * points. Provenance is checked separately and is not considered a schema.
 */
export function validateNativeArtifact(
  model: AdapterModel,
  host: Host,
  content: string,
): void {
  assertHostContract(host);
  if (
    model.package.binary !== expectedCommand ||
    model.mcp.command !== expectedCommand ||
    !sameJson(model.mcp.args, expectedArgs) ||
    !sameJson(model.mcp.environmentNames, [])
  )
    throw new TypeError("unexpected canonical packaged MCP contract");
  if (host.format === "toml-mcp") {
    const native = parseCodexToml(content);
    if (native.serverName !== host.serverName)
      throw new TypeError(`missing TOML MCP section: ${host.id}`);
    assertExactServer(host, native);
    return;
  }
  const parsed: unknown = JSON.parse(content);
  const schema = host.format === "mcp-json" ? nativeMcpConfig : nativeExtension;
  const native = schema.parse(parsed);
  assertOnlyExpectedServer(host, native.mcpServers);
  const server = native.mcpServers[host.serverName];
  if (!server) throw new TypeError(`missing MCP server: ${host.id}`);
  assertExactServer(host, server);
}

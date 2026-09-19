import type { AdapterModel, HostId } from "./model.js";

export interface GeneratedHost {
  readonly host: HostId;
  readonly path: string;
  readonly content: string;
}

/** Stable JSON matches the repository formatter without invoking a shell tool. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .replace(
      /\[\n\s+"([^"\n]+)"(?:,\n\s+"([^"\n]+)")?(?:,\n\s+"([^"\n]+)")?\n\s*\]/gu,
      (whole, first: string, second?: string, third?: string) => {
        const compact = `[${[first, second, third]
          .filter((item): item is string => item !== undefined)
          .map((item) => JSON.stringify(item))
          .join(", ")}]`;
        return compact.length <= 50 ? compact : whole;
      },
    )
    .concat("\n");
}

export function jsonArtifact(
  model: AdapterModel,
  hostId: HostId,
): GeneratedHost {
  const host = model.hosts.find((candidate) => candidate.id === hostId);
  if (!host) throw new TypeError(`missing host: ${hostId}`);
  const server = {
    command: model.mcp.command,
    args: model.mcp.args,
  };
  const content = stableJson({
    mcpServers: { [host.serverName]: server },
  });
  return { host: hostId, path: host.configurationPath, content };
}

export function generateCodex(model: AdapterModel): GeneratedHost {
  const host = model.hosts.find((candidate) => candidate.id === "codex");
  if (!host) throw new TypeError("missing host: codex");
  return {
    host: "codex",
    path: host.configurationPath,
    content: [
      `# ${model.provenance}; generated; advisory/non-executing; do not grant permissions automatically`,
      "# Copy this section into Codex config.toml. The companion Codex plugin ships the shared skill.",
      "",
      `[mcp_servers.${host.serverName}]`,
      `command = ${JSON.stringify(model.mcp.command)}`,
      `args = ${JSON.stringify(model.mcp.args)}`,
      "",
    ].join("\n"),
  };
}

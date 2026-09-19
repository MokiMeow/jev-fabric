import { stableJson, type GeneratedHost } from "./codex.js";
import type { AdapterModel } from "./model.js";

export function generateQwenCode(model: AdapterModel): GeneratedHost {
  const host = model.hosts.find((candidate) => candidate.id === "qwen-code");
  if (!host) throw new TypeError("missing host: qwen-code");
  return {
    host: "qwen-code",
    path: host.configurationPath,
    content: stableJson({
      name: "jev-fabric",
      version: model.package.version,
      description: "Advisory, non-executing Jev Fabric MCP integration.",
      mcpServers: {
        [host.serverName]: {
          command: model.mcp.command,
          args: model.mcp.args,
        },
      },
    }),
  };
}

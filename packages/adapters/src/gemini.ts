import { stableJson, type GeneratedHost } from "./codex.js";
import type { AdapterModel } from "./model.js";

export function generateGeminiCli(model: AdapterModel): GeneratedHost {
  const host = model.hosts.find((candidate) => candidate.id === "gemini-cli");
  if (!host) throw new TypeError("missing host: gemini-cli");
  return {
    host: "gemini-cli",
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

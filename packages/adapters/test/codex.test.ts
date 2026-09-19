import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { canonicalAdapterModel, generateIntegrations } from "../src/index.js";

it("uses Codex's native TOML MCP section and configuration install target", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-fabric-codex-"));
  await generateIntegrations(directory);
  const config = await readFile(join(directory, "codex/config.toml"), "utf8");
  expect(config).toContain("[mcp_servers.jev-fabric]");
  expect(config).toContain('command = "jev-fabric"');
  expect(
    canonicalAdapterModel.hosts.find((host) => host.id === "codex")?.install
      .location,
  ).toBe("config.toml");
});

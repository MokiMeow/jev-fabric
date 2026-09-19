import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { generateIntegrations } from "../src/index.js";

it("uses Kimi Code's project mcp.json and no legacy transport field", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-fabric-kimi-"));
  await generateIntegrations(directory);
  const config = JSON.parse(
    await readFile(join(directory, "kimi-code/.kimi-code/mcp.json"), "utf8"),
  ) as {
    mcpServers: Record<string, { command: string; transport?: string }>;
  };
  expect(config.mcpServers["jev-fabric-adapter-v1"]?.command).toBe(
    "jev-fabric",
  );
  expect(config.mcpServers["jev-fabric-adapter-v1"]?.transport).toBeUndefined();
});

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { generateIntegrations } from "../src/index.js";

it("uses a Gemini extension manifest with a stdio MCP declaration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-fabric-gemini-"));
  await generateIntegrations(directory);
  const config = JSON.parse(
    await readFile(join(directory, "gemini-cli/gemini-extension.json"), "utf8"),
  ) as {
    name: string;
    mcpServers: Record<string, { command: string }>;
  };
  expect(config.name).toBe("jev-fabric");
  expect(config.mcpServers["jev-fabric"]?.command).toBe("jev-fabric");
});

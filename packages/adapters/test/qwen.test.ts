import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { generateIntegrations } from "../src/index.js";

it("uses a Qwen Code extension manifest with an advisory stdio MCP", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-fabric-qwen-"));
  await generateIntegrations(directory);
  const config = JSON.parse(
    await readFile(join(directory, "qwen-code/qwen-extension.json"), "utf8"),
  ) as {
    mcpServers: Record<string, { args: string[] }>;
  };
  expect(config.mcpServers["jev-fabric"]?.args).toEqual([
    "serve",
    "--transport",
    "stdio",
  ]);
});

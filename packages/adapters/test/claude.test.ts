import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { generateIntegrations } from "../src/index.js";

it("uses Claude Code's type-less stdio .mcp.json layout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-fabric-claude-"));
  await generateIntegrations(directory);
  const config = JSON.parse(
    await readFile(join(directory, "claude-code/.mcp.json"), "utf8"),
  ) as {
    mcpServers: Record<
      string,
      { command: string; args: string[]; type?: string }
    >;
  };
  const server = config.mcpServers["jev-fabric-adapter-v1"];
  expect(server).toMatchObject({
    command: "jev-fabric",
    args: ["serve", "--transport", "stdio"],
  });
  expect(server?.type).toBeUndefined();
});

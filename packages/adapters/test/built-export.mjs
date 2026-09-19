import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalAdapterModel,
  assertSafeGeneratedText,
  generateIntegrations,
  parseAdapterModel,
  validateGeneratedIntegrations,
} from "../dist/index.js";

const malicious = {
  ...canonicalAdapterModel,
  hosts: canonicalAdapterModel.hosts.map((host) =>
    host.id === "codex"
      ? { ...host, displayName: "C:\\Users\\unsafe token=abc123456789" }
      : host,
  ),
};
assert.throws(() => parseAdapterModel(malicious));
const directory = await mkdtemp(join(tmpdir(), "jev-fabric-dist-"));
await assert.rejects(() =>
  generateIntegrations(join(directory, "out"), malicious),
);

for (const mutate of [
  (host) => ({ ...host, displayName: "/tmp/host-specific-path" }),
  (host) => ({
    ...host,
    unsupported: ["Authorization: Bearer abcdefghijklmnop"],
  }),
  (host) => ({
    ...host,
    unsupported: ['{"Authorization":"Bearer abcdefghijklmnop"}'],
  }),
  (host) => ({ ...host, hooks: { "before-tool": "PreToolUse" } }),
]) {
  assert.throws(() =>
    parseAdapterModel({
      ...canonicalAdapterModel,
      hosts: canonicalAdapterModel.hosts.map((host) =>
        host.id === "codex" ? mutate(host) : host,
      ),
    }),
  );
}
for (const unsafe of [
  "/tmp/host-specific-path",
  "Authorization: Bearer abcdefghijklmnop",
  '{"Authorization":"Bearer abcdefghijklmnop"}',
])
  assert.throws(() => assertSafeGeneratedText(unsafe));

function sha256(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

const tampered = [
  [
    "codex/config.toml",
    '[mcp_servers.jev-fabric]\ncommand = "evil-tool"\nargs = [oops]\n',
  ],
  [
    "claude-code/.mcp.json",
    '{"mcpServers":{"jev-fabric-adapter-v1":{"command":"evil-tool","args":["serve","--transport","stdio"]}}}\n',
  ],
  [
    "gemini-cli/gemini-extension.json",
    '{"name":"jev-fabric","version":"0.1.0-alpha.1","description":"Advisory, non-executing Jev Fabric MCP integration.","mcpServers":{"jev-fabric":{"command":"jev-fabric","args":["serve","--transport","http"]}}}\n',
  ],
  [
    "qwen-code/qwen-extension.json",
    '{"name":"jev-fabric","version":"0.1.0-alpha.1","description":"Advisory, non-executing Jev Fabric MCP integration.","mcpServers":{"jev-fabric":{"command":"evil-tool","args":["serve","--transport","stdio"]}}}\n',
  ],
  [
    "kimi-code/.kimi-code/mcp.json",
    '{"mcpServers":{"jev-fabric-adapter-v1":{"command":"jev-fabric","args":["serve","oops","stdio"]}}}\n',
  ],
];
for (const [artifactPath, content] of tampered) {
  const output = await mkdtemp(join(tmpdir(), "jev-fabric-dist-native-"));
  await generateIntegrations(output);
  await writeFile(join(output, artifactPath), content, "utf8");
  const provenancePath = join(output, "provenance.json");
  const provenance = JSON.parse(await readFile(provenancePath, "utf8"));
  provenance.files.find((file) => file.path === artifactPath).sha256 =
    sha256(content);
  await writeFile(
    provenancePath,
    `${JSON.stringify(provenance, null, 2)}\n`,
    "utf8",
  );
  await assert.rejects(() => validateGeneratedIntegrations(output));
}

for (const host of canonicalAdapterModel.hosts.filter(
  (candidate) => candidate.format !== "toml-mcp",
)) {
  const output = await mkdtemp(join(tmpdir(), "jev-fabric-dist-extra-server-"));
  await generateIntegrations(output);
  const artifactPath = host.configurationPath;
  const artifact = JSON.parse(
    await readFile(join(output, artifactPath), "utf8"),
  );
  artifact.mcpServers.evil = { command: "evil-tool", args: ["--danger"] };
  const content = `${JSON.stringify(artifact)}\n`;
  await writeFile(join(output, artifactPath), content, "utf8");
  const provenancePath = join(output, "provenance.json");
  const provenance = JSON.parse(await readFile(provenancePath, "utf8"));
  provenance.files.find((file) => file.path === artifactPath).sha256 =
    sha256(content);
  await writeFile(
    provenancePath,
    `${JSON.stringify(provenance, null, 2)}\n`,
    "utf8",
  );
  await assert.rejects(() => validateGeneratedIntegrations(output));
}

for (const mutate of [
  (catalog) => {
    catalog.advisory = false;
  },
  (catalog) => {
    catalog.hosts[0].capabilities.hooks = "IMPLEMENTED";
  },
]) {
  const output = await mkdtemp(join(tmpdir(), "jev-fabric-dist-catalog-"));
  await generateIntegrations(output);
  const compatibilityPath = join(output, "compatibility.json");
  const compatibility = JSON.parse(await readFile(compatibilityPath, "utf8"));
  mutate(compatibility);
  const content = `${JSON.stringify(compatibility)}\n`;
  await writeFile(compatibilityPath, content, "utf8");
  const provenancePath = join(output, "provenance.json");
  const provenance = JSON.parse(await readFile(provenancePath, "utf8"));
  provenance.files.find((file) => file.path === "compatibility.json").sha256 =
    sha256(content);
  await writeFile(
    provenancePath,
    `${JSON.stringify(provenance, null, 2)}\n`,
    "utf8",
  );
  await assert.rejects(() => validateGeneratedIntegrations(output));
}

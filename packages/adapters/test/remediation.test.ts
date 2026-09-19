import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSafeGeneratedText,
  canonicalAdapterModel,
  generateIntegrations,
  parseAdapterModel,
  validateGeneratedIntegrations,
} from "../src/index.js";

const root = resolve(import.meta.dirname, "../../..");
const canonicalSkill = resolve(root, "skills/jev-fabric");
const pluginSkill = resolve(root, "plugins/jev-fabric/skills/jev-fabric");

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function replaceArtifactWithFreshDigest(
  directory: string,
  relativePath: string,
  content: string,
): Promise<void> {
  await writeFile(join(directory, relativePath), content, "utf8");
  const provenancePath = join(directory, "provenance.json");
  const provenance = JSON.parse(await readFile(provenancePath, "utf8")) as {
    files: Array<{ path: string; sha256: string }>;
  };
  const entry = provenance.files.find((file) => file.path === relativePath);
  if (!entry) throw new Error(`missing provenance entry: ${relativePath}`);
  entry.sha256 = sha256(content);
  await writeFile(
    provenancePath,
    `${JSON.stringify(provenance, null, 2)}\n`,
    "utf8",
  );
}

describe("Task 8 remediation contracts", () => {
  it("keeps the plugin skill and every progressive reference byte-identical", async () => {
    for (const file of canonicalAdapterModel.skill.files) {
      await expect(readFile(resolve(pluginSkill, file), "utf8")).resolves.toBe(
        await readFile(resolve(canonicalSkill, file), "utf8"),
      );
    }
    const provenance = JSON.parse(
      await readFile(
        resolve(root, "plugins/jev-fabric/skill-provenance.json"),
        "utf8",
      ),
    ) as { provenance: string; files: Array<{ path: string; sha256: string }> };
    expect(provenance.provenance).toBe("jev-fabric-adapter/v1");
    expect(provenance.files).toHaveLength(
      canonicalAdapterModel.skill.files.length,
    );
  });

  it("rejects machine paths and credential values in text that reaches output", () => {
    for (const displayName of [
      "C:\\Users\\unsafe token=abc123456789",
      "/home/unsafe secret: abc123456789",
      "/tmp/host-specific-path",
      "/var/tmp/host-specific-path",
      "/etc/host-specific-path",
      "/",
      "\\\\server\\share bearer=abc123456789",
      "~/keys password=abc123456789",
    ]) {
      expect(() =>
        parseAdapterModel({
          ...canonicalAdapterModel,
          hosts: canonicalAdapterModel.hosts.map((host) =>
            host.id === "codex" ? { ...host, displayName } : host,
          ),
        }),
      ).toThrow();
    }
    for (const mutate of [
      () => ({
        ...canonicalAdapterModel,
        hosts: canonicalAdapterModel.hosts.map((host) =>
          host.id === "codex"
            ? {
                ...host,
                unsupported: ["Authorization: Bearer abcdefghijklmnop"],
              }
            : host,
        ),
      }),
      () => ({
        ...canonicalAdapterModel,
        hosts: canonicalAdapterModel.hosts.map((host) =>
          host.id === "codex"
            ? {
                ...host,
                unsupported: ["authorization:bearer abcdefghijklmnop"],
              }
            : host,
        ),
      }),
      () => ({
        ...canonicalAdapterModel,
        hosts: canonicalAdapterModel.hosts.map((host) =>
          host.id === "codex"
            ? {
                ...host,
                unsupported: ['{"Authorization":"Bearer abcdefghijklmnop"}'],
              }
            : host,
        ),
      }),
      () => ({
        ...canonicalAdapterModel,
        hosts: canonicalAdapterModel.hosts.map((host) =>
          host.id === "codex"
            ? { ...host, hooks: { "before-tool": "token: abc123456789" } }
            : host,
        ),
      }),
      () => ({ ...canonicalAdapterModel, installationRoot: "//server/share" }),
      () => ({
        ...canonicalAdapterModel,
        installationRoot: "/tmp/adapter-output",
      }),
      () => ({
        ...canonicalAdapterModel,
        skill: { ...canonicalAdapterModel.skill, path: "/tmp/SKILL.md" },
      }),
      () => ({
        ...canonicalAdapterModel,
        hosts: canonicalAdapterModel.hosts.map((host) =>
          host.id === "codex"
            ? {
                ...host,
                install: { ...host.install, location: "/tmp/config.toml" },
              }
            : host,
        ),
      }),
    ]) {
      expect(() => parseAdapterModel(mutate())).toThrow();
    }
    for (const serialized of [
      "/tmp/host-specific-path",
      "/var/lib/host-specific-path",
      "/",
      "Authorization: Bearer abcdefghijklmnop",
      "authorization:bearer abcdefghijklmnop",
      '{"Authorization":"Bearer abcdefghijklmnop"}',
    ])
      expect(() => assertSafeGeneratedText(serialized)).toThrow();
  });

  it("rejects host configuration drift from canonical native locations", () => {
    expect(() =>
      parseAdapterModel({
        ...canonicalAdapterModel,
        hosts: canonicalAdapterModel.hosts.map((host) =>
          host.id === "qwen-code"
            ? { ...host, configurationPath: "qwen-code/custom-extension.json" }
            : host,
        ),
      }),
    ).toThrow();
  });

  it("rejects hook declarations for hosts that do not generate hooks", () => {
    for (const id of [
      "codex",
      "claude-code",
      "gemini-cli",
      "qwen-code",
      "kimi-cli",
    ] as const) {
      expect(() =>
        parseAdapterModel({
          ...canonicalAdapterModel,
          hosts: canonicalAdapterModel.hosts.map((host) =>
            host.id === id
              ? { ...host, hooks: { "before-tool": "PreToolUse" } }
              : host,
          ),
        }),
      ).toThrow();
    }
  });

  it("rejects semantic native tampering even with a recomputed provenance digest", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "jev-fabric-native-schema-"),
    );
    await generateIntegrations(directory);
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
    ] as const;
    for (const [path, content] of tampered) {
      const hostDirectory = await mkdtemp(
        join(tmpdir(), "jev-fabric-host-tamper-"),
      );
      await generateIntegrations(hostDirectory);
      await replaceArtifactWithFreshDigest(hostDirectory, path, content);
      await expect(
        validateGeneratedIntegrations(hostDirectory),
      ).rejects.toThrow();
    }
  });

  it("rejects undeclared JSON MCP executables after a refreshed digest", async () => {
    for (const host of canonicalAdapterModel.hosts.filter(
      (candidate) => candidate.format !== "toml-mcp",
    )) {
      const directory = await mkdtemp(
        join(tmpdir(), "jev-fabric-extra-server-"),
      );
      await generateIntegrations(directory);
      const path = host.configurationPath;
      const artifact = JSON.parse(
        await readFile(join(directory, path), "utf8"),
      ) as { mcpServers: Record<string, unknown> };
      artifact.mcpServers.evil = {
        command: "evil-tool",
        args: ["--danger"],
      };
      await replaceArtifactWithFreshDigest(
        directory,
        path,
        `${JSON.stringify(artifact)}\n`,
      );
      await expect(validateGeneratedIntegrations(directory)).rejects.toThrow();
    }
  });

  it("rejects forged compatibility claims after a refreshed digest", async () => {
    type Compatibility = {
      advisory: boolean;
      hosts: Array<{ capabilities: Record<string, string> }>;
    };
    for (const mutate of [
      (catalog: Compatibility) => {
        catalog.advisory = false;
      },
      (catalog: Compatibility) => {
        const firstHost = catalog.hosts[0];
        if (!firstHost) throw new Error("missing compatibility host");
        firstHost.capabilities.hooks = "IMPLEMENTED";
      },
    ]) {
      const directory = await mkdtemp(
        join(tmpdir(), "jev-fabric-compatibility-"),
      );
      await generateIntegrations(directory);
      const compatibility = JSON.parse(
        await readFile(join(directory, "compatibility.json"), "utf8"),
      ) as Compatibility;
      mutate(compatibility);
      await replaceArtifactWithFreshDigest(
        directory,
        "compatibility.json",
        `${JSON.stringify(compatibility)}\n`,
      );
      await expect(validateGeneratedIntegrations(directory)).rejects.toThrow();
    }
  });
});

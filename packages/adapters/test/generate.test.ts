import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalAdapterModel,
  generateIntegrations,
  validateAdapterModel,
} from "../src/index.js";

describe("host adapter generation", () => {
  it("generates deterministic, secret-free native layouts for every host", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jev-fabric-adapters-"));
    const first = await generateIntegrations(directory, canonicalAdapterModel);
    const second = await generateIntegrations(directory, canonicalAdapterModel);
    expect(second).toEqual(first);
    expect(first.map((entry) => entry.host)).toEqual([
      "claude-code",
      "codex",
      "gemini-cli",
      "kimi-cli",
      "qwen-code",
    ]);
    for (const artifact of first) {
      const content = await readFile(join(directory, artifact.path), "utf8");
      expect(content).toContain("jev-fabric");
      expect(content).not.toMatch(
        /(?:api[_-]?key|bearer|token)\s*[:=]\s*["'][^"']{8,}/iu,
      );
      expect(content).not.toMatch(/[A-Z]:\\|\/Users\/|\/home\//u);
    }
    const compatibility = JSON.parse(
      await readFile(join(directory, "compatibility.json"), "utf8"),
    ) as { provenance: string; hosts: Array<{ status: string }> };
    expect(compatibility.provenance).toBe("jev-fabric-adapter/v1");
    expect(compatibility.hosts).toHaveLength(5);
    expect(compatibility.hosts.every((host) => host.status === "NOT_RUN")).toBe(
      true,
    );
    const provenance = JSON.parse(
      await readFile(join(directory, "provenance.json"), "utf8"),
    ) as { provenance: string; files: Array<{ path: string; sha256: string }> };
    expect(provenance.provenance).toBe("jev-fabric-adapter/v1");
    expect(provenance.files).toHaveLength(6);
    expect(
      provenance.files.every((file) => /^[a-f0-9]{64}$/u.test(file.sha256)),
    ).toBe(true);
  });

  it("has exact command arrays and safe advisory labels", () => {
    const result = validateAdapterModel(canonicalAdapterModel);
    expect(result.ok).toBe(true);
    expect(canonicalAdapterModel.mcp.command).toEqual("jev-fabric");
    expect(canonicalAdapterModel.mcp.args).toEqual([
      "serve",
      "--transport",
      "stdio",
    ]);
    expect(canonicalAdapterModel.mcp.advisory).toBe(true);
    for (const host of canonicalAdapterModel.hosts) {
      expect(host.supports.stdio).toBe(true);
      expect(host.supports.skills).toBe("NOT_GENERATED");
      expect(host.supports.hooks).not.toBe("IMPLEMENTED");
      expect(host.hooks).toEqual({});
    }
  });
});

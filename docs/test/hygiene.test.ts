import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory() ? files(path) : entry.isFile() ? [path] : [];
      }),
    )
  ).flat();
}

describe("public-document hygiene", () => {
  it("contains neither absolute local paths nor credential-shaped values", async () => {
    const publicFiles = [
      ...(await files(resolve(root, "examples"))),
      ...(await files(resolve(root, "docs"))).filter(
        (path) => !path.includes("\\superpowers\\"),
      ),
      ...[
        "README.md",
        "ARCHITECTURE.md",
        "COMPATIBILITY.md",
        "ROADMAP.md",
        "SUPPORT.md",
        "CHANGELOG.md",
        "AGENTS.md",
      ].map((path) => resolve(root, path)),
      resolve(root, "llms.txt"),
    ];
    const secret =
      /(?:apikey|api[_-]?key|bearer)\s*[:=]\s*[A-Za-z0-9_-]{16,}|(?:^|[^A-Za-z0-9_-])apikey_[A-Za-z0-9_-]{32,}(?=$|[^A-Za-z0-9_-])/iu;
    for (const path of publicFiles) {
      const text = await readFile(path, "utf8");
      expect(text).not.toMatch(/[A-Z]:\\(?:Users|home)\\/u);
      expect(text).not.toMatch(secret);
    }
  });

  it("maps every public package and extension boundary for AI readers", async () => {
    const map = await readFile(resolve(root, "AGENTS.md"), "utf8");
    for (const path of [
      "packages/protocol/src/",
      "packages/core/src/",
      "packs/",
      "packages/provider-*/src/",
      "packages/evals/",
      "packages/cli/src/",
      "packages/mcp/src/",
      "packages/adapters/",
      "integrations/",
      "skills/jev-fabric/",
    ])
      expect(map).toContain(path);
  });
});

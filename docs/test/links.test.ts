import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const official = new Set([
  "https://docs.typesafe.ai/",
  "https://platform.openai.com/",
  "https://developers.openai.com/",
  "https://docs.anthropic.com/",
  "https://ai.google.dev/",
  "https://platform.moonshot.ai/",
  "https://www.alibabacloud.com/",
  "https://github.com/",
  "https://www.npmjs.com/",
  "https://vercel.com/",
  "https://developer.chrome.com/",
  "https://chromedevtools.github.io/",
  "https://docs.blender.org/",
  "https://dev.epicgames.com/",
  "https://docs.unity3d.com/",
  "https://docs.godotengine.org/",
  "https://freecad.github.io/",
  "https://www.finra.org/",
  "https://www.sec.gov/",
  "https://catalog.data.gov/",
  "https://www.nist.gov/",
  "https://itl.nist.gov/",
  "https://x.com/",
  "https://madewithjev.com/",
  "https://jevlist.ai/",
]);
async function markdown(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory() && entry.name === "superpowers") return [];
        return entry.isDirectory()
          ? markdown(path)
          : entry.isFile() && entry.name.endsWith(".md")
            ? [path]
            : [];
      }),
    )
  ).flat();
}
describe("public documentation links", () => {
  it("keeps local markdown links resolvable and external sources allowlisted", async () => {
    const paths = [
      ...(await markdown(resolve(root, "docs"))),
      ...(await markdown(resolve(root, "examples"))),
      ...(await markdown(resolve(root, "skills"))),
      ...(await markdown(resolve(root, "plugins"))),
      ...[
        "README.md",
        "ARCHITECTURE.md",
        "CHANGELOG.md",
        "CODE_OF_CONDUCT.md",
        "COMPATIBILITY.md",
        "CONTRIBUTING.md",
        "GOVERNANCE.md",
        "ROADMAP.md",
        "SECURITY.md",
        "SUPPORT.md",
        "AGENTS.md",
        "packs/README.md",
        "packs/route/README.md",
        "packs/screen/README.md",
        "packs/rank/README.md",
        "packs/verify/README.md",
        "packs/risk/README.md",
        "packs/progress/README.md",
        "packs/completion/README.md",
        "packages/protocol/README.md",
        "packages/core/README.md",
        "packages/evals/README.md",
        "packages/mcp/README.md",
        "packages/cli/README.md",
        "packages/adapters/README.md",
        "packages/provider-typesafe/README.md",
        "packages/provider-openai-compatible/README.md",
      ].map((path) => resolve(root, path)),
    ];
    for (const path of paths) {
      const text = await readFile(path, "utf8");
      for (const target of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
        const raw = target[1];
        if (!raw) continue;
        const [link, fragment] = raw.split("#", 2);
        if (!link) continue;
        if (link.startsWith("http"))
          expect([...official].some((prefix) => link.startsWith(prefix))).toBe(
            true,
          );
        else {
          const destination = resolve(path, "..", link);
          expect(
            existsSync(destination),
            `${relative(root, path)} → ${link}`,
          ).toBe(true);
          if (fragment) {
            const destinationText = await readFile(destination, "utf8");
            expect(
              markdownAnchors(destinationText).has(fragment),
              `${relative(root, path)} → ${link}#${fragment}`,
            ).toBe(true);
          }
        }
      }
    }
  });
});

function markdownAnchors(text: string): Set<string> {
  return new Set(
    [...text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gmu)].map((match) =>
      (match[1] ?? "")
        .toLowerCase()
        .replace(/[`*_]/gu, "")
        .replace(/[^a-z0-9 -]/gu, "")
        .trim()
        .replace(/\s+/gu, "-"),
    ),
  );
}

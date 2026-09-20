import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const rootDocs = [
  "README.md",
  "ARCHITECTURE.md",
  "COMPATIBILITY.md",
  "ROADMAP.md",
  "SUPPORT.md",
  "CHANGELOG.md",
  "AGENTS.md",
];
const external = [
  "https://docs.typesafe.ai/",
  "https://platform.openai.com/",
  "https://developers.openai.com/",
  "https://docs.anthropic.com/",
  "https://ai.google.dev/",
  "https://platform.moonshot.ai/",
  "https://www.alibabacloud.com/",
  "https://github.com/",
  "https://vercel.com/",
  "https://developer.chrome.com/",
  "https://chromedevtools.github.io/",
  "https://docs.blender.org/",
  "https://dev.epicgames.com/",
  "https://docs.unity3d.com/",
  "https://docs.godotengine.org/",
  "https://freecad.github.io/",
];

async function markdown(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory() && entry.name === "superpowers") return [];
        return entry.isDirectory()
          ? markdown(path)
          : entry.name.endsWith(".md")
            ? [path]
            : [];
      }),
    )
  ).flat();
}
function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[`*_]/gu, "")
    .replace(/[^a-z0-9\s-]/gu, "")
    .trim()
    .replace(/\s+/gu, "-");
}
function anchors(markdown_: string): Set<string> {
  return new Set(
    [...markdown_.matchAll(/^#{1,6}\s+(.+)$/gmu)].map((match) =>
      slug(match[1] ?? ""),
    ),
  );
}

describe("public Markdown integrity", () => {
  it("has balanced fences and no duplicate headings", async () => {
    const paths = [
      ...(await markdown(resolve(root, "docs"))),
      ...rootDocs.map((path) => resolve(root, path)),
    ];
    for (const path of paths) {
      const text = await readFile(path, "utf8");
      expect(
        (text.match(/^```/gmu) ?? []).length % 2,
        relative(root, path),
      ).toBe(0);
      const headings = anchors(text);
      const declared = [...text.matchAll(/^#{1,6}\s+(.+)$/gmu)].map((match) =>
        slug(match[1] ?? ""),
      );
      expect(headings.size, relative(root, path)).toBe(declared.length);
    }
  });

  it("resolves local targets and anchors and constrains public external links", async () => {
    const paths = [
      ...(await markdown(resolve(root, "docs"))),
      ...rootDocs.map((path) => resolve(root, path)),
    ];
    for (const path of paths) {
      const text = await readFile(path, "utf8");
      for (const match of text.matchAll(
        /\[[^\]]+\]\(([^)#]+)(?:#([^)]+))?\)/gu,
      )) {
        const [_, target, anchor] = match;
        if (!target) continue;
        if (target.startsWith("http")) {
          expect(external.some((prefix) => target.startsWith(prefix))).toBe(
            true,
          );
          continue;
        }
        const destination = resolve(dirname(path), target);
        expect(
          existsSync(destination),
          `${relative(root, path)} → ${target}`,
        ).toBe(true);
        if (anchor && destination.endsWith(".md")) {
          expect(anchors(await readFile(destination, "utf8")).has(anchor)).toBe(
            true,
          );
        }
      }
    }
  });

  it("requires dated official sources and complete metadata for future quantified claims", async () => {
    const evidence = await readFile(
      resolve(root, "docs/evidence/README.md"),
      "utf8",
    );
    expect(evidence).toMatch(/official .*accessed 2026-09-19/iu);
    const paths = [
      ...(await markdown(resolve(root, "docs"))),
      ...rootDocs.map((path) => resolve(root, path)),
    ];
    const quantified = /(?:\b\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?x\b|\$\d)/iu;
    for (const path of paths) {
      const text = await readFile(path, "utf8");
      if (!quantified.test(text)) continue;
      expect(text).toMatch(/evidence class|evidence:|Evidence:/u);
      expect(text).toMatch(/2026-09-19/u);
      expect(text).toMatch(/version|versions/u);
      expect(text).toMatch(/cases|sample|denominator/u);
      expect(text).toMatch(/hardware|region|machine|redacted/u);
      expect(text).toMatch(/limitation/u);
      expect(text).toMatch(/\]\([^)]*benchmarks\//u);
    }
  });
});

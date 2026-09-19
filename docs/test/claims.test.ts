import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const root = resolve(import.meta.dirname, "../..");
const forbidden = /\b(?:production-ready|secure|100x|verified)\b/iu;
const statuses = /\b(?:SUPPORTED|EXPERIMENTAL|ADVISORY|UNSUPPORTED|NOT RUN)\b/g;
async function collect(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory() && entry.name === "superpowers") return [];
        return entry.isDirectory()
          ? collect(path)
          : entry.name.endsWith(".md")
            ? [path]
            : [];
      }),
    )
  ).flat();
}
describe("public claim discipline", () => {
  it("uses no inflated guarantees and compatibility uses the exact vocabulary", async () => {
    const files = [
      ...(await collect(resolve(root, "docs"))),
      resolve(root, "README.md"),
      resolve(root, "ARCHITECTURE.md"),
      resolve(root, "COMPATIBILITY.md"),
    ];
    for (const file of files)
      expect(await readFile(file, "utf8")).not.toMatch(forbidden);
    const matrix = await readFile(resolve(root, "COMPATIBILITY.md"), "utf8");
    expect([...matrix.matchAll(statuses)].length).toBeGreaterThan(10);
    expect(matrix).toContain("NOT RUN");
    expect(matrix).toContain("not affiliated with or endorsed by TypeSafe AI");
  });
});

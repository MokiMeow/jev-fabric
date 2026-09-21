import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repository = resolve(import.meta.dirname, "..", "..");
const importer = resolve(repository, "scripts", "import-historical.mts");
const tsx = resolve(repository, "node_modules", "tsx", "dist", "cli.mjs");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(
  deepRegression: Record<string, unknown>,
): Promise<{ source: string; output: string }> {
  const root = await mkdtemp(join(tmpdir(), "jev-fabric-import-"));
  roots.push(root);
  const source = join(root, "source");
  const output = join(root, "output");
  await mkdir(source);
  await writeFile(
    join(source, "DEEP_REGRESSION_RESULTS.json"),
    JSON.stringify(deepRegression),
    "utf8",
  );
  await writeFile(
    join(source, "ADVANCED_PATTERN_RESULTS.json"),
    JSON.stringify({ performance: { samples: 1 } }),
    "utf8",
  );
  return { source, output };
}

function run(source: string, output: string) {
  return spawnSync(
    process.execPath,
    [tsx, importer, "--source", source, "--output", output],
    {
      cwd: repository,
      encoding: "utf8",
      windowsHide: true,
    },
  );
}

describe("historical evidence import", () => {
  it("rejects a standalone TypeSafe credential without echoing it", async () => {
    const credential = `${"api"}key_${"a".repeat(40)}_${"b".repeat(40)}`;
    const { source, output } = await fixture({
      metadata: { note: credential },
    });

    const result = run(source, output);
    const transcript = `${result.stdout}\n${result.stderr}`;

    expect(result.status).not.toBe(0);
    expect(transcript).toMatch(
      /refusing secret-, path-, or hostname-bearing source: DEEP_REGRESSION_RESULTS\.json/u,
    );
    expect(transcript).not.toContain(credential);
  });

  it("still imports an approved credential-free summary", async () => {
    const { source, output } = await fixture({
      metadata: { samples: 1 },
    });

    const result = run(source, output);

    expect(result.status, result.stderr).toBe(0);
    const manifest = JSON.parse(
      await readFile(join(output, "manifest.json"), "utf8"),
    ) as { provenance: Array<{ name: string; sha256: string }> };
    expect(manifest.provenance.map(({ name }) => name)).toEqual([
      "ADVANCED_PATTERN_RESULTS.json",
      "DEEP_REGRESSION_RESULTS.json",
    ]);
    expect(
      manifest.provenance.every(({ sha256 }) => sha256.length === 64),
    ).toBe(true);
  });
});

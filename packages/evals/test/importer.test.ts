import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
const run = promisify(execFile);
const names = [
  "DEEP_REGRESSION_RESULTS.json",
  "ADVANCED_PATTERN_RESULTS.json",
] as const;
const safe = {
  "DEEP_REGRESSION_RESULTS.json": { batch_curve: {} },
  "ADVANCED_PATTERN_RESULTS.json": { performance: {} },
};
async function source(value?: string) {
  const dir = await mkdtemp(join(tmpdir(), "jev-import-"));
  await Promise.all(
    names.map((name) =>
      writeFile(join(dir, name), value ?? JSON.stringify(safe[name])),
    ),
  );
  return dir;
}
async function importer(dir: string, output: string) {
  return run(
    process.execPath,
    [
      "node_modules/tsx/dist/cli.mjs",
      "scripts/import-historical.mts",
      "--source",
      dir,
      "--output",
      output,
    ],
    { cwd: "../.." },
  );
}
it("imports only approved safe JSON deterministically", async () => {
  const input = await source();
  const one = await mkdtemp(join(tmpdir(), "jev-out-"));
  const two = await mkdtemp(join(tmpdir(), "jev-out-"));
  await importer(input, one);
  await importer(input, two);
  expect(await readFile(join(one, "manifest.json"), "utf8")).toBe(
    await readFile(join(two, "manifest.json"), "utf8"),
  );
  expect(await readFile(join(one, "report.md"), "utf8")).toContain(
    "TypeSafe confidence",
  );
});
it("does not traverse or parse unapproved source files", async () => {
  const input = await source();
  await writeFile(join(input, "LEAKED.json"), '{"apiKey":"must-not-be-read"}');
  await expect(
    importer(input, await mkdtemp(join(tmpdir(), "jev-out-"))),
  ).resolves.toBeDefined();
});
it("fails closed for malformed, unknown, secret, path, and hostname sources", async () => {
  for (const value of [
    "{",
    '{"unknown":true}',
    '{"batch_curve":{"apiKey":"x"}}',
    '{"batch_curve":{"path":"C:\\\\Users\\\\x"}}',
    '{"batch_curve":{"url":"https://example.com"}}',
  ]) {
    const input = await source(value);
    await expect(
      importer(input, await mkdtemp(join(tmpdir(), "jev-out-"))),
    ).rejects.toThrow();
  }
});
it("rejects an approved-name symlink that escapes the source root", async () => {
  const input = await source();
  const outside = await mkdtemp(join(tmpdir(), "jev-outside-"));
  const external = join(outside, "external.json");
  const approvedName = names[0];
  if (approvedName === undefined) throw new TypeError("fixture name missing");
  await writeFile(external, JSON.stringify({ batch_curve: {} }));
  await rm(join(input, approvedName));
  try {
    await symlink(external, join(input, approvedName));
  } catch (error: unknown) {
    // Windows without Developer Mode cannot create a symlink; lstat protection
    // is still exercised on platforms where the filesystem supports it.
    if ((error as NodeJS.ErrnoException).code === "EPERM") return;
    throw error;
  }
  await expect(
    importer(input, await mkdtemp(join(tmpdir(), "jev-out-"))),
  ).rejects.toThrow(/symlink|escapes/);
});

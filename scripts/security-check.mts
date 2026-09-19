import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";
import { relative, resolve } from "node:path";

const ignored = new Set([
  "node_modules",
  ".git",
  ".artifacts",
  "dist",
  "coverage",
  ".superpowers",
  "test",
]);
const secret =
  /(?:api[_-]?key|authorization|bearer|password|secret|token)\s*[:=]\s*["']?(?:sk|ts|jev)_[A-Za-z0-9_-]{16,}/iu;
const absolute = /(?:[A-Za-z]:\\Users\\|\/home\/|\/Users\/)[^\s"']+/u;

export async function securityCheck(root = process.cwd()): Promise<void> {
  const errors: string[] = [];
  for await (const path of glob("**/*", {
    cwd: root,
    exclude: [...ignored].map((name) => `**/${name}/**`),
  })) {
    const full = resolve(root, path);
    const content = await readFile(full, "utf8").catch(() => undefined);
    if (content === undefined) continue;
    if (secret.test(content))
      errors.push(`${relative(root, full)}: secret-like value`);
    if (absolute.test(content))
      errors.push(`${relative(root, full)}: absolute user path`);
  }
  const manifests: string[] = [];
  for await (const path of glob(
    "{package.json,packages/*/package.json,packs/package.json}",
    { cwd: root },
  ))
    manifests.push(path);
  for (const path of manifests) {
    const manifest = JSON.parse(
      await readFile(resolve(root, path), "utf8"),
    ) as {
      license?: unknown;
      scripts?: Record<string, unknown>;
      private?: boolean;
      name?: unknown;
    };
    if (manifest.license !== "Apache-2.0")
      errors.push(`${path}: license must be Apache-2.0`);
    if (
      manifest.scripts?.install ||
      manifest.scripts?.preinstall ||
      manifest.scripts?.postinstall
    )
      errors.push(`${path}: install lifecycle scripts are not allowed`);
    if (path !== "package.json" && manifest.private)
      errors.push(`${path}: publishable workspace package cannot be private`);
  }
  if (errors.length > 0) throw new Error(errors.join("\n"));
}

if (process.argv[1]?.endsWith("security-check.mts")) await securityCheck();

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const manifests = [
  "packages/protocol/package.json",
  "packages/core/package.json",
  "packages/evals/package.json",
  "packs/package.json",
  "packages/mcp/package.json",
  "packages/cli/package.json",
  "packages/provider-openai-compatible/package.json",
  "packages/provider-typesafe/package.json",
  "packages/adapters/package.json",
] as const;

export async function verifyReleaseState(root = process.cwd()): Promise<void> {
  const pending = (await readdir(resolve(root, ".changeset"))).filter(
    (name) => name.endsWith(".md") && name !== "README.md",
  );
  if (pending.length > 0)
    throw new Error(
      "release requires a merged version-preparation pull request; pending Changesets remain",
    );
  const versions = new Set(
    await Promise.all(
      manifests.map(async (path) => {
        const manifest = JSON.parse(
          await readFile(resolve(root, path), "utf8"),
        ) as { version?: unknown };
        return manifest.version;
      }),
    ),
  );
  if (versions.size !== 1 || typeof [...versions][0] !== "string")
    throw new Error(
      "all publishable packages must have one coordinated release version",
    );
}

if (process.argv[1]?.endsWith("verify-release-state.mts"))
  await verifyReleaseState();

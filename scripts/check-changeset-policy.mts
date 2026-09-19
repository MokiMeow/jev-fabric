import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const publishableRoots = ["packages/", "packs/"];

function documentationOrTest(file: string): boolean {
  return (
    file.startsWith("docs/") ||
    file.startsWith("examples/") ||
    /(?:^|\/)(?:test|tests)\//u.test(file) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file) ||
    /(?:^|\/)README\.md$/u.test(file)
  );
}

function releasePreparationFile(file: string): boolean {
  return (
    file === "pnpm-lock.yaml" ||
    file === "CHANGELOG.md" ||
    file.startsWith(".changeset/") ||
    /^(?:packages\/[^/]+|packs)\/(?:package\.json|README\.md|LICENSE|CHANGELOG\.md)$/u.test(
      file,
    )
  );
}

export function checkChangesetPolicy({
  root = process.cwd(),
  changedFiles,
  headRef = process.env.GITHUB_HEAD_REF ?? "",
}: {
  root?: string;
  changedFiles?: readonly string[];
  headRef?: string;
} = {}): void {
  let files = changedFiles;
  if (!files) {
    try {
      files = execFileSync(
        "git",
        ["diff", "--name-only", "origin/main...HEAD"],
        {
          cwd: root,
          encoding: "utf8",
        },
      )
        .split(/\r?\n/u)
        .filter(Boolean);
    } catch {
      // Local contributors commonly have no origin yet. CI fetches origin/main.
      files = execFileSync("git", ["diff", "--name-only", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      })
        .split(/\r?\n/u)
        .concat(
          execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
            cwd: root,
            encoding: "utf8",
          }).split(/\r?\n/u),
        )
        .filter(Boolean);
    }
  }
  const changesPublishable = files.some(
    (file) =>
      publishableRoots.some((prefix) => file.startsWith(prefix)) &&
      !documentationOrTest(file),
  );
  if (!changesPublishable) return;
  const changesets = files.filter((file) =>
    /^\.changeset\/[a-z0-9-]+\.md$/u.test(file),
  );
  if (changesets.length > 0) return;
  const releasePreparation =
    /^changeset-release\/[a-z0-9-]+$/u.test(headRef) &&
    files.length > 0 &&
    files.every(releasePreparationFile);
  if (releasePreparation) return;
  throw new Error(
    "publishable package changes require a pending .changeset/*.md file; only docs/tests-only changes and a constrained changeset-release/* version-preparation branch are exempt",
  );
}

if (process.argv[1]?.endsWith("check-changeset-policy.mts")) {
  if (!existsSync(resolve(process.cwd(), ".changeset", "config.json")))
    throw new Error("Changesets configuration is required");
  checkChangesetPolicy();
}

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

interface Artifact {
  readonly name: string;
  readonly version: string;
  readonly filename: string;
  readonly sha256: string;
  readonly sha512: string;
}
interface Bundle {
  readonly schemaVersion: 1;
  readonly releaseVersion: string;
  readonly sourceRevision: string;
  readonly sourceDateEpoch: string;
  readonly packages: readonly Artifact[];
}
interface Digest {
  readonly filename: string;
  readonly sha256: string;
  readonly sha512: string;
}
interface ReleaseEvidence {
  readonly schemaVersion: 1;
  readonly releaseVersion: string;
  readonly sourceRevision: string;
  readonly sourceDateEpoch: string;
  readonly sbom: Digest;
  readonly packages: readonly Artifact[];
}

const packageNames = [
  "@mokimeow/jev-fabric-adapters",
  "@mokimeow/jev-fabric-cli",
  "@mokimeow/jev-fabric-core",
  "@mokimeow/jev-fabric-evals",
  "@mokimeow/jev-fabric-mcp",
  "@mokimeow/jev-fabric-packs",
  "@mokimeow/jev-fabric-protocol",
  "@mokimeow/jev-fabric-provider-openai-compatible",
  "@mokimeow/jev-fabric-provider-typesafe",
] as const;

function hash(bytes: Uint8Array): Pick<Digest, "sha256" | "sha512"> {
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sha512: createHash("sha512").update(bytes).digest("hex"),
  };
}
function validVersion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.test(
      value,
    )
  );
}
function assertBundle(bundle: Bundle): void {
  if (
    bundle.schemaVersion !== 1 ||
    !validVersion(bundle.releaseVersion) ||
    !/^[a-f0-9]{40}$/u.test(bundle.sourceRevision) ||
    !/^(?:0|[1-9]\d*)$/u.test(bundle.sourceDateEpoch) ||
    !Number.isSafeInteger(Number(bundle.sourceDateEpoch)) ||
    bundle.packages.length !== packageNames.length
  )
    throw new Error("release artifact manifest has invalid identity");
  if (
    JSON.stringify(bundle.packages.map((item) => item.name).sort()) !==
    JSON.stringify([...packageNames].sort())
  )
    throw new Error(
      "release artifact manifest must bind all nine public packages",
    );
  const filenames = new Set<string>();
  for (const item of bundle.packages) {
    if (
      item.version !== bundle.releaseVersion ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/u.test(item.filename) ||
      !/^[a-f0-9]{64}$/u.test(item.sha256) ||
      !/^[a-f0-9]{128}$/u.test(item.sha512) ||
      filenames.has(item.filename)
    )
      throw new Error(
        "release artifact manifest has an invalid package binding",
      );
    filenames.add(item.filename);
  }
}
async function verifiedDigest(path: string): Promise<Digest> {
  const bytes = await readFile(path);
  return { filename: basename(path), ...hash(bytes) };
}
function canonical(evidence: ReleaseEvidence): string {
  return `${JSON.stringify(evidence, null, 2)}\n`;
}

/** Writes a standard checksum list for a canonical, non-self-referential bundle. */
export async function generateReleaseChecksums({
  artifactsDirectory,
  sbom,
  output,
}: {
  artifactsDirectory: string;
  sbom: string;
  output?: string;
}): Promise<void> {
  const directory = resolve(artifactsDirectory);
  const bundle = JSON.parse(
    await readFile(resolve(directory, "release-artifacts.json"), "utf8"),
  ) as Bundle;
  assertBundle(bundle);
  const packages: Artifact[] = [];
  for (const item of [...bundle.packages].sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const digest = await verifiedDigest(resolve(directory, item.filename));
    if (digest.sha256 !== item.sha256 || digest.sha512 !== item.sha512)
      throw new Error(
        `release artifact digest does not match ${item.filename}`,
      );
    packages.push(item);
  }
  const sbomDigest = await verifiedDigest(resolve(sbom));
  const expectedNamespace = `https://github.com/MokiMeow/jev-fabric/sbom/${bundle.releaseVersion}/${bundle.sourceRevision}`;
  const parsedSbom = JSON.parse(await readFile(resolve(sbom), "utf8")) as {
    documentNamespace?: unknown;
    creationInfo?: { created?: unknown };
  };
  if (parsedSbom.documentNamespace !== expectedNamespace)
    throw new Error(
      "SBOM does not bind the release version and source revision",
    );
  if (
    parsedSbom.creationInfo?.created !==
    new Date(Number(bundle.sourceDateEpoch) * 1_000)
      .toISOString()
      .replace(".000Z", "Z")
  )
    throw new Error("SBOM does not bind SOURCE_DATE_EPOCH");
  const evidence: ReleaseEvidence = {
    schemaVersion: 1,
    releaseVersion: bundle.releaseVersion,
    sourceRevision: bundle.sourceRevision,
    sourceDateEpoch: bundle.sourceDateEpoch,
    sbom: sbomDigest,
    packages,
  };
  const evidencePath = resolve(directory, "release-evidence.json");
  await writeFile(evidencePath, canonical(evidence), "utf8");
  const subjects = [
    await verifiedDigest(evidencePath),
    sbomDigest,
    ...packages.map(({ filename, sha256 }) => ({ filename, sha256 })),
  ].sort((left, right) => left.filename.localeCompare(right.filename));
  await writeFile(
    output ?? resolve(directory, "SHA256SUMS"),
    `${subjects.map(({ sha256, filename }) => `${sha256}  ${filename}`).join("\n")}\n`,
    "utf8",
  );
}

if (process.argv[1]?.endsWith("generate-release-checksums.mts")) {
  const supplied = process.argv.slice(2);
  const values = supplied[0] === "--" ? supplied.slice(1) : supplied;
  const options: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (
      !key?.startsWith("--") ||
      value === undefined ||
      key.slice(2) in options
    )
      throw new Error(
        "Usage: generate-release-checksums.mts --artifacts-dir PATH --sbom PATH",
      );
    options[key.slice(2)] = value;
  }
  if (
    Object.keys(options).some(
      (key) => !["artifacts-dir", "sbom"].includes(key),
    ) ||
    !options["artifacts-dir"] ||
    !options.sbom
  )
    throw new Error(
      "Usage: generate-release-checksums.mts --artifacts-dir PATH --sbom PATH",
    );
  await generateReleaseChecksums({
    artifactsDirectory: options["artifacts-dir"],
    sbom: options.sbom,
  });
}

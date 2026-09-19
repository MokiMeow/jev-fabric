import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { parseAllDocuments } from "yaml";

interface Manifest {
  readonly name: string;
  readonly version: string;
  readonly license?: string;
  readonly private?: boolean;
  readonly dependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
  readonly author?: unknown;
}

interface LockDependency {
  readonly version: string;
}

interface Lockfile {
  readonly importers: Record<
    string,
    Record<string, Record<string, LockDependency>>
  >;
  readonly packages: Record<
    string,
    { readonly resolution?: { readonly integrity?: string } }
  >;
  readonly snapshots: Record<
    string,
    {
      readonly dependencies?: Record<string, string>;
      readonly optionalDependencies?: Record<string, string>;
    }
  >;
}

interface SpdxPackage {
  readonly SPDXID: string;
  readonly name: string;
  readonly versionInfo: string;
  readonly downloadLocation: string;
  readonly filesAnalyzed: false;
  readonly licenseConcluded: string;
  readonly licenseDeclared: string;
  readonly copyrightText: string;
  readonly supplier: string;
  readonly checksums?: Array<{
    readonly algorithm: "SHA256" | "SHA512";
    readonly checksumValue: string;
  }>;
  readonly externalRefs: Array<{
    readonly referenceCategory: "PACKAGE-MANAGER";
    readonly referenceType: "purl";
    readonly referenceLocator: string;
  }>;
  readonly primaryPackagePurpose: "LIBRARY";
  readonly annotations: Array<{
    readonly annotationType: "OTHER";
    readonly annotator: string;
    readonly annotationDate: string;
    readonly comment: string;
  }>;
}

interface SpdxDocument {
  readonly spdxVersion: "SPDX-2.3";
  readonly dataLicense: "CC0-1.0";
  readonly SPDXID: "SPDXRef-DOCUMENT";
  readonly name: string;
  readonly documentNamespace: string;
  readonly creationInfo: {
    readonly created: string;
    readonly creators: string[];
  };
  readonly documentComment?: string;
  readonly packages: SpdxPackage[];
  readonly relationships: Array<{
    readonly spdxElementId: string;
    readonly relationshipType: "DESCRIBES" | "DEPENDS_ON";
    readonly relatedSpdxElement: string;
  }>;
}

export interface GenerateSbomOptions {
  readonly root?: string;
  readonly output?: string;
  /** Directory produced by `pack-smoke.mjs --artifacts-dir`; required for release provenance. */
  readonly artifactsDirectory?: string;
  /** A validated release version. Defaults to the coordinated public package version. */
  readonly releaseVersion?: string;
  /** A full Git commit SHA. Defaults to the checked-out source revision. */
  readonly sourceRevision?: string;
  /** Seconds since Unix epoch. Defaults to SOURCE_DATE_EPOCH or the source commit time. */
  readonly sourceDateEpoch?: string | number;
}

interface ReleaseArtifact {
  readonly name: string;
  readonly version: string;
  readonly filename: string;
  readonly sha256: string;
  readonly sha512: string;
}

interface ReleaseArtifactBundle {
  readonly schemaVersion: 1;
  readonly releaseVersion: string;
  readonly sourceRevision: string;
  readonly sourceDateEpoch: string;
  readonly packages: readonly ReleaseArtifact[];
}

const manifestPaths = [
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

function spdxId(name: string, version: string): string {
  return `SPDXRef-Package-${createHash("sha256").update(`${name}@${version}`).digest("hex").slice(0, 16)}`;
}

function npmPurl(name: string, version: string): string {
  return `pkg:npm/${name.replace("@", "%40").replace("/", "%2F")}@${version}`;
}

function npmDownload(name: string, version: string): string {
  return `https://registry.npmjs.org/${encodeURIComponent(name)}/-/${name.split("/").at(-1)}-${version}.tgz`;
}

function normalizedVersion(value: string): string {
  return value.replace(/\(.+$/u, "");
}

function packageKey(name: string, version: string): string {
  return `${name}@${normalizedVersion(version)}`;
}

function packageMetadataCandidates(root: string, name: string): string[] {
  return [
    resolve(root, "node_modules", name, "package.json"),
    ...manifestPaths.map((manifest) =>
      resolve(root, dirname(manifest), "node_modules", name, "package.json"),
    ),
  ];
}

async function readRuntimeMetadata(
  root: string,
  name: string,
): Promise<{ license?: string; author?: unknown }> {
  for (const candidate of packageMetadataCandidates(root, name)) {
    try {
      await access(candidate);
      return JSON.parse(await readFile(candidate, "utf8")) as {
        license?: string;
        author?: unknown;
      };
    } catch {
      // A package can be present only transitively in pnpm's virtual store. Its
      // absence from these stable direct locations is represented as NOASSERTION.
    }
  }
  return {};
}

function supplier(author: unknown): string {
  if (typeof author === "string" && author.trim().length > 0)
    return `Person: ${author.trim()}`;
  if (
    author &&
    typeof author === "object" &&
    "name" in author &&
    typeof author.name === "string" &&
    author.name.trim().length > 0
  )
    return `Person: ${author.name.trim()}`;
  return "NOASSERTION";
}

function checksum(integrity: string | undefined): SpdxPackage["checksums"] {
  if (!integrity?.startsWith("sha512-")) return undefined;
  return [
    {
      algorithm: "SHA512",
      checksumValue: Buffer.from(
        integrity.slice("sha512-".length),
        "base64",
      ).toString("hex"),
    },
  ];
}

function artifactChecksums(
  artifact: ReleaseArtifact,
): SpdxPackage["checksums"] {
  return [
    { algorithm: "SHA256", checksumValue: artifact.sha256 },
    { algorithm: "SHA512", checksumValue: artifact.sha512 },
  ];
}

function sourceRevision(root: string, value: string | undefined): string {
  const revision =
    value ??
    process.env.GITHUB_SHA ??
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  if (!/^[a-f0-9]{40}$/iu.test(revision))
    throw new Error("source revision must be a full 40-character Git SHA");
  return revision.toLowerCase();
}

function normalizedSourceDateEpoch(
  epoch: string | number | undefined,
  root: string,
): string {
  const raw =
    epoch ??
    process.env.SOURCE_DATE_EPOCH ??
    execFileSync("git", ["log", "-1", "--format=%ct"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  if (!/^[0-9]+$/u.test(String(raw)))
    throw new Error(
      "SOURCE_DATE_EPOCH must be a non-negative integer number of seconds",
    );
  const seconds = Number(raw);
  if (!Number.isSafeInteger(seconds) || seconds < 0)
    throw new Error("SOURCE_DATE_EPOCH must be a safe non-negative integer");
  return String(seconds);
}

function sourceDate(epoch: string): string {
  return new Date(Number(epoch) * 1_000).toISOString().replace(".000Z", "Z");
}

function validReleaseVersion(value: string): string {
  // A deliberately narrow SemVer form: npm prerelease identifiers are allowed,
  // build metadata is not because it is not a publishable npm version identity.
  if (
    !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.test(
      value,
    )
  )
    throw new Error(`invalid release version: ${value}`);
  return value;
}

async function releaseArtifacts(
  directory: string | undefined,
  releaseVersion: string,
  revision: string,
  epoch: string,
): Promise<Map<string, ReleaseArtifact>> {
  if (!directory) return new Map();
  const path = resolve(directory, "release-artifacts.json");
  let bundle: ReleaseArtifactBundle;
  try {
    bundle = JSON.parse(await readFile(path, "utf8")) as ReleaseArtifactBundle;
  } catch {
    throw new Error(`release artifact manifest is required at ${path}`);
  }
  if (
    bundle.schemaVersion !== 1 ||
    bundle.releaseVersion !== releaseVersion ||
    bundle.sourceRevision !== revision ||
    bundle.sourceDateEpoch !== epoch
  )
    throw new Error(
      "release artifact manifest does not match the release version",
    );
  const entries = new Map<string, ReleaseArtifact>();
  for (const artifact of bundle.packages) {
    if (
      !artifact ||
      artifact.version !== releaseVersion ||
      !/^[a-f0-9]{64}$/u.test(artifact.sha256) ||
      !/^[a-f0-9]{128}$/u.test(artifact.sha512) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/u.test(artifact.filename)
    )
      throw new Error(
        "release artifact manifest contains an invalid package binding",
      );
    const bytes = await readFile(resolve(directory, artifact.filename));
    if (
      createHash("sha256").update(bytes).digest("hex") !== artifact.sha256 ||
      createHash("sha512").update(bytes).digest("hex") !== artifact.sha512
    )
      throw new Error(
        `release artifact digest does not match ${artifact.filename}`,
      );
    const key = packageKey(artifact.name, artifact.version);
    if (entries.has(key))
      throw new Error("release artifact manifest has duplicate packages");
    entries.set(key, artifact);
  }
  return entries;
}

function directDependencies(manifest: Manifest): Record<string, string> {
  return {
    ...(manifest.dependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
  };
}

function importerVersion(
  lockfile: Lockfile,
  manifestPath: string,
  name: string,
): string {
  const importer = lockfile.importers[dirname(manifestPath)];
  const record =
    importer?.dependencies?.[name] ?? importer?.optionalDependencies?.[name];
  if (!record?.version)
    throw new Error(
      `lockfile has no locked runtime version for ${name} in ${manifestPath}`,
    );
  return normalizedVersion(record.version);
}

function snapshotFor(lockfile: Lockfile, name: string, version: string) {
  const exact = packageKey(name, version);
  const key = Object.keys(lockfile.snapshots).find(
    (candidate) => candidate === exact || candidate.startsWith(`${exact}(`),
  );
  return key ? lockfile.snapshots[key] : undefined;
}

function requiredId(ids: Map<string, string>, key: string): string {
  const id = ids.get(key);
  if (!id) throw new Error(`SBOM relationship has no package ID: ${key}`);
  return id;
}

function assertSpdxSchema(document: SpdxDocument): void {
  if (
    document.spdxVersion !== "SPDX-2.3" ||
    document.dataLicense !== "CC0-1.0" ||
    document.SPDXID !== "SPDXRef-DOCUMENT" ||
    !/^https:\/\//u.test(document.documentNamespace) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(
      document.creationInfo.created,
    )
  )
    throw new Error("invalid SPDX document identity");
  const ids = new Set<string>();
  for (const entry of document.packages) {
    if (
      !/^SPDXRef-Package-[a-f0-9]{16}$/u.test(entry.SPDXID) ||
      !entry.name ||
      !entry.versionInfo ||
      !entry.downloadLocation ||
      !entry.licenseConcluded ||
      !entry.licenseDeclared ||
      !entry.supplier ||
      entry.filesAnalyzed !== false ||
      !entry.externalRefs.some(
        (ref) =>
          ref.referenceCategory === "PACKAGE-MANAGER" &&
          ref.referenceType === "purl",
      ) ||
      ids.has(entry.SPDXID)
    )
      throw new Error("invalid SPDX package entry");
    for (const item of entry.checksums ?? [])
      if (
        (item.algorithm === "SHA512" &&
          !/^[a-f0-9]{128}$/u.test(item.checksumValue)) ||
        (item.algorithm === "SHA256" &&
          !/^[a-f0-9]{64}$/u.test(item.checksumValue))
      )
        throw new Error("invalid SPDX package checksum");
    ids.add(entry.SPDXID);
  }
  if (ids.size === 0) throw new Error("SPDX document has no packages");
  const relationships = new Set<string>();
  for (const relationship of document.relationships) {
    const validDescribe =
      relationship.relationshipType === "DESCRIBES" &&
      relationship.spdxElementId === "SPDXRef-DOCUMENT" &&
      ids.has(relationship.relatedSpdxElement);
    const validDependency =
      relationship.relationshipType === "DEPENDS_ON" &&
      ids.has(relationship.spdxElementId) &&
      ids.has(relationship.relatedSpdxElement);
    const identity = `${relationship.spdxElementId}:${relationship.relationshipType}:${relationship.relatedSpdxElement}`;
    if ((!validDescribe && !validDependency) || relationships.has(identity))
      throw new Error("invalid SPDX relationship");
    relationships.add(identity);
  }
}

export function validateSpdxDocument(document: SpdxDocument): void {
  assertSpdxSchema(document);
}

export async function generateSbom({
  root = process.cwd(),
  output = resolve(root, ".artifacts", "jev-fabric.spdx.json"),
  artifactsDirectory,
  releaseVersion: requestedReleaseVersion,
  sourceRevision: requestedSourceRevision,
  sourceDateEpoch,
}: GenerateSbomOptions = {}): Promise<void> {
  const [lockfileText, ...manifestTexts] = await Promise.all([
    readFile(resolve(root, "pnpm-lock.yaml"), "utf8"),
    ...manifestPaths.map((path) => readFile(resolve(root, path), "utf8")),
  ]);
  const lockfileDocument = parseAllDocuments(lockfileText).at(-1);
  if (!lockfileDocument || lockfileDocument.errors.length > 0)
    throw new Error("pnpm lockfile is not valid YAML");
  const lockfile = lockfileDocument.toJS() as Lockfile;
  const firstParty = manifestTexts
    .map((text, index) => ({
      path: manifestPaths[index],
      manifest: JSON.parse(text) as Manifest,
    }))
    .filter(({ manifest }) => !manifest.private)
    .sort((left, right) =>
      left.manifest.name.localeCompare(right.manifest.name),
    );
  const workspaceByName = new Map(
    firstParty.map(({ manifest }) => [manifest.name, manifest]),
  );
  const versions = new Set(firstParty.map(({ manifest }) => manifest.version));
  if (versions.size !== 1)
    throw new Error("public workspace packages must share one release version");
  const releaseVersion = validReleaseVersion(
    requestedReleaseVersion ?? firstParty[0]?.manifest.version ?? "",
  );
  if (![...versions].every((version) => version === releaseVersion))
    throw new Error(
      "release version does not match public workspace package versions",
    );
  const revision = sourceRevision(root, requestedSourceRevision);
  const epoch = normalizedSourceDateEpoch(sourceDateEpoch, root);
  const created = sourceDate(epoch);
  const artifacts = await releaseArtifacts(
    artifactsDirectory,
    releaseVersion,
    revision,
    epoch,
  );
  const records = new Map<
    string,
    {
      name: string;
      version: string;
      firstParty: boolean;
      manifestPath?: string;
    }
  >();
  const edges = new Set<string>();
  const queue: Array<{ name: string; version: string }> = [];
  for (const { path, manifest } of firstParty) {
    const key = packageKey(manifest.name, manifest.version);
    records.set(key, {
      name: manifest.name,
      version: manifest.version,
      firstParty: true,
      manifestPath: path,
    });
    for (const name of Object.keys(directDependencies(manifest))) {
      const dependencyVersion =
        workspaceByName.get(name)?.version ??
        importerVersion(lockfile, path, name);
      edges.add(`${key}\u0000${packageKey(name, dependencyVersion)}`);
      if (!workspaceByName.has(name))
        queue.push({ name, version: dependencyVersion });
    }
  }
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const key = packageKey(current.name, current.version);
    if (records.has(key)) continue;
    records.set(key, { ...current, firstParty: false });
    const snapshot = snapshotFor(lockfile, current.name, current.version);
    for (const [name, version] of Object.entries({
      ...(snapshot?.dependencies ?? {}),
      ...(snapshot?.optionalDependencies ?? {}),
    })) {
      const dependencyVersion = normalizedVersion(version);
      const target = packageKey(name, dependencyVersion);
      edges.add(`${key}\u0000${target}`);
      queue.push({ name, version: dependencyVersion });
    }
  }
  const packages = await Promise.all(
    [...records.values()]
      .sort((left, right) =>
        packageKey(left.name, left.version).localeCompare(
          packageKey(right.name, right.version),
        ),
      )
      .map(async (record) => {
        const metadata = record.firstParty
          ? (firstParty.find(({ manifest }) => manifest.name === record.name)
              ?.manifest ?? {})
          : await readRuntimeMetadata(root, record.name);
        const integrity =
          lockfile.packages[packageKey(record.name, record.version)]?.resolution
            ?.integrity;
        const artifact = artifacts.get(packageKey(record.name, record.version));
        if (record.firstParty && artifactsDirectory && !artifact)
          throw new Error(
            `release artifact manifest is missing ${record.name}`,
          );
        return {
          SPDXID: spdxId(record.name, record.version),
          name: record.name,
          versionInfo: record.version,
          downloadLocation: record.firstParty
            ? "NOASSERTION"
            : npmDownload(record.name, record.version),
          filesAnalyzed: false,
          licenseConcluded: metadata.license ?? "NOASSERTION",
          licenseDeclared: metadata.license ?? "NOASSERTION",
          copyrightText: "NOASSERTION",
          supplier: supplier(metadata.author),
          ...(record.firstParty && artifact
            ? { checksums: artifactChecksums(artifact) }
            : checksum(integrity)
              ? { checksums: checksum(integrity) }
              : {}),
          externalRefs: [
            {
              referenceCategory: "PACKAGE-MANAGER",
              referenceType: "purl",
              referenceLocator: npmPurl(record.name, record.version),
            },
          ],
          primaryPackagePurpose: "LIBRARY",
          annotations: [
            {
              annotationType: "OTHER",
              annotator: "Tool: jev-fabric deterministic SBOM generator",
              annotationDate: created,
              comment: record.firstParty
                ? `Manifest: ${relative(root, resolve(root, record.manifestPath ?? "")).replaceAll("\\", "/")}; Source revision: ${revision};${artifact ? ` Release artifact: ${artifact.filename}; SHA256: ${artifact.sha256}; SHA512: ${artifact.sha512}.` : " No packed release artifact was supplied."}`
                : "Locked production dependency; metadata absence is represented by NOASSERTION.",
            },
          ],
        } as SpdxPackage;
      }),
  );
  const idByKey = new Map(
    packages.map((entry) => [
      packageKey(entry.name, entry.versionInfo),
      entry.SPDXID,
    ]),
  );
  const document: SpdxDocument = {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `jev-fabric-${releaseVersion}`,
    documentNamespace: `https://github.com/MokiMeow/jev-fabric/sbom/${releaseVersion}/${revision}`,
    creationInfo: {
      created,
      creators: ["Tool: jev-fabric deterministic SBOM generator"],
    },
    documentComment: `Release version: ${releaseVersion}; Source revision: ${revision}; Artifact binding: ${artifactsDirectory ? "present" : "not supplied"}.`,
    packages,
    relationships: [
      ...firstParty.map(({ manifest }) => ({
        spdxElementId: "SPDXRef-DOCUMENT" as const,
        relationshipType: "DESCRIBES" as const,
        relatedSpdxElement: requiredId(
          idByKey,
          packageKey(manifest.name, manifest.version),
        ),
      })),
      ...[...edges]
        .map((edge) => edge.split("\u0000"))
        .filter(([from, to]) => idByKey.has(from) && idByKey.has(to))
        .sort(([leftFrom, leftTo], [rightFrom, rightTo]) =>
          `${leftFrom}\u0000${leftTo}`.localeCompare(
            `${rightFrom}\u0000${rightTo}`,
          ),
        )
        .map(([from, to]) => ({
          spdxElementId: requiredId(idByKey, from),
          relationshipType: "DEPENDS_ON" as const,
          relatedSpdxElement: requiredId(idByKey, to),
        })),
    ],
  };
  validateSpdxDocument(document);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

function cliOptions(arguments_: readonly string[]): GenerateSbomOptions {
  const supplied = arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
  const options: Record<string, string> = {};
  for (let index = 0; index < supplied.length; index += 2) {
    const key = supplied[index];
    const value = supplied[index + 1];
    if (
      !key?.startsWith("--") ||
      value === undefined ||
      key.slice(2) in options
    )
      throw new Error(
        "Usage: generate-sbom.mts [--output PATH] [--artifacts-dir PATH] [--release-version VERSION] [--source-revision SHA] [--source-date-epoch SECONDS]",
      );
    options[key.slice(2)] = value;
  }
  const unknown = Object.keys(options).filter(
    (key) =>
      ![
        "output",
        "artifacts-dir",
        "release-version",
        "source-revision",
        "source-date-epoch",
      ].includes(key),
  );
  if (unknown.length > 0) throw new Error(`unknown SBOM option: ${unknown[0]}`);
  return {
    ...(options.output ? { output: options.output } : {}),
    ...(options["artifacts-dir"]
      ? { artifactsDirectory: options["artifacts-dir"] }
      : {}),
    ...(options["release-version"]
      ? { releaseVersion: options["release-version"] }
      : {}),
    ...(options["source-revision"]
      ? { sourceRevision: options["source-revision"] }
      : {}),
    ...(options["source-date-epoch"]
      ? { sourceDateEpoch: options["source-date-epoch"] }
      : {}),
  };
}

if (process.argv[1]?.endsWith("generate-sbom.mts"))
  await generateSbom(cliOptions(process.argv.slice(2)));

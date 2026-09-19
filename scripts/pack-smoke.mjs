import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const pnpmVersion = "12.4.2";
const localPackages = [
  ["protocol", "packages/protocol"],
  ["core", "packages/core"],
  ["evals", "packages/evals"],
  ["packs", "packs"],
  ["mcp", "packages/mcp"],
  ["cli", "packages/cli"],
  ["provider-openai-compatible", "packages/provider-openai-compatible"],
  ["provider-typesafe", "packages/provider-typesafe"],
  ["adapters", "packages/adapters"],
];
const externalPackages = [
  [
    "@modelcontextprotocol/core",
    "packages/mcp/node_modules/@modelcontextprotocol/core",
  ],
  [
    "@modelcontextprotocol/server",
    "packages/mcp/node_modules/@modelcontextprotocol/server",
  ],
  [
    "@typesafe-ai/sdk",
    "packages/provider-typesafe/node_modules/@typesafe-ai/sdk",
  ],
  ["zod", "packages/mcp/node_modules/zod"],
];
// `pnpm pack` traverses each actual package directory and its JSON result is
// inspected below. No manifest or archive is synthesized or rewritten.

function npmCliArguments(arguments_) {
  if (process.platform !== "win32") return ["npm", arguments_];
  return [
    process.execPath,
    [
      join(
        dirname(process.execPath),
        "node_modules",
        "npm",
        "bin",
        "npm-cli.js",
      ),
      ...arguments_,
    ],
  ];
}

function npm(arguments_, cwd, environment, encoding = "buffer") {
  const [command, commandArguments] = npmCliArguments(arguments_);
  if (encoding === "inherit")
    return execFileSync(command, commandArguments, {
      cwd,
      env: environment,
      stdio: "inherit",
    });
  return execFileSync(command, commandArguments, {
    cwd,
    encoding,
    env: environment,
  });
}

function command(arguments_, cwd, environment) {
  execFileSync(process.execPath, arguments_, {
    cwd,
    env: environment,
    stdio: "inherit",
  });
}

function offlineEnvironment(overrides = {}) {
  return {
    ...(process.platform === "win32"
      ? { SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec }
      : {}),
    PATH: dirname(process.execPath),
    TEMP: process.env.TEMP ?? tmpdir(),
    TMP: process.env.TMP ?? tmpdir(),
    ...overrides,
    // Both package managers are forced offline even if a caller inherits a
    // configured registry. The registry is deliberately unreachable as a
    // second, independent guard against accidental download fallbacks.
    NPM_CONFIG_OFFLINE: "true",
    NPM_CONFIG_REGISTRY: "http://127.0.0.1:9/",
    npm_config_offline: "true",
    npm_config_registry: "http://127.0.0.1:9/",
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    NPM_CONFIG_PREFER_OFFLINE: "true",
    COREPACK_ENABLE_NETWORK: "0",
  };
}

function pinnedPnpm(root) {
  const packageDirectory = join(
    root,
    "node_modules",
    ".pnpm",
    `pnpm@${pnpmVersion}`,
    "node_modules",
    "pnpm",
  );
  const nativeName = `@pnpm/exe.${process.platform}-${process.arch}`;
  const nativeDirectory = join(
    root,
    "node_modules",
    ".pnpm",
    `@pnpm+exe.${process.platform}-${process.arch}@${pnpmVersion}`,
    "node_modules",
    "@pnpm",
    `exe.${process.platform}-${process.arch}`,
  );
  const executable = join(
    nativeDirectory,
    process.platform === "win32" ? "pnpm.exe" : "pnpm",
  );
  try {
    const manifest = JSON.parse(
      readFileSync(join(packageDirectory, "package.json"), "utf8"),
    );
    const nativeManifest = JSON.parse(
      readFileSync(join(nativeDirectory, "package.json"), "utf8"),
    );
    if (
      manifest.name !== "pnpm" ||
      manifest.version !== pnpmVersion ||
      manifest.optionalDependencies?.[nativeName] !== pnpmVersion ||
      nativeManifest.name !== nativeName ||
      nativeManifest.version !== pnpmVersion ||
      !existsSync(executable)
    )
      throw new Error("invalid pinned pnpm installation");
  } catch {
    throw new Error(
      `pinned pnpm prerequisite is missing for ${process.platform}-${process.arch}; run pnpm install --frozen-lockfile before pack:test. This check never downloads package-manager tooling.`,
    );
  }
  return executable;
}

function artifactOutputFromArguments(root) {
  const supplied = process.argv.slice(2);
  const arguments_ = supplied[0] === "--" ? supplied.slice(1) : supplied;
  const options = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (
      !key?.startsWith("--") ||
      value === undefined ||
      key.slice(2) in options
    )
      throw new Error(
        "Usage: node scripts/pack-smoke.mjs [--artifacts-dir PATH] [--source-revision SHA] [--source-date-epoch SECONDS]",
      );
    options[key.slice(2)] = value;
  }
  if (
    Object.keys(options).some(
      (key) =>
        !["artifacts-dir", "source-revision", "source-date-epoch"].includes(
          key,
        ),
    )
  )
    throw new Error("pack-smoke received an unknown option");
  const directory = options["artifacts-dir"];
  return {
    ...(directory
      ? { directory: resolve(root, directory), cleanup: false }
      : {
          directory: mkdtempSync(join(tmpdir(), "jev-fabric-artifacts-")),
          cleanup: true,
        }),
    ...(options["source-revision"]
      ? { sourceRevision: validatedRevision(options["source-revision"]) }
      : { sourceRevision: sourceRevision(root) }),
    ...(options["source-date-epoch"]
      ? { sourceDateEpoch: validatedEpoch(options["source-date-epoch"]) }
      : { sourceDateEpoch: sourceDateEpoch(root) }),
  };
}

function validatedRevision(value) {
  if (!/^[a-f0-9]{40}$/iu.test(value))
    throw new Error("source revision must be a full 40-character Git SHA");
  return value.toLowerCase();
}

function sourceRevision(root) {
  return validatedRevision(
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
  );
}

function validatedEpoch(value) {
  if (!/^[0-9]+$/u.test(String(value)) || !Number.isSafeInteger(Number(value)))
    throw new Error("SOURCE_DATE_EPOCH must be a safe non-negative integer");
  return String(Number(value));
}

function sourceDateEpoch(root) {
  return validatedEpoch(
    process.env.SOURCE_DATE_EPOCH ??
      execFileSync("git", ["log", "-1", "--format=%ct"], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
  );
}

function releaseVersion(root) {
  const versions = new Set(
    localPackages.map(([_name, relative]) => {
      const manifest = JSON.parse(
        readFileSync(join(root, relative, "package.json"), "utf8"),
      );
      return manifest.version;
    }),
  );
  if (versions.size !== 1)
    throw new Error(
      "publishable workspace packages must share one release version",
    );
  const [value] = versions;
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.test(
      value,
    )
  )
    throw new Error(
      "publishable workspace packages have an invalid release version",
    );
  return value;
}

function validatePublishManifest(manifest, sourceRelative, version) {
  for (const key of [
    "name",
    "version",
    "license",
    "exports",
    "types",
    "files",
    "engines",
    "repository",
    "homepage",
    "bugs",
    "publishConfig",
  ])
    if (!(key in manifest))
      throw new Error(`${sourceRelative}/package.json is missing ${key}`);
  if (manifest.private === true || manifest.license !== "Apache-2.0")
    throw new Error(
      `${sourceRelative}/package.json is not a public Apache-2.0 package`,
    );
  if (
    manifest.version !== version ||
    manifest.publishConfig?.access !== "public"
  )
    throw new Error(
      `${sourceRelative}/package.json has an unsafe publish configuration`,
    );
  if (!Array.isArray(manifest.files) || !manifest.files.includes("dist"))
    throw new Error(`${sourceRelative}/package.json must pack dist`);
  if (
    typeof manifest.types !== "string" ||
    !manifest.types.startsWith("./dist/")
  )
    throw new Error(`${sourceRelative}/package.json has an unsafe types path`);
  if (
    sourceRelative === "packages/cli" &&
    manifest.bin?.["jev-fabric"] !== "./dist/bin.js"
  )
    throw new Error("CLI package must publish the jev-fabric binary");
  for (const dependencyType of [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
  ])
    for (const [name, range] of Object.entries(manifest[dependencyType] ?? {}))
      if (typeof range !== "string")
        throw new Error(
          `${sourceRelative}/package.json has an invalid dependency: ${name}`,
        );
  for (const script of ["preinstall", "install", "postinstall"])
    if (manifest.scripts?.[script])
      throw new Error(`${sourceRelative}/package.json has forbidden ${script}`);
}

function assertBuildPrerequisite(source, sourceRelative, manifest) {
  const required = [manifest.types];
  if (sourceRelative === "packages/cli")
    required.push(manifest.bin?.["jev-fabric"]);
  for (const path of required) {
    if (typeof path !== "string" || !existsSync(resolve(source, path)))
      throw new Error(
        `${sourceRelative} is missing built output (${path ?? "declared entrypoint"}); run pnpm build before pack:test`,
      );
  }
}

function readTarballEntries(tarball) {
  const archive = gunzipSync(readFileSync(tarball));
  const entries = new Map();
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").split("\0")[0];
    const sizeText = header
      .subarray(124, 136)
      .toString("utf8")
      .split("\0")[0]
      .trim();
    const size = Number.parseInt(sizeText || "0", 8);
    if (!Number.isSafeInteger(size) || size < 0)
      throw new Error(`invalid tar entry size: ${name}`);
    const contentStart = offset + 512;
    entries.set(name, archive.subarray(contentStart, contentStart + size));
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function assertRealArchive(manifest, sourceRelative, tarball, root) {
  const entries = readTarballEntries(tarball);
  const license = entries.get("package/LICENSE");
  if (
    !license ||
    license.toString("utf8").replaceAll("\r\n", "\n").trimEnd() !==
      readFileSync(join(root, "LICENSE"), "utf8")
        .replaceAll("\r\n", "\n")
        .trimEnd()
  )
    throw new Error(
      `${sourceRelative} real archive does not contain the Apache LICENSE`,
    );
  if (!entries.has("package/package.json"))
    throw new Error(`${sourceRelative} archive has no package.json`);
  const readme = entries.get("package/README.md");
  if (!readme?.toString("utf8").includes(`# ${manifest.name}\n`))
    throw new Error(
      `${sourceRelative} real archive has no package-specific README`,
    );
  const allowed = new Set([
    "package/LICENSE",
    "package/README.md",
    "package/package.json",
  ]);
  for (const file of manifest.files) {
    const normalized = `package/${file.replace(/^\.\//u, "")}`;
    for (const entry of entries.keys())
      if (entry === normalized || entry.startsWith(`${normalized}/`))
        allowed.add(entry);
  }
  for (const [path, content] of entries) {
    if (!allowed.has(path))
      throw new Error(
        `${sourceRelative} archive leaked a non-public file: ${path}`,
      );
    if (
      /\.(?:[cm]?js|json)$/u.test(path) &&
      content.includes(Buffer.from(root))
    )
      throw new Error(
        `${sourceRelative} archive leaked an absolute workspace path: ${path}`,
      );
  }
  const packedManifest = JSON.parse(
    entries.get("package/package.json").toString("utf8"),
  );
  for (const type of [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
  ])
    for (const range of Object.values(packedManifest[type] ?? {}))
      if (typeof range === "string" && range.startsWith("workspace:"))
        throw new Error(
          `${sourceRelative} archive leaked a workspace protocol`,
        );
}

function pack(
  source,
  sourceRelative,
  artifactsDirectory,
  root,
  validate,
  pnpm,
  environment,
) {
  const manifest = JSON.parse(
    readFileSync(join(source, "package.json"), "utf8"),
  );
  if (validate)
    validatePublishManifest(manifest, sourceRelative, releaseVersion(root));
  if (validate) assertBuildPrerequisite(source, sourceRelative, manifest);
  const output = execFileSync(
    pnpm,
    ["pack", "--offline", "--json", "--pack-destination", artifactsDirectory],
    { cwd: source, encoding: "utf8", env: environment },
  );
  const parsed = JSON.parse(output);
  const result = Array.isArray(parsed) ? parsed[0] : parsed;
  const tarball = resolve(source, result.filename);
  if (!existsSync(tarball))
    throw new Error(`npm pack did not write ${result.filename}`);
  if (validate) assertRealArchive(manifest, sourceRelative, tarball, root);
  return { name: manifest.name, version: manifest.version, tarball };
}

function releaseArtifactRecord(item) {
  const bytes = readFileSync(item.tarball);
  return {
    name: item.name,
    version: item.version,
    filename: basename(item.tarball),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sha512: createHash("sha512").update(bytes).digest("hex"),
  };
}

/**
 * A durable, offline consumer fixture for the documented pre-publication
 * route. It is emitted only when the operator selects --artifacts-dir, never
 * from the default temporary smoke path. Existing fixture paths are refused so
 * staging cannot silently overwrite an operator's files.
 */
function writeConsumerFixture(directory, tarballs) {
  if (existsSync(directory))
    throw new Error(`consumer fixture already exists: ${directory}`);
  const vendorDirectory = join(directory, "tarballs");
  mkdirSync(vendorDirectory, { recursive: true });
  for (const { tarball } of tarballs)
    writeFileSync(
      join(vendorDirectory, basename(tarball)),
      readFileSync(tarball),
    );
  const dependencies = Object.fromEntries(
    tarballs.map(({ name, tarball }) => [
      name,
      `file:tarballs/${basename(tarball)}`,
    ]),
  );
  writeFileSync(
    join(directory, "package.json"),
    `${JSON.stringify({ name: "jev-fabric-packed-consumer", private: true, type: "module", dependencies }, null, 2)}\n`,
  );
  writeFileSync(
    join(directory, ".npmrc"),
    "offline=true\nregistry=http://127.0.0.1:9/\n",
  );
}

export function verifyPackArtifacts({
  root = process.cwd(),
  environment = {},
  artifactsDirectory,
  sourceRevision: requestedSourceRevision,
  sourceDateEpoch: requestedSourceDateEpoch,
} = {}) {
  const artifactOutput = artifactsDirectory
    ? {
        directory: resolve(artifactsDirectory),
        cleanup: false,
        sourceRevision: requestedSourceRevision
          ? validatedRevision(requestedSourceRevision)
          : sourceRevision(root),
        sourceDateEpoch: requestedSourceDateEpoch
          ? validatedEpoch(requestedSourceDateEpoch)
          : sourceDateEpoch(root),
      }
    : artifactOutputFromArguments(root);
  const smokeDirectory = mkdtempSync(join(tmpdir(), "jev-fabric-packed-"));
  try {
    const offline = offlineEnvironment({
      ...environment,
      NPM_CONFIG_CACHE:
        environment.NPM_CONFIG_CACHE ?? join(smokeDirectory, "npm-cache"),
    });
    const pnpm = pinnedPnpm(root);
    const version = releaseVersion(root);
    mkdirSync(artifactOutput.directory, { recursive: true });
    const packedLocal = localPackages.map(([_name, relative]) =>
      pack(
        resolve(root, relative),
        relative,
        artifactOutput.directory,
        root,
        true,
        pnpm,
        offline,
      ),
    );
    const packedExternal = externalPackages.map(([name, relative]) => {
      const source = resolve(root, relative);
      if (!existsSync(source))
        throw new Error(`missing locked runtime dependency source: ${name}`);
      return pack(
        source,
        relative,
        artifactOutput.directory,
        root,
        false,
        pnpm,
        offline,
      );
    });
    // This manifest binds the generated SBOM to the exact first-party archives.
    // It deliberately excludes vendored third-party tarballs used only by the
    // offline consumer smoke.
    writeFileSync(
      join(artifactOutput.directory, "release-artifacts.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          releaseVersion: version,
          sourceRevision: artifactOutput.sourceRevision,
          sourceDateEpoch: artifactOutput.sourceDateEpoch,
          packages: packedLocal
            .map(releaseArtifactRecord)
            .sort((left, right) => left.name.localeCompare(right.name)),
        },
        null,
        2,
      )}\n`,
    );
    const allTarballs = [...packedLocal, ...packedExternal];
    const dependencies = Object.fromEntries(
      allTarballs.map(({ name, tarball }) => [
        name,
        `file:tarballs/${basename(tarball)}`,
      ]),
    );
    const vendorDirectory = join(smokeDirectory, "tarballs");
    mkdirSync(vendorDirectory, { recursive: true });
    for (const { tarball } of allTarballs)
      writeFileSync(
        join(vendorDirectory, basename(tarball)),
        readFileSync(tarball),
      );
    writeFileSync(
      join(smokeDirectory, "package.json"),
      `${JSON.stringify({ name: "jev-fabric-packed-smoke", private: true, type: "module", dependencies }, null, 2)}\n`,
    );
    writeFileSync(
      join(smokeDirectory, ".npmrc"),
      "offline=true\nregistry=http://127.0.0.1:9/\n",
    );
    if (!artifactOutput.cleanup)
      writeConsumerFixture(
        join(artifactOutput.directory, "consumer-fixture"),
        allTarballs,
      );
    npm(
      ["install", "--offline", "--ignore-scripts", "--package-lock=false"],
      smokeDirectory,
      offline,
      "inherit",
    );
    command(
      [resolve(root, "scripts/installed-cli-smoke.mjs"), smokeDirectory, root],
      smokeDirectory,
      offline,
    );
    command(
      [resolve(root, "scripts/mcp-cli-smoke.mjs"), smokeDirectory],
      smokeDirectory,
      offline,
    );
  } finally {
    rmSync(smokeDirectory, { recursive: true, force: true });
    if (artifactOutput.cleanup)
      rmSync(artifactOutput.directory, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  verifyPackArtifacts();

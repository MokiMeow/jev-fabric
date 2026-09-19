import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { glob, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..", "..");
const execute = promisify(execFile);

describe("release artifacts", () => {
  it("generates deterministic SPDX SBOMs with the locked runtime dependency graph", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jev-fabric-sbom-test-"));
    const first = join(directory, "first.spdx.json");
    const second = join(directory, "second.spdx.json");
    try {
      const { generateSbom, validateSpdxDocument } = await import(
        new URL("../generate-sbom.mts", import.meta.url).href
      );
      await generateSbom({ root, output: first });
      await generateSbom({ root, output: second });
      expect(await readFile(first, "utf8")).toBe(
        await readFile(second, "utf8"),
      );
      const sbom = JSON.parse(await readFile(first, "utf8")) as {
        SPDXID: string;
        packages: Array<{
          name: string;
          licenseConcluded: string;
          checksums?: Array<{ algorithm: string; checksumValue: string }>;
        }>;
        relationships: Array<{
          relationshipType: string;
          spdxElementId: string;
          relatedSpdxElement: string;
        }>;
      };
      expect(sbom.SPDXID).toBe("SPDXRef-DOCUMENT");
      expect(() => validateSpdxDocument(sbom)).not.toThrow();
      expect(sbom.packages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "@mokimeow/jev-fabric-cli",
            licenseConcluded: "Apache-2.0",
          }),
          expect.objectContaining({ name: "@modelcontextprotocol/core" }),
          expect.objectContaining({ name: "@modelcontextprotocol/server" }),
          expect.objectContaining({ name: "@typesafe-ai/sdk" }),
          expect.objectContaining({
            name: "zod",
            checksums: [expect.objectContaining({ algorithm: "SHA512" })],
          }),
        ]),
      );
      expect(
        sbom.relationships.some(
          ({ relationshipType }) => relationshipType === "DEPENDS_ON",
        ),
      ).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("binds release identity and exact packed artifacts deterministically", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jev-fabric-sbom-release-"));
    const artifacts = join(directory, "packages");
    const first = join(directory, "first.spdx.json");
    const second = join(directory, "second.spdx.json");
    const changed = join(directory, "changed.spdx.json");
    const revisionChanged = join(directory, "revision-changed.spdx.json");
    const epochChanged = join(directory, "epoch-changed.spdx.json");
    const revision = "a".repeat(40);
    try {
      const { verifyPackArtifacts } = await import(
        new URL("../pack-smoke.mts", import.meta.url).href
      );
      verifyPackArtifacts({
        root,
        artifactsDirectory: artifacts,
        sourceRevision: revision,
        sourceDateEpoch: "1700000000",
        environment: {
          NPM_CONFIG_CACHE: join(directory, "npm-cache"),
          NPM_CONFIG_OFFLINE: "true",
          NPM_CONFIG_REGISTRY: "http://127.0.0.1:9/",
        },
      });
      const { generateSbom } = await import(
        new URL("../generate-sbom.mts", import.meta.url).href
      );
      const options = {
        root,
        artifactsDirectory: artifacts,
        sourceRevision: revision,
        sourceDateEpoch: 1_700_000_000,
      };
      await generateSbom({ ...options, output: first });
      await generateSbom({ ...options, output: second });
      expect(await readFile(first, "utf8")).toBe(
        await readFile(second, "utf8"),
      );
      const document = JSON.parse(await readFile(first, "utf8")) as {
        documentNamespace: string;
        documentComment: string;
        packages: Array<{
          name: string;
          checksums?: Array<{ algorithm: string; checksumValue: string }>;
        }>;
      };
      expect(document.documentNamespace).toContain(revision);
      expect(document.documentComment).toContain("Artifact binding: present");
      const cli = document.packages.find((entry) =>
        entry.name.endsWith("-cli"),
      );
      expect(cli?.checksums).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ algorithm: "SHA256" }),
          expect.objectContaining({ algorithm: "SHA512" }),
        ]),
      );
      const { generateReleaseChecksums } = await import(
        new URL("../generate-release-checksums.mts", import.meta.url).href
      );
      await generateReleaseChecksums({
        artifactsDirectory: artifacts,
        sbom: first,
      });
      const evidencePath = join(artifacts, "release-evidence.json");
      const checksumsPath = join(artifacts, "SHA256SUMS");
      const initialEvidence = await readFile(evidencePath, "utf8");
      const initialChecksums = await readFile(checksumsPath, "utf8");
      expect(initialChecksums).toContain("release-evidence.json");
      expect(initialChecksums).toContain("first.spdx.json");
      await generateReleaseChecksums({
        artifactsDirectory: artifacts,
        sbom: first,
      });
      expect(await readFile(evidencePath, "utf8")).toBe(initialEvidence);
      expect(await readFile(checksumsPath, "utf8")).toBe(initialChecksums);
      const bundlePath = join(artifacts, "release-artifacts.json");
      const bundle = JSON.parse(await readFile(bundlePath, "utf8")) as {
        releaseVersion: string;
        sourceRevision: string;
        sourceDateEpoch: string;
        packages: Array<{ filename: string; sha256: string; sha512: string }>;
      };
      bundle.sourceRevision = "b".repeat(40);
      await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
      await generateSbom({
        ...options,
        sourceRevision: bundle.sourceRevision,
        output: revisionChanged,
      });
      await generateReleaseChecksums({
        artifactsDirectory: artifacts,
        sbom: revisionChanged,
      });
      expect(await readFile(evidencePath, "utf8")).not.toBe(initialEvidence);
      expect(await readFile(checksumsPath, "utf8")).not.toBe(initialChecksums);
      const revisionEvidence = await readFile(evidencePath, "utf8");
      bundle.sourceDateEpoch = "1700000001";
      await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
      await generateSbom({
        ...options,
        sourceRevision: bundle.sourceRevision,
        sourceDateEpoch: bundle.sourceDateEpoch,
        output: epochChanged,
      });
      await generateReleaseChecksums({
        artifactsDirectory: artifacts,
        sbom: epochChanged,
      });
      expect(await readFile(evidencePath, "utf8")).not.toBe(revisionEvidence);
      const epochEvidence = await readFile(evidencePath, "utf8");
      await writeFile(epochChanged, `${await readFile(epochChanged, "utf8")} `);
      await generateReleaseChecksums({
        artifactsDirectory: artifacts,
        sbom: epochChanged,
      });
      expect(await readFile(evidencePath, "utf8")).not.toBe(epochEvidence);
      bundle.releaseVersion = "0.1.0-alpha.2";
      await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
      await expect(
        generateSbom({
          ...options,
          releaseVersion: bundle.releaseVersion,
          sourceRevision: bundle.sourceRevision,
          sourceDateEpoch: bundle.sourceDateEpoch,
          output: changed,
        }),
      ).rejects.toThrow(/release version/u);
      await expect(
        generateReleaseChecksums({
          artifactsDirectory: artifacts,
          sbom: epochChanged,
        }),
      ).rejects.toThrow(/invalid package binding/u);
      bundle.releaseVersion = "0.1.0-alpha.1";
      const artifact = bundle.packages[0];
      const tarball = join(artifacts, artifact.filename);
      const bytes = Buffer.concat([await readFile(tarball), Buffer.from("x")]);
      await writeFile(tarball, bytes);
      artifact.sha256 = createHash("sha256").update(bytes).digest("hex");
      artifact.sha512 = createHash("sha512").update(bytes).digest("hex");
      await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
      await generateSbom({
        ...options,
        sourceRevision: bundle.sourceRevision,
        sourceDateEpoch: bundle.sourceDateEpoch,
        output: changed,
      });
      await generateReleaseChecksums({
        artifactsDirectory: artifacts,
        sbom: changed,
      });
      expect(await readFile(evidencePath, "utf8")).not.toBe(epochEvidence);
      expect(await readFile(changed, "utf8")).not.toBe(
        await readFile(first, "utf8"),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);

  it("packs and installs through a clean offline network trap", async () => {
    const { verifyPackArtifacts } = await import(
      new URL("../pack-smoke.mts", import.meta.url).href
    );
    const cache = await mkdtemp(join(tmpdir(), "jev-fabric-pack-cache-"));
    try {
      expect(
        verifyPackArtifacts({
          root,
          environment: {
            PATH: dirname(process.execPath),
            NPM_CONFIG_CACHE: cache,
            NPM_CONFIG_OFFLINE: "true",
            NPM_CONFIG_REGISTRY: "http://127.0.0.1:9/",
          },
        }),
      ).toBeUndefined();
    } finally {
      await rm(cache, { recursive: true, force: true });
    }
  }, 60_000);

  it("runs two real pack smokes concurrently without reading workspace dist", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jev-fabric-pack-race-"));
    try {
      const script = resolve(root, "scripts/pack-smoke.mjs");
      await Promise.all(
        ["left", "right"].map((name) =>
          execute(
            process.execPath,
            [script, "--artifacts-dir", join(directory, name)],
            {
              cwd: root,
              env: {
                ...process.env,
                NPM_CONFIG_OFFLINE: "true",
                NPM_CONFIG_REGISTRY: "http://127.0.0.1:9/",
              },
              maxBuffer: 10 * 1024 * 1024,
            },
          ),
        ),
      );
      for (const name of ["left", "right"])
        expect(
          await readFile(
            join(directory, name, "consumer-fixture", "package.json"),
            "utf8",
          ),
        ).toContain("jev-fabric-packed-consumer");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);

  it("does not bootstrap a package manager capable of downloading", async () => {
    const source = await readFile(
      resolve(root, "scripts/pack-smoke.mjs"),
      "utf8",
    );
    expect(source).not.toMatch(/npm\s+exec\s+--yes/u);
    expect(source).toContain("NPM_CONFIG_OFFLINE");
    expect(source).toContain("NPM_CONFIG_REGISTRY");
    expect(source).toContain("pinned pnpm prerequisite");
    expect(source).toContain("release-artifacts.json");
    const scriptDirectory = resolve(root, "scripts");
    for await (const file of glob("**/*.{js,mjs,ts,mts}", {
      cwd: scriptDirectory,
    })) {
      const contents = await readFile(resolve(scriptDirectory, file), "utf8");
      expect(contents, file).not.toMatch(
        /(?:npm|npx)\s+(?:exec\s+--yes|--yes)|pnpm\s+dlx/u,
      );
    }
  });
});

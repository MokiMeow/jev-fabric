import assert from "node:assert/strict";
import {
  appendFile,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { computeFinanceProjectionBindingHash } from "../../../../packages/adapters/src/index.js";
import {
  canonicalJson,
  readSafeRelativeFile,
  sha256,
} from "../lib/canonical.mjs";
import {
  type BuildManifest,
  computeRebuildDigest,
  financeCandidateEvidenceHash,
  verifyFinanceBuilderDirectory,
  verifyFinanceRetainedDatasetBundle,
} from "../lib/verify.mjs";
import {
  FINANCE_CHART_RENDERER,
  renderFinanceChart,
} from "../visual/render.mjs";

const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "tiny",
);
const temporaryRoots: string[] = [];
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const filingExcerpt = '"items": "2.02"';
const filingClaim = "The filing reports Item 2.02.";

after(async () => {
  await Promise.all(
    temporaryRoots.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

interface Fixture {
  readonly root: string;
  readonly dataset: string;
  readonly cache: string;
}

test("accepts the canonical offline three-track fixture", async () => {
  const fixture = await createFixture();
  const result = await verifyFinanceBuilderDirectory({
    datasetDirectory: fixture.dataset,
    cacheDirectory: fixture.cache,
  });
  assert.equal(result.caseCount, 9);
  assert.equal(result.sourceCount, 3);
  assert.match(result.rebuildDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(result.schemaVersion, "finance.retained-dataset-bundle.v1");
  assert.ok(!("casesBytes" in result));
  assert.ok(!("evidenceFiles" in result));
  assert.ok(!("visualArtifacts" in result));
  assert.ok(JSON.stringify(result).length < 2_000);
  const retainedBundle = await verifyFinanceRetainedDatasetBundle(
    fixture.dataset,
  );
  const expectedEvidencePaths = [
    "build-manifest.json",
    "builder-config.json",
    "labels.v1.json",
    "provenance.jsonl",
    "source-lock.json",
    "split.v1.json",
  ] as const;
  assert.deepEqual(
    retainedBundle.evidenceFiles.map(({ path }) => path),
    expectedEvidencePaths,
  );
  for (const evidence of retainedBundle.evidenceFiles) {
    const retained = await readFile(join(fixture.dataset, evidence.path));
    assert.equal(evidence.byteLength, retained.byteLength);
    assert.equal(evidence.sha256, sha256(retained));
    assert.deepEqual(Buffer.from(evidence.content), retained);
  }
  assert.equal(
    result.buildManifestHash,
    sha256(await readFile(join(fixture.dataset, "build-manifest.json"))),
  );
  assert.equal(
    result.sourceLockHash,
    sha256(await readFile(join(fixture.dataset, "source-lock.json"))),
  );
  assert.equal(
    result.provenanceHash,
    sha256(await readFile(join(fixture.dataset, "provenance.jsonl"))),
  );
});

test("rejects trusted instrument and signal-time substitutions after outer rehashing", async () => {
  for (const mutate of [
    (projection: Record<string, unknown>) => {
      projection.instrumentRef = "ref:substituted.instrument";
    },
    (projection: Record<string, unknown>) => {
      const signals = projection.signals as Record<string, unknown>[];
      const signal = signals[0];
      if (signal === undefined)
        throw new TypeError("fixture signal is missing");
      signal.asOf = "2025-03-15T11:58:00.000Z";
    },
  ]) {
    const fixture = await createFixture();
    const casesPath = join(fixture.dataset, "cases.jsonl");
    const cases = await readJsonLines(casesPath);
    const benchmarkCase = cases.find(
      (entry) =>
        entry.track === "market_surveillance" &&
        entry.split === "test" &&
        entry.lookaheadProbe === false,
    );
    if (benchmarkCase === undefined)
      throw new TypeError("fixture benchmark case is missing");
    mutate(benchmarkCase.trustedProjection);
    await writeCanonicalJsonLines(casesPath, cases);
    await refreshManifest(fixture.dataset);

    await assert.rejects(verify(fixture), /projection binding hash mismatch/u);
  }
});

test("accepts multiple immutable sources for one track", async () => {
  const fixture = await createFixture();
  const extraPath = join(fixture.cache, "sources", "edgar", "extra.json");
  const extraBytes = Buffer.from('{"fixture":"second selected filing body"}\n');
  await writeFile(extraPath, extraBytes);
  const lock = await readJson(join(fixture.dataset, "source-lock.json"));
  lock.sources.push({
    id: "sec.edgar.extra",
    track: "financial_text_triage",
    kind: "sec_edgar_submission",
    url: "https://www.sec.gov/Archives/edgar/data/1/000000000025000002/fixture.txt",
    pin: {
      kind: "content_sha256",
      value: sha256(extraBytes),
      sha256: sha256(extraBytes),
      bytes: extraBytes.byteLength,
    },
    cachePath: "sources/edgar/extra.json",
    mediaType: "application/json",
    rights: {
      redistribution: "allowed",
      evidenceUrl: "https://www.sec.gov/about/privacy-information",
      statement: "Public EDGAR fixture source.",
      reviewedAt: "2026-09-20",
    },
  });
  lock.sources.sort((left: { id: string }, right: { id: string }) =>
    left.id.localeCompare(right.id),
  );
  await writeJson(join(fixture.dataset, "source-lock.json"), lock);

  const provenance = await readJsonLines(
    join(fixture.dataset, "provenance.jsonl"),
  );
  const selected = provenance.find(
    (record) =>
      record.track === "financial_text_triage" &&
      record.split === "calibration",
  );
  selected.sourceIds.push("sec.edgar.extra");
  selected.sourceIds.sort();
  await writeCanonicalJsonLines(
    join(fixture.dataset, "provenance.jsonl"),
    provenance,
  );

  const manifest = await readJson(join(fixture.dataset, "build-manifest.json"));
  manifest.artifacts.cases.sourceUses.push({
    sourceId: "sec.edgar.extra",
    retention: "source_excerpt",
  });
  manifest.artifacts.provenance.sourceUses.push({
    sourceId: "sec.edgar.extra",
    retention: "metadata_only",
  });
  manifest.artifacts.cases.sourceUses.sort(
    (left: { sourceId: string }, right: { sourceId: string }) =>
      left.sourceId.localeCompare(right.sourceId),
  );
  manifest.artifacts.provenance.sourceUses.sort(
    (left: { sourceId: string }, right: { sourceId: string }) =>
      left.sourceId.localeCompare(right.sourceId),
  );
  await writeJson(join(fixture.dataset, "build-manifest.json"), manifest);
  await refreshManifest(fixture.dataset);

  const result = await verify(fixture);
  assert.equal((result as { sourceCount: number }).sourceCount, 4);
});

test("loads a retained dataset through the verified builder closure", async () => {
  const fixture = await createFixture();
  const { loadFinanceDataset } = await import("../../scripts/run.mjs");

  const loaded = await loadFinanceDataset(fixture.dataset);

  assert.equal(loaded.manifest.datasetId, "finance.public-fixture.v1");
  assert.equal(
    loaded.builderEvidence.schemaVersion,
    "finance.retained-dataset-bundle.v1",
  );
  assert.equal(loaded.builderEvidence.caseCount, loaded.cases.length);
  assert.deepEqual(
    loaded.builderEvidence.evidenceFiles.map(({ path }) => path),
    [
      "build-manifest.json",
      "builder-config.json",
      "labels.v1.json",
      "provenance.jsonl",
      "source-lock.json",
      "split.v1.json",
    ],
  );
});

test("rejects retained dataset drift before any finance driver can run", async () => {
  const forgedCasesFixture = await createFixture();
  const forgedCases = await readJsonLines(
    join(forgedCasesFixture.dataset, "cases.jsonl"),
  );
  forgedCases[0].groupId = "forged-group";
  await writeCanonicalJsonLines(
    join(forgedCasesFixture.dataset, "cases.jsonl"),
    forgedCases,
  );
  const forgedManifest = await readJson(
    join(forgedCasesFixture.dataset, "dataset-manifest.json"),
  );
  forgedManifest.caseSetHash = sha256(
    await readFile(join(forgedCasesFixture.dataset, "cases.jsonl")),
  );
  await writeJson(
    join(forgedCasesFixture.dataset, "dataset-manifest.json"),
    forgedManifest,
  );
  const { loadFinanceDataset } = await import("../../scripts/run.mjs");
  await assert.rejects(
    () => loadFinanceDataset(forgedCasesFixture.dataset),
    /artifact (hash|size) mismatch: cases\.jsonl/u,
  );

  const splitFixture = await createFixture();
  const splitManifest = await readJson(
    join(splitFixture.dataset, "dataset-manifest.json"),
  );
  splitManifest.testStart = "2026-04-01T00:00:00.000Z";
  await writeJson(
    join(splitFixture.dataset, "dataset-manifest.json"),
    splitManifest,
  );
  await assert.rejects(
    () => loadFinanceDataset(splitFixture.dataset),
    /split does not match builder evidence/u,
  );

  const policyFixture = await createFixture();
  await writeFile(
    join(policyFixture.dataset, "labels.v1.json"),
    '{"schemaVersion":"1","tampered":true}\n',
  );
  await assert.rejects(
    () => loadFinanceDataset(policyFixture.dataset),
    /artifact (hash|size) mismatch: labels\.v1\.json/u,
  );

  const extraAssetFixture = await createFixture();
  await writeFile(
    join(extraAssetFixture.dataset, "assets", "unbound.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
  );
  await assert.rejects(
    () => loadFinanceDataset(extraAssetFixture.dataset),
    /visual artifact file set does not match build manifest/u,
  );
});

test("publishes the exact verified builder evidence snapshots", async () => {
  const fixture = await createFixture();
  const { loadFinanceDataset, writeFinanceArtifacts } = await import(
    "../../scripts/run.mjs"
  );
  const dataset = await loadFinanceDataset(fixture.dataset);
  const component = (role: "deterministic" | "host" | "jev") => ({
    role,
    providerId: `${role}-fixture`,
    modelId: role === "deterministic" ? "none" : `${role}-model`,
    modelVersion: role === "deterministic" ? "none" : `${role}-1.0.0`,
    responseModel: role === "deterministic" ? "none" : `${role}-1.0.0`,
    modelVersionEvidence: { kind: "response_exact" as const },
    probabilitySemantics:
      role === "deterministic"
        ? ("none" as const)
        : ("native_calibrated" as const),
    pricing: null,
  });
  const host = component("host");
  const jev = component("jev");
  const runtime = {
    questionSetHash: hash("1"),
    policyVersion: "1",
    featureSetHash: hash("2"),
    hardware: "fixture-cpu",
    region: "offline",
    concurrency: 1,
    timeoutMs: 1_000,
    architectures: {
      deterministic_only: {
        components: [component("deterministic")],
        combinerId: "deterministic",
        combinerVersion: "1",
      },
      host_model_only: {
        components: [host],
        combinerId: "host",
        combinerVersion: "1",
      },
      jev_advisory: {
        components: [jev],
        combinerId: "jev",
        combinerVersion: "1",
      },
      host_plus_jev: {
        components: [host, jev],
        combinerId: "restrictive-join",
        combinerVersion: "1",
      },
    },
  };
  const runArtifacts = {
    run: { runtime, traceSetHash: sha256("") },
    traces: [],
    tracesJsonl: "",
    dataset,
    runtimeEvidence: [],
  };
  const output = join(fixture.root, "published");
  await writeFinanceArtifacts(output, runArtifacts);
  assert.ok(dataset.builderEvidence !== null);
  for (const evidence of dataset.builderEvidence.evidenceFiles) {
    assert.deepEqual(
      await readFile(join(output, evidence.path)),
      Buffer.from(evidence.content),
    );
  }
  const published = await loadFinanceDataset(output);
  assert.equal(
    published.builderEvidence?.rebuildDigest,
    dataset.builderEvidence.rebuildDigest,
  );

  await assert.rejects(
    () =>
      writeFinanceArtifacts(join(fixture.root, "forged-split"), {
        ...runArtifacts,
        dataset: {
          ...dataset,
          manifest: {
            ...dataset.manifest,
            testStart: "2026-04-01T00:00:00.000Z",
          },
        },
      }),
    /finance builder evidence split does not match/u,
  );

  const tamperedPolicy = new TextEncoder().encode(
    '{"schemaVersion":"1","tampered":true}\n',
  );
  const substitutedEvidence = {
    ...dataset.builderEvidence,
    evidenceFiles: dataset.builderEvidence.evidenceFiles.map((file) =>
      file.path === "labels.v1.json"
        ? {
            ...file,
            content: tamperedPolicy,
            byteLength: tamperedPolicy.byteLength,
            sha256: sha256(tamperedPolicy),
          }
        : file,
    ),
  };
  await assert.rejects(
    () =>
      writeFinanceArtifacts(join(fixture.root, "substituted"), {
        ...runArtifacts,
        dataset: { ...dataset, builderEvidence: substitutedEvidence },
      }),
    /artifact (hash|size) mismatch: labels\.v1\.json/u,
  );
});

test("rejects unsorted source ids even when every source is immutable", async () => {
  const fixture = await createFixture();
  const lock = await readJson(join(fixture.dataset, "source-lock.json"));
  lock.sources.reverse();
  await writeJson(join(fixture.dataset, "source-lock.json"), lock);
  await refreshManifest(fixture.dataset);
  await assert.rejects(
    () => verify(fixture),
    /source ids must be strictly sorted/u,
  );
});

test("reads through one file handle under a path-swap race", async () => {
  const root = await mkdtemp(join(tmpdir(), "jev-finance-handle-"));
  temporaryRoots.push(root);
  const payload = join(root, "payload.bin");
  const replacement = join(root, "replacement.bin");
  const originalBytes = Buffer.alloc(8 * 1024 * 1024, 0x41);
  const replacementBytes = Buffer.alloc(8 * 1024 * 1024, 0x42);
  await Promise.all([
    writeFile(payload, originalBytes),
    writeFile(replacement, replacementBytes),
  ]);

  const reading = readSafeRelativeFile(
    root,
    "payload.bin",
    16 * 1024 * 1024,
  ).then(
    (bytes) => ({ bytes, error: null }),
    (error: unknown) => ({ bytes: null, error }),
  );
  try {
    await rename(payload, join(root, "original.bin"));
    await rename(replacement, payload);
  } catch {
    // Windows can deny the rename once the verifier has the handle open.
  }
  const outcome = await reading;
  if (outcome.error === null) {
    const bytes = outcome.bytes;
    assert.ok(bytes !== null);
    assert.ok(
      sha256(bytes) === sha256(originalBytes) ||
        sha256(bytes) === sha256(replacementBytes),
      "a path race must never produce mixed bytes",
    );
  } else {
    assert.match(String(outcome.error), /changed|ENOENT|EPERM|EBUSY/u);
  }
});

test("rejects an append race at the byte limit without an excess allocation", async () => {
  const root = await mkdtemp(join(tmpdir(), "jev-finance-append-"));
  temporaryRoots.push(root);
  const payload = join(root, "payload.bin");
  const maximumBytes = 4 * 1024 * 1024;
  await writeFile(payload, Buffer.alloc(maximumBytes, 0x41));

  const reading = readSafeRelativeFile(root, "payload.bin", maximumBytes).then(
    (bytes) => ({ bytes, error: null }),
    (error: unknown) => ({ bytes: null, error }),
  );
  await appendFile(payload, Buffer.from([0x42]));
  const outcome = await reading;
  assert.equal(outcome.bytes, null);
  assert.match(String(outcome.error), /exceeds|changed|size/u);
});

test("rejects mutable or incomplete source pins", async () => {
  const fixture = await createFixture();
  const lock = await readJson(join(fixture.dataset, "source-lock.json"));
  lock.sources[0].pin.value = "main";
  await writeJson(join(fixture.dataset, "source-lock.json"), lock);
  await refreshManifest(fixture.dataset);
  await assert.rejects(
    () => verify(fixture),
    /not pinned to a 40-character commit/u,
  );
});

test("rejects non-HTTPS and credentialed source URLs", async () => {
  for (const unsafeUrl of [
    "http://www.sec.gov/example.zip",
    "https://user:secret@www.sec.gov/example.zip",
    "https://www.sec.gov/example.zip?api_key=secret",
  ]) {
    const fixture = await createFixture();
    const lock = await readJson(join(fixture.dataset, "source-lock.json"));
    lock.sources[1].url = unsafeUrl;
    await writeJson(join(fixture.dataset, "source-lock.json"), lock);
    await refreshManifest(fixture.dataset);
    await assert.rejects(
      () => verify(fixture),
      /credential-free canonical HTTPS/u,
    );
  }
});

test("rejects source hash and size mismatches", async () => {
  const hashFixture = await createFixture();
  await writeFile(
    join(hashFixture.cache, "sources", "edgar", "fixture.json"),
    "different bytes",
  );
  await assert.rejects(
    () => verify(hashFixture),
    /source size mismatch|source hash mismatch/u,
  );

  const sizeFixture = await createFixture();
  const lock = await readJson(join(sizeFixture.dataset, "source-lock.json"));
  lock.sources[1].pin.bytes += 1;
  await writeJson(join(sizeFixture.dataset, "source-lock.json"), lock);
  await refreshManifest(sizeFixture.dataset);
  await assert.rejects(() => verify(sizeFixture), /source size mismatch/u);
});

test("rejects duplicate source and artifact hashes", async () => {
  const sourceFixture = await createFixture();
  const lock = await readJson(join(sourceFixture.dataset, "source-lock.json"));
  lock.sources[1].pin.sha256 = lock.sources[0].pin.sha256;
  lock.sources[1].pin.value = lock.sources[0].pin.sha256;
  await writeJson(join(sourceFixture.dataset, "source-lock.json"), lock);
  await refreshManifest(sourceFixture.dataset);
  await assert.rejects(() => verify(sourceFixture), /duplicate source hash/u);

  const artifactFixture = await createFixture();
  const manifest = await readJson(
    join(artifactFixture.dataset, "build-manifest.json"),
  );
  manifest.artifacts.provenance.sha256 = manifest.artifacts.cases.sha256;
  manifest.rebuildDigest = computeRebuildDigest(manifest as BuildManifest);
  await writeJson(
    join(artifactFixture.dataset, "build-manifest.json"),
    manifest,
  );
  await assert.rejects(
    () => verify(artifactFixture),
    /duplicate artifact hash/u,
  );
});

test("rejects unsafe cache and artifact paths", async () => {
  const cacheFixture = await createFixture();
  const lock = await readJson(join(cacheFixture.dataset, "source-lock.json"));
  lock.sources[0].cachePath = "../escape";
  await writeJson(join(cacheFixture.dataset, "source-lock.json"), lock);
  await refreshManifest(cacheFixture.dataset);
  await assert.rejects(() => verify(cacheFixture), /unsafe path segment/u);

  const alternateStreamFixture = await createFixture();
  const alternateStreamLock = await readJson(
    join(alternateStreamFixture.dataset, "source-lock.json"),
  );
  alternateStreamLock.sources[0].cachePath = "sources/abides/file:stream";
  await writeJson(
    join(alternateStreamFixture.dataset, "source-lock.json"),
    alternateStreamLock,
  );
  await refreshManifest(alternateStreamFixture.dataset);
  await assert.rejects(
    () => verify(alternateStreamFixture),
    /unsafe path segment/u,
  );

  const artifactFixture = await createFixture();
  const manifest = await readJson(
    join(artifactFixture.dataset, "build-manifest.json"),
  );
  manifest.artifacts.cases.path = "../cases.jsonl";
  manifest.rebuildDigest = computeRebuildDigest(manifest);
  await writeJson(
    join(artifactFixture.dataset, "build-manifest.json"),
    manifest,
  );
  await assert.rejects(() => verify(artifactFixture), /unsafe path segment/u);
});

test("rejects source-cache symlinks", async (context) => {
  const fixture = await createFixture();
  const sourceDirectory = join(fixture.cache, "sources", "edgar");
  const targetDirectory = join(fixture.cache, "symlink-target");
  await mkdir(targetDirectory);
  await copyFile(
    join(sourceDirectory, "fixture.json"),
    join(targetDirectory, "fixture.json"),
  );
  await rm(sourceDirectory, { recursive: true });
  try {
    await symlink(targetDirectory, sourceDirectory, "junction");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      context.skip("host does not permit creation of test symlinks");
      return;
    }
    throw error;
  }
  await assert.rejects(() => verify(fixture), /symlink is not allowed/u);
});

test("rejects unresolved retained-public rights", async () => {
  const fixture = await createFixture();
  const lock = await readJson(join(fixture.dataset, "source-lock.json"));
  lock.sources[2].rights.redistribution = "unresolved";
  await writeJson(join(fixture.dataset, "source-lock.json"), lock);
  await refreshManifest(fixture.dataset);
  await assert.rejects(
    () => verify(fixture),
    /unresolved retained-public rights/u,
  );
});

test("allows generated-output-only rights only for generated or metadata retention", async () => {
  const generatedFixture = await createFixture();
  const generatedLock = await readJson(
    join(generatedFixture.dataset, "source-lock.json"),
  );
  generatedLock.sources.find(
    (source: { id: string }) => source.id === "abides.source",
  ).rights.redistribution = "generated_output_only";
  await writeJson(
    join(generatedFixture.dataset, "source-lock.json"),
    generatedLock,
  );
  await refreshManifest(generatedFixture.dataset);
  await verify(generatedFixture);

  const excerptFixture = await createFixture();
  const excerptLock = await readJson(
    join(excerptFixture.dataset, "source-lock.json"),
  );
  excerptLock.sources.find(
    (source: { id: string }) => source.id === "sec.edgar",
  ).rights.redistribution = "generated_output_only";
  await writeJson(
    join(excerptFixture.dataset, "source-lock.json"),
    excerptLock,
  );
  await refreshManifest(excerptFixture.dataset);
  await assert.rejects(
    () => verify(excerptFixture),
    /generated-output-only source is retained as source_excerpt/u,
  );
});

test("rejects a source-retention declaration that hides retained excerpts", async () => {
  const fixture = await createFixture();
  const manifest = await readJson(join(fixture.dataset, "build-manifest.json"));
  manifest.artifacts.cases.sourceUses.find(
    (use: { sourceId: string }) => use.sourceId === "sec.edgar",
  ).retention = "metadata_only";
  await writeJson(join(fixture.dataset, "build-manifest.json"), manifest);
  await refreshManifest(fixture.dataset);
  await assert.rejects(
    () => verify(fixture),
    /retention for sec.edgar does not match retained content/u,
  );
});

test("rejects mismatched and duplicate financial-text candidate bindings", async () => {
  const mismatched = await createFixture();
  const mismatchedCases = await readJsonLines(
    join(mismatched.dataset, "cases.jsonl"),
  );
  const mismatchedCase = mismatchedCases.find(
    (benchmarkCase) => benchmarkCase.track === "financial_text_triage",
  );
  mismatchedCase.trustedProjection.text.candidateBindings[0].excerptHash =
    hash("9");
  resealBenchmarkCase(mismatchedCase);
  await writeCanonicalJsonLines(
    join(mismatched.dataset, "cases.jsonl"),
    mismatchedCases,
  );
  await refreshManifest(mismatched.dataset);
  await assert.rejects(
    () => verify(mismatched),
    /text candidate hash mismatch/u,
  );

  const duplicate = await createFixture();
  const duplicateCases = await readJsonLines(
    join(duplicate.dataset, "cases.jsonl"),
  );
  const duplicateCase = duplicateCases.find(
    (benchmarkCase) => benchmarkCase.track === "financial_text_triage",
  );
  duplicateCase.trustedProjection.text.candidateBindings.push({
    id: "fixture.claim.1",
    excerptHash: sha256("Second invented public-filing fixture excerpt."),
    claimHash: sha256("Second fixture claim."),
    sourceSpan: {
      ...duplicateCase.trustedProjection.text.candidateBindings[0].sourceSpan,
    },
  });
  duplicateCase.untrustedEvidence.text.excerpts.push(
    "Second invented public-filing fixture excerpt.",
  );
  duplicateCase.untrustedEvidence.text.claims.push("Second fixture claim.");
  await writeCanonicalJsonLines(
    join(duplicate.dataset, "cases.jsonl"),
    duplicateCases,
  );
  await refreshManifest(duplicate.dataset);
  await assert.rejects(() => verify(duplicate), /duplicate text candidate id/u);
});

test("binds financial-text claims and source spans to retained source bytes", async () => {
  const missingSpanFixture = await createFixture();
  const missingSpanCases = await readJsonLines(
    join(missingSpanFixture.dataset, "cases.jsonl"),
  );
  const missingSpanCase = missingSpanCases.find(
    (benchmarkCase) => benchmarkCase.track === "financial_text_triage",
  );
  delete missingSpanCase.trustedProjection.text.candidateBindings[0].sourceSpan;
  await writeCanonicalJsonLines(
    join(missingSpanFixture.dataset, "cases.jsonl"),
    missingSpanCases,
  );
  await refreshManifest(missingSpanFixture.dataset);
  await assert.rejects(
    () => verify(missingSpanFixture),
    /must have property sourceSpan when property claimHash is present/u,
  );

  const claimFixture = await createFixture();
  const claimCases = await readJsonLines(
    join(claimFixture.dataset, "cases.jsonl"),
  );
  const claimCase = claimCases.find(
    (benchmarkCase) => benchmarkCase.track === "financial_text_triage",
  );
  claimCase.untrustedEvidence.text.claims[0] = "A forged replacement claim.";
  await writeCanonicalJsonLines(
    join(claimFixture.dataset, "cases.jsonl"),
    claimCases,
  );
  await refreshManifest(claimFixture.dataset);
  await assert.rejects(() => verify(claimFixture), /text claim hash mismatch/u);

  const spanFixture = await createFixture();
  const spanCases = await readJsonLines(
    join(spanFixture.dataset, "cases.jsonl"),
  );
  const spanCase = spanCases.find(
    (benchmarkCase) => benchmarkCase.track === "financial_text_triage",
  );
  spanCase.trustedProjection.text.candidateBindings[0].sourceSpan.byteStart -= 1;
  const reboundEvidenceHash = financeCandidateEvidenceHash(
    spanCase.trustedProjection.text.candidateBindings[0],
  );
  spanCase.goldAtomic[4].evidenceHash = reboundEvidenceHash;
  spanCase.goldAtomic[5].evidenceHash = reboundEvidenceHash;
  resealBenchmarkCase(spanCase);
  await writeCanonicalJsonLines(
    join(spanFixture.dataset, "cases.jsonl"),
    spanCases,
  );
  await refreshManifest(spanFixture.dataset);
  await assert.rejects(() => verify(spanFixture), /text source span mismatch/u);
});

test("requires exact finance observe-gate atomic coverage and bindings", async () => {
  const idFixture = await createFixture();
  const idCases = await readJsonLines(join(idFixture.dataset, "cases.jsonl"));
  const idCase = idCases.find(
    (benchmarkCase) => benchmarkCase.track === "financial_text_triage",
  );
  idCase.goldAtomic[4].questionId = "finance-text-claim:fixture.claim.1";
  await writeCanonicalJsonLines(
    join(idFixture.dataset, "cases.jsonl"),
    idCases,
  );
  await refreshManifest(idFixture.dataset);
  await assert.rejects(
    () => verify(idFixture),
    /atomic gold binding mismatch/u,
  );

  const hashFixture = await createFixture();
  const hashCases = await readJsonLines(
    join(hashFixture.dataset, "cases.jsonl"),
  );
  const hashCase = hashCases.find(
    (benchmarkCase) => benchmarkCase.track === "financial_text_triage",
  );
  hashCase.goldAtomic[4].evidenceHash = hash("9");
  await writeCanonicalJsonLines(
    join(hashFixture.dataset, "cases.jsonl"),
    hashCases,
  );
  await refreshManifest(hashFixture.dataset);
  await assert.rejects(
    () => verify(hashFixture),
    /atomic gold binding mismatch/u,
  );

  const routeFixture = await createFixture();
  const routeCases = await readJsonLines(
    join(routeFixture.dataset, "cases.jsonl"),
  );
  const routeCase = routeCases.find(
    (benchmarkCase) => benchmarkCase.track === "market_surveillance",
  );
  routeCase.goldRoute = "investigate";
  await writeCanonicalJsonLines(
    join(routeFixture.dataset, "cases.jsonl"),
    routeCases,
  );
  await refreshManifest(routeFixture.dataset);
  await assert.rejects(
    () => verify(routeFixture),
    /atomic gold route mismatch/u,
  );
});

test("binds compiled visual mutations to their artifact and gold route", async () => {
  const wrongRoute = await createFixture();
  const wrongRouteCases = await readJsonLines(
    join(wrongRoute.dataset, "cases.jsonl"),
  );
  const wrongRouteCase = wrongRouteCases.find(
    (benchmarkCase) => benchmarkCase.track === "visual_evidence",
  );
  wrongRouteCase.goldRoute = "escalate";
  wrongRouteCase.goldAtomic[0].label = "escalate";
  await writeCanonicalJsonLines(
    join(wrongRoute.dataset, "cases.jsonl"),
    wrongRouteCases,
  );
  await refreshManifest(wrongRoute.dataset);
  await assert.rejects(
    () => verify(wrongRoute),
    /visual route binding mismatch/u,
  );

  const wrongArtifact = await createFixture();
  const wrongArtifactCases = await readJsonLines(
    join(wrongArtifact.dataset, "cases.jsonl"),
  );
  const wrongArtifactCase = wrongArtifactCases.find(
    (benchmarkCase) => benchmarkCase.track === "visual_evidence",
  );
  wrongArtifactCase.trustedProjection.visual.artifactBindingHash = hash("9");
  await writeCanonicalJsonLines(
    join(wrongArtifact.dataset, "cases.jsonl"),
    wrongArtifactCases,
  );
  await refreshManifest(wrongArtifact.dataset);
  await assert.rejects(
    () => verify(wrongArtifact),
    /visual artifact binding mismatch/u,
  );

  const forgedHashes = await createFixture();
  const forgedCases = await readJsonLines(
    join(forgedHashes.dataset, "cases.jsonl"),
  );
  const forgedCase = forgedCases.find(
    (benchmarkCase) => benchmarkCase.track === "visual_evidence",
  );
  const forgedVisual = forgedCase.trustedProjection.visual;
  forgedVisual.imageHash = hash("8");
  forgedVisual.sourceBindingHash = hash("7");
  forgedVisual.artifactBindingHash = sha256(
    canonicalJson({
      schemaVersion: "1",
      renderer: FINANCE_CHART_RENDERER,
      sourceBindingHash: forgedVisual.sourceBindingHash,
      imageHash: forgedVisual.imageHash,
      mutationId: forgedVisual.mutationId,
      expectedRoute: forgedVisual.expectedRoute,
    }),
  );
  resealBenchmarkCase(forgedCase);
  await writeCanonicalJsonLines(
    join(forgedHashes.dataset, "cases.jsonl"),
    forgedCases,
  );
  await refreshManifest(forgedHashes.dataset);
  await assert.rejects(
    () => verify(forgedHashes),
    /visual compiler output mismatch/u,
  );
});

test("rejects extra raw case fields before rights classification", async () => {
  const fixture = await createFixture();
  const lock = await readJson(join(fixture.dataset, "source-lock.json"));
  lock.sources.find(
    (source: { id: string }) => source.id === "sec.edgar",
  ).rights.redistribution = "generated_output_only";
  await writeJson(join(fixture.dataset, "source-lock.json"), lock);
  const cases = await readJsonLines(join(fixture.dataset, "cases.jsonl"));
  cases.find(
    (benchmarkCase) => benchmarkCase.track === "financial_text_triage",
  ).rawSource = {
    filingBody: "This field is outside the canonical finance case contract.",
  };
  await writeCanonicalJsonLines(join(fixture.dataset, "cases.jsonl"), cases);
  await refreshManifest(fixture.dataset);
  await assert.rejects(
    () => verify(fixture),
    /does not match the canonical case schema.*additional properties/u,
  );
});

test("binds claimed generator hashes to retained policy and config bytes", async () => {
  const claimedFixture = await createFixture();
  const claimedManifest = await readJson(
    join(claimedFixture.dataset, "build-manifest.json"),
  );
  claimedManifest.generator.labelPolicyHash = hash("9");
  claimedManifest.rebuildDigest = computeRebuildDigest(claimedManifest);
  await writeJson(
    join(claimedFixture.dataset, "build-manifest.json"),
    claimedManifest,
  );
  await assert.rejects(
    () => verify(claimedFixture),
    /policy\/config hashes are not bound/u,
  );

  const bytesFixture = await createFixture();
  await writeJson(join(bytesFixture.dataset, "split.v1.json"), {
    schemaVersion: "1",
    policyId: "tampered.split.v1",
  });
  await assert.rejects(
    () => verify(bytesFixture),
    /artifact size mismatch|artifact hash mismatch/u,
  );
});

test("rejects issuer and scenario-family leakage across splits", async () => {
  for (const track of [
    "financial_text_triage",
    "market_surveillance",
  ] as const) {
    const fixture = await createFixture();
    const provenance = await readJsonLines(
      join(fixture.dataset, "provenance.jsonl"),
    );
    const calibration = provenance.find(
      (record) => record.track === track && record.split === "calibration",
    );
    for (const record of provenance) {
      if (record.track === track && record.split === "test")
        record.isolation.key = calibration.isolation.key;
    }
    await writeCanonicalJsonLines(
      join(fixture.dataset, "provenance.jsonl"),
      provenance,
    );
    await refreshManifest(fixture.dataset);
    await assert.rejects(
      () => verify(fixture),
      /isolation key crosses splits/u,
    );
  }
});

test("rejects a split with less than a 30-day embargo", async () => {
  const fixture = await createFixture();
  const manifest = await readJson(join(fixture.dataset, "build-manifest.json"));
  manifest.split.embargoDays = 29;
  manifest.split.testStart = "2025-02-01T00:00:00.000Z";
  manifest.rebuildDigest = computeRebuildDigest(manifest);
  await writeJson(join(fixture.dataset, "build-manifest.json"), manifest);
  await assert.rejects(() => verify(fixture), /minimum 30-day embargo/u);
});

test("rejects modality-unbound lookahead probes", async () => {
  const fixture = await createFixture();
  const provenance = await readJsonLines(
    join(fixture.dataset, "provenance.jsonl"),
  );
  const probe = provenance.find(
    (record) => record.track === "visual_evidence" && record.lookahead !== null,
  );
  probe.lookahead.modality = "text";
  await writeCanonicalJsonLines(
    join(fixture.dataset, "provenance.jsonl"),
    provenance,
  );
  await refreshManifest(fixture.dataset);
  await assert.rejects(
    () => verify(fixture),
    /lookahead modality does not match track/u,
  );
});

test("rejects non-canonical JSONL and CRLF", async () => {
  const whitespaceFixture = await createFixture();
  const cases = await readJsonLines(
    join(whitespaceFixture.dataset, "cases.jsonl"),
  );
  await writeFile(
    join(whitespaceFixture.dataset, "cases.jsonl"),
    `${cases.map((entry) => JSON.stringify(entry, null, 2)).join("\n")}\n`,
  );
  await refreshManifest(whitespaceFixture.dataset);
  await assert.rejects(
    () => verify(whitespaceFixture),
    /not valid JSON|not canonical JSON/u,
  );

  const crlfFixture = await createFixture();
  const canonical = await readFile(
    join(crlfFixture.dataset, "provenance.jsonl"),
    "utf8",
  );
  await writeFile(
    join(crlfFixture.dataset, "provenance.jsonl"),
    canonical.replaceAll("\n", "\r\n"),
  );
  await refreshManifest(crlfFixture.dataset);
  await assert.rejects(() => verify(crlfFixture), /must use LF line endings/u);
});

test("rejects artifact hash and size mismatches", async () => {
  const fixture = await createFixture();
  await writeFile(join(fixture.dataset, "cases.jsonl"), "{}\n");
  await assert.rejects(
    () => verify(fixture),
    /artifact size mismatch|artifact hash mismatch/u,
  );
});

test("bounds retained visual assets before reading their bytes", async () => {
  const oversized = await createFixture();
  const oversizedManifest = await readJson(
    join(oversized.dataset, "build-manifest.json"),
  );
  oversizedManifest.artifacts.assets[0].bytes = 2 * 1024 * 1024 + 1;
  oversizedManifest.rebuildDigest = computeRebuildDigest(oversizedManifest);
  await writeJson(
    join(oversized.dataset, "build-manifest.json"),
    oversizedManifest,
  );
  await assert.rejects(
    () => verifyFinanceRetainedDatasetBundle(oversized.dataset),
    /visual artifact exceeds the per-file byte limit/u,
  );

  const aggregate = await createFixture();
  const aggregateManifest = await readJson(
    join(aggregate.dataset, "build-manifest.json"),
  );
  const sourceUses = aggregateManifest.artifacts.assets[0].sourceUses;
  aggregateManifest.artifacts.assets = Array.from(
    { length: 51 },
    (_, index) => ({
      path: `assets/bounded-${index}.svg`,
      sha256: `sha256:${index.toString(16).padStart(64, "0")}`,
      bytes: 2 * 1024 * 1024,
      sourceUses,
    }),
  ).sort((left, right) => left.path.localeCompare(right.path));
  aggregateManifest.rebuildDigest = computeRebuildDigest(aggregateManifest);
  await writeJson(
    join(aggregate.dataset, "build-manifest.json"),
    aggregateManifest,
  );
  await assert.rejects(
    () => verifyFinanceRetainedDatasetBundle(aggregate.dataset),
    /visual artifacts exceed the aggregate byte limit/u,
  );
});

test("rejects nondeterministic rebuild digests", async () => {
  const first = await createFixture();
  const second = await createFixture();
  await writeJson(join(second.dataset, "builder-config.json"), {
    schemaVersion: "1",
    fixture: true,
    rebuildVariant: "different",
  });
  const manifest = await readJson(join(second.dataset, "build-manifest.json"));
  const configBytes = await readFile(
    join(second.dataset, "builder-config.json"),
  );
  manifest.inputs.config.sha256 = sha256(configBytes);
  manifest.inputs.config.bytes = configBytes.byteLength;
  manifest.generator.configHash = sha256(configBytes);
  manifest.rebuildDigest = computeRebuildDigest(manifest);
  await writeJson(join(second.dataset, "build-manifest.json"), manifest);
  await assert.rejects(
    () =>
      verifyFinanceBuilderDirectory({
        datasetDirectory: first.dataset,
        cacheDirectory: first.cache,
        compareDatasetDirectory: second.dataset,
      }),
    /nondeterministic rebuild digest/u,
  );
});

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "jev-finance-builder-"));
  temporaryRoots.push(root);
  const dataset = join(root, "dataset");
  const cache = join(root, "cache");
  await mkdir(dataset, { recursive: true });
  for (const source of ["abides", "edgar", "xbrl"]) {
    const destination = join(cache, "sources", source, "fixture.txt");
    const extension =
      source === "edgar" ? "json" : source === "xbrl" ? "tsv" : "txt";
    const finalDestination = destination.replace(/txt$/u, extension);
    await mkdir(dirname(finalDestination), { recursive: true });
    await copyFile(
      join(fixtureRoot, "cache", "sources", source, `fixture.${extension}`),
      finalDestination,
    );
  }

  const sourceSpecs = [
    {
      id: "abides.source",
      track: "market_surveillance",
      kind: "abides_source",
      url: "https://github.com/jpmorganchase/abides-jpmc-public/archive/f9cbe51342b7dedd9587e4e069040d68a5c6477f.tar.gz",
      cachePath: "sources/abides/fixture.txt",
      mediaType: "text/plain",
      pinKind: "git_commit",
      pinValue: "f9cbe51342b7dedd9587e4e069040d68a5c6477f",
      rightsUrl:
        "https://raw.githubusercontent.com/jpmorganchase/abides-jpmc-public/f9cbe51342b7dedd9587e4e069040d68a5c6477f/LICENSE",
    },
    {
      id: "sec.edgar",
      track: "financial_text_triage",
      kind: "sec_edgar_submission",
      url: "https://www.sec.gov/Archives/edgar/daily-index/bulkdata/submissions.zip",
      cachePath: "sources/edgar/fixture.json",
      mediaType: "application/json",
      pinKind: "content_sha256",
      pinValue: "",
      rightsUrl: "https://www.sec.gov/about/privacy-information",
    },
    {
      id: "sec.xbrl",
      track: "visual_evidence",
      kind: "sec_xbrl_statement",
      url: "https://www.sec.gov/files/dera/data/financial-statement-data-sets/2024q4.zip",
      cachePath: "sources/xbrl/fixture.tsv",
      mediaType: "text/tab-separated-values",
      pinKind: "content_sha256",
      pinValue: "",
      rightsUrl: "https://www.sec.gov/about/privacy-information",
    },
  ];
  const sources = [];
  for (const source of sourceSpecs) {
    const bytes = await readFile(join(cache, source.cachePath));
    const digest = sha256(bytes);
    sources.push({
      id: source.id,
      track: source.track,
      kind: source.kind,
      url: source.url,
      pin: {
        kind: source.pinKind,
        value: source.pinKind === "content_sha256" ? digest : source.pinValue,
        sha256: digest,
        bytes: bytes.byteLength,
      },
      cachePath: source.cachePath,
      mediaType: source.mediaType,
      rights: {
        redistribution: "allowed",
        evidenceUrl: source.rightsUrl,
        statement:
          "Fixture rights are resolved by the cited primary-source policy or license.",
        reviewedAt: "2026-09-20",
      },
    });
  }
  const sourceLock = {
    schemaVersion: "1",
    lockId: "finance.public-fixture.v1",
    evidenceClass: "RETAINED_PUBLIC",
    sources,
  };
  await writeJson(join(dataset, "source-lock.json"), sourceLock);

  const textSourceHash = sources.find((source) => source.id === "sec.edgar")
    ?.pin.sha256;
  if (textSourceHash === undefined)
    throw new TypeError("fixture text source hash is missing");
  const textSourceBytes = await readFile(
    join(cache, "sources", "edgar", "fixture.json"),
  );
  const filingExcerptByteStart = textSourceBytes.indexOf(
    Buffer.from(filingExcerpt, "utf8"),
  );
  if (filingExcerptByteStart < 0)
    throw new TypeError("fixture filing excerpt is missing from its source");
  const cases = createCases(textSourceHash, filingExcerptByteStart);
  const provenance = createProvenance(cases);
  const assetDeclarations: Record<string, unknown>[] = [];
  for (const benchmarkCase of cases) {
    if (benchmarkCase.track !== "visual_evidence") continue;
    const retained = benchmarkCase.visualArtifact as {
      readonly svgPath: string;
      readonly compilerInput: unknown;
    };
    const rendered = renderFinanceChart(retained.compilerInput);
    const destination = join(dataset, retained.svgPath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, rendered.svg);
    const bytes = await readFile(destination);
    assetDeclarations.push({
      path: retained.svgPath,
      sha256: sha256(bytes),
      bytes: bytes.byteLength,
      sourceUses: [{ sourceId: "sec.xbrl", retention: "generated_output" }],
    });
  }
  await writeCanonicalJsonLines(join(dataset, "cases.jsonl"), cases);
  await writeCanonicalJsonLines(join(dataset, "provenance.jsonl"), provenance);
  await writeJson(join(dataset, "builder-config.json"), {
    schemaVersion: "1",
    fixture: true,
  });
  await writeJson(join(dataset, "labels.v1.json"), {
    schemaVersion: "1",
    policyId: "fixture.labels.v1",
  });
  await writeJson(join(dataset, "split.v1.json"), {
    schemaVersion: "1",
    policyId: "fixture.split.v1",
    minimumEmbargoDays: 30,
  });

  const sourceLockBytes = await readFile(join(dataset, "source-lock.json"));
  const caseBytes = await readFile(join(dataset, "cases.jsonl"));
  const provenanceBytes = await readFile(join(dataset, "provenance.jsonl"));
  const configBytes = await readFile(join(dataset, "builder-config.json"));
  const labelPolicyBytes = await readFile(join(dataset, "labels.v1.json"));
  const splitPolicyBytes = await readFile(join(dataset, "split.v1.json"));
  const manifest = {
    schemaVersion: "1",
    datasetId: "finance.public-fixture.v1",
    evidenceClass: "RETAINED_PUBLIC",
    sourceLockHash: sha256(sourceLockBytes),
    generator: {
      id: "jev.finance.builder",
      version: "1",
      sourceRevision: "1".repeat(40),
      configHash: sha256(configBytes),
      labelPolicyHash: sha256(labelPolicyBytes),
      splitPolicyHash: sha256(splitPolicyBytes),
    },
    split: {
      method: "forward_chaining_time_split",
      trainEnd: "2025-01-15T00:00:00.000Z",
      testStart: "2025-03-01T00:00:00.000Z",
      embargoDays: 45,
    },
    inputs: {
      config: {
        path: "builder-config.json",
        sha256: sha256(configBytes),
        bytes: configBytes.byteLength,
      },
      labelPolicy: {
        path: "labels.v1.json",
        sha256: sha256(labelPolicyBytes),
        bytes: labelPolicyBytes.byteLength,
      },
      splitPolicy: {
        path: "split.v1.json",
        sha256: sha256(splitPolicyBytes),
        bytes: splitPolicyBytes.byteLength,
      },
    },
    artifacts: {
      cases: {
        path: "cases.jsonl",
        sha256: sha256(caseBytes),
        bytes: caseBytes.byteLength,
        sourceUses: [
          { sourceId: "abides.source", retention: "generated_output" },
          { sourceId: "sec.edgar", retention: "source_excerpt" },
          { sourceId: "sec.xbrl", retention: "generated_output" },
        ],
      },
      provenance: {
        path: "provenance.jsonl",
        sha256: sha256(provenanceBytes),
        bytes: provenanceBytes.byteLength,
        sourceUses: [
          { sourceId: "abides.source", retention: "metadata_only" },
          { sourceId: "sec.edgar", retention: "metadata_only" },
          { sourceId: "sec.xbrl", retention: "metadata_only" },
        ],
      },
      assets: assetDeclarations,
    },
    rebuildDigest: hash("0"),
  };
  manifest.rebuildDigest = computeRebuildDigest(manifest as BuildManifest);
  await writeJson(join(dataset, "build-manifest.json"), manifest);
  const buildManifestHash = sha256(
    await readFile(join(dataset, "build-manifest.json")),
  );
  await writeJson(join(dataset, "dataset-manifest.json"), {
    schemaVersion: "1",
    datasetId: manifest.datasetId,
    sourceUrl: "https://example.invalid/finance-public-fixture",
    caseSetHash: sha256(caseBytes),
    buildManifestHash,
    license: "Public fixture source rights are bound in source-lock.json",
    evidenceClass: manifest.evidenceClass,
    redistributionAllowed: true,
    containsSensitiveData: false,
    splitMethod: manifest.split.method,
    trainEnd: manifest.split.trainEnd,
    testStart: manifest.split.testStart,
  });
  return { root, dataset, cache };
}

function createCases(
  textSourceHash: string,
  filingExcerptByteStart: number,
): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const track of [
    "financial_text_triage",
    "market_surveillance",
    "visual_evidence",
  ] as const) {
    records.push(
      caseRecord(
        track,
        "calibration",
        false,
        textSourceHash,
        filingExcerptByteStart,
      ),
    );
    records.push(
      caseRecord(track, "test", false, textSourceHash, filingExcerptByteStart),
    );
    records.push(
      caseRecord(track, "test", true, textSourceHash, filingExcerptByteStart),
    );
  }
  return records.sort((left, right) =>
    String(left.id).localeCompare(String(right.id)),
  );
}

function caseRecord(
  track: "financial_text_triage" | "market_surveillance" | "visual_evidence",
  split: "calibration" | "test",
  probe: boolean,
  textSourceHash: string,
  filingExcerptByteStart: number,
): Record<string, unknown> {
  const id = `${track}.${split}.${probe ? "probe" : "normal"}`;
  const date = split === "calibration" ? "2025-01-01" : "2025-03-15";
  const cutoffAt = `${date}T12:00:00.000Z`;
  const evidenceHash = sha256(`${id}:evidence`);
  const normalAsOf = `${date}T11:59:00.000Z`;
  const lateAsOf = `${date}T12:01:00.000Z`;
  const trustedProjection: Record<string, unknown> = {
    instrumentRef: "ref:fixture.instrument",
    assetClass: "equity",
    venue: "fixture.venue",
    sourceId: "fixture.source",
    sourceHash: evidenceHash,
    featureSetId: "fixture.features",
    featureSetVersion: "1",
    featureSetHash: hash("f"),
    observedAt: probe ? lateAsOf : cutoffAt,
    windowStart: `${date}T11:00:00.000Z`,
    windowEnd: `${date}T11:30:00.000Z`,
    cutoffAt,
    maxAgeMs: 3_600_000,
    signals: [
      {
        id: "fixture.signal",
        bucket: "normal",
        definitionHash: hash("d"),
        evidenceHash,
        asOf: probe ? lateAsOf : normalAsOf,
      },
    ],
  };
  let textCandidateBinding: Record<string, unknown> | undefined;
  if (track === "financial_text_triage") {
    textCandidateBinding = {
      id: "fixture.claim.1",
      excerptHash: sha256(filingExcerpt),
      claimHash: sha256(filingClaim),
      sourceSpan: {
        byteStart: filingExcerptByteStart,
        byteEnd: filingExcerptByteStart + Buffer.byteLength(filingExcerpt),
        sectionHash: textSourceHash,
      },
    };
    trustedProjection.text = {
      mode: "bounded_excerpts",
      extractorId: "fixture.extractor",
      extractorVersion: "1",
      documentHash: evidenceHash,
      sourceBindingHash: hash("b"),
      candidateBindings: [textCandidateBinding],
    };
  }
  if (track === "visual_evidence")
    trustedProjection.visual = (() => {
      const rendered = renderFinanceChart(
        visualCompilerInput(id, date, evidenceHash),
      );
      return {
        mode: "structured_extraction",
        extractorId: "fixture.extractor",
        extractorVersion: "1",
        imageHash: rendered.imageHash,
        axesVerified: true,
        sourceBindingHash: rendered.sourceBindingHash,
        schemaVersion: rendered.schemaVersion,
        renderer: rendered.renderer,
        mutationId: rendered.mutationId,
        expectedRoute: rendered.expectedRoute,
        artifactBindingHash: rendered.artifactBindingHash,
      };
    })();
  if (track === "visual_evidence") {
    const signal = (trustedProjection.signals as Record<string, unknown>[])[0];
    if (signal === undefined) throw new TypeError("fixture signal is missing");
    signal.evidenceHash = (
      trustedProjection.visual as Record<string, unknown>
    ).imageHash;
  }
  trustedProjection.projectionBindingHash =
    computeFinanceProjectionBindingHash(trustedProjection);
  const goldAtomic: Record<string, unknown>[] = [
    {
      questionId: "finance-route",
      label: "observe",
      candidateId: null,
      evidenceHash: null,
    },
    {
      questionId: "finance-anomaly",
      label: "routine",
      candidateId: null,
      evidenceHash: null,
    },
    {
      questionId: "finance-evidence-quality",
      label: "sufficient",
      candidateId: null,
      evidenceHash: null,
    },
    {
      questionId: "finance-untrusted-influence",
      label: "absent",
      candidateId: null,
      evidenceHash: null,
    },
  ];
  if (textCandidateBinding !== undefined) {
    const candidateEvidenceHash =
      financeCandidateEvidenceHash(textCandidateBinding);
    goldAtomic.push(
      {
        questionId: "finance-text-claim-cited:fixture.claim.1",
        label: "none",
        candidateId: "fixture.claim.1",
        evidenceHash: candidateEvidenceHash,
      },
      {
        questionId: "finance-text-citation:fixture.claim.1",
        label: "supports",
        candidateId: "fixture.claim.1",
        evidenceHash: candidateEvidenceHash,
      },
    );
  }
  return {
    schemaVersion: "2",
    id,
    groupId: `${track}.${split}.group`,
    track,
    split,
    goldRoute: "observe",
    goldAtomic,
    lookaheadProbe: probe,
    evaluationNow: `${date}T12:02:00.000Z`,
    ...(track === "visual_evidence"
      ? {
          visualArtifact: {
            svgPath: `assets/${id}.svg`,
            compilerInput: visualCompilerInput(id, date, evidenceHash),
          },
        }
      : {}),
    trustedProjection,
    untrustedEvidence:
      track === "financial_text_triage"
        ? { text: { excerpts: [filingExcerpt], claims: [filingClaim] } }
        : track === "visual_evidence"
          ? { visual: { annotations: [] } }
          : {},
  };
}

function visualCompilerInput(
  id: string,
  date: string,
  evidenceHash: string,
): Record<string, unknown> {
  return {
    schemaVersion: "1",
    title: `Synthetic revenue trend ${id}`,
    axis: {
      xLabel: "Date",
      yLabel: "Revenue",
      units: "USD millions",
      zeroBaseline: true,
    },
    source: {
      id: `chart.${id}`,
      title: `Synthetic XBRL fixture ${id}`,
      publisher: "SEC",
      url: "https://www.sec.gov/dera/data/financial-statement-data-sets",
      date,
      sha256: evidenceHash,
    },
    series: [
      {
        id: "revenue",
        label: "Revenue",
        points: [
          { timestamp: `${date}T09:00:00.000Z`, value: 100 },
          { timestamp: `${date}T10:00:00.000Z`, value: 110 },
        ],
      },
    ],
    mutationId: "faithful_render",
    annotations: [],
  };
}

function createProvenance(
  cases: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  return cases.map((benchmarkCase) => {
    const track = benchmarkCase.track as string;
    const split = benchmarkCase.split as string;
    const probe = benchmarkCase.lookaheadProbe as boolean;
    const projection = benchmarkCase.trustedProjection as Record<
      string,
      unknown
    >;
    const signal = (projection.signals as Record<string, unknown>[])[0];
    const modality =
      track === "market_surveillance"
        ? "market"
        : track === "financial_text_triage"
          ? "text"
          : "visual";
    const sourceId =
      track === "market_surveillance"
        ? "abides.source"
        : track === "financial_text_triage"
          ? "sec.edgar"
          : "sec.xbrl";
    const modalityHash =
      track === "market_surveillance"
        ? projection.sourceHash
        : track === "financial_text_triage"
          ? (projection.text as Record<string, unknown>).documentHash
          : (projection.visual as Record<string, unknown>).imageHash;
    const availableAt = probe
      ? "2025-03-15T12:01:00.000Z"
      : split === "calibration"
        ? "2025-01-01T11:59:00.000Z"
        : "2025-03-15T11:59:00.000Z";
    return {
      schemaVersion: "1",
      caseId: benchmarkCase.id,
      track,
      split,
      groupId: benchmarkCase.groupId,
      isolation: {
        kind: track === "market_surveillance" ? "scenario_family" : "issuer",
        key: `${track}.${split}.isolation`,
      },
      sourceIds: [sourceId],
      cutoffAt: projection.cutoffAt,
      evidence: [
        { modality, hash: modalityHash, availableAt },
        ...(probe && modalityHash !== signal.evidenceHash
          ? [{ modality, hash: signal.evidenceHash, availableAt }]
          : []),
      ],
      lookahead: probe
        ? {
            probeOf: `${track}.${split}.normal`,
            modality,
            evidenceHash: signal.evidenceHash,
            signalEvidenceHash: signal.evidenceHash,
          }
        : null,
    };
  });
}

async function refreshManifest(dataset: string): Promise<void> {
  const manifest = await readJson(join(dataset, "build-manifest.json"));
  const sourceLockBytes = await readFile(join(dataset, "source-lock.json"));
  const caseBytes = await readFile(join(dataset, "cases.jsonl"));
  const provenanceBytes = await readFile(join(dataset, "provenance.jsonl"));
  manifest.sourceLockHash = sha256(sourceLockBytes);
  manifest.artifacts.cases.sha256 = sha256(caseBytes);
  manifest.artifacts.cases.bytes = caseBytes.byteLength;
  manifest.artifacts.provenance.sha256 = sha256(provenanceBytes);
  manifest.artifacts.provenance.bytes = provenanceBytes.byteLength;
  manifest.rebuildDigest = computeRebuildDigest(manifest);
  await writeJson(join(dataset, "build-manifest.json"), manifest);
}

// biome-ignore lint/suspicious/noExplicitAny: mutation tests intentionally exercise malformed case objects.
function resealBenchmarkCase(benchmarkCase: any): void {
  const { projectionBindingHash: _ignored, ...projection } =
    benchmarkCase.trustedProjection;
  benchmarkCase.trustedProjection.projectionBindingHash =
    computeFinanceProjectionBindingHash(projection);
}

async function verify(fixture: Fixture): Promise<unknown> {
  return verifyFinanceBuilderDirectory({
    datasetDirectory: fixture.dataset,
    cacheDirectory: fixture.cache,
  });
}

// biome-ignore lint/suspicious/noExplicitAny: mutation tests intentionally exercise malformed nested JSON.
async function readJson(path: string): Promise<any> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

// biome-ignore lint/suspicious/noExplicitAny: mutation tests intentionally exercise malformed nested JSONL.
async function readJsonLines(path: string): Promise<any[]> {
  const text = await readFile(path, "utf8");
  return text
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
}

async function writeCanonicalJsonLines(
  path: string,
  values: readonly unknown[],
): Promise<void> {
  await writeFile(
    path,
    `${values.map((value) => canonicalJson(value)).join("\n")}\n`,
  );
}

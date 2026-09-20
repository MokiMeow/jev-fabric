import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020Module, { type ValidateFunction } from "ajv/dist/2020.js";
import {
  FINANCE_CHART_RENDERER,
  FINANCE_VISUAL_MUTATION_ROUTES,
  renderFinanceChart,
} from "../visual/render.mjs";
import {
  assertCanonicalHttpsUrl,
  assertExactKeys,
  assertSafeRelativePath,
  assertSha256,
  canonicalJson,
  isRecord,
  parseCanonicalJsonLines,
  readSafeRelativeFile,
  sha256,
} from "./canonical.mjs";

const tracks = [
  "market_surveillance",
  "financial_text_triage",
  "visual_evidence",
] as const;
const splits = ["calibration", "test"] as const;
const dayMs = 24 * 60 * 60 * 1000;
const maximumSources = 10_000;
const financeBaseQuestionIds = [
  "finance-route",
  "finance-anomaly",
  "finance-evidence-quality",
  "finance-untrusted-influence",
] as const;
const financeClaimQuestionPrefix = "finance-text-claim:";
const financeCitedClaimQuestionPrefix = "finance-text-claim-cited:";
const financeCitationQuestionPrefix = "finance-text-citation:";
const financeClaimLabels = [
  "performance_change",
  "guidance_or_outlook_change",
  "liquidity_or_going_concern",
  "accounting_or_control_issue",
  "legal_or_regulatory_contingency",
  "none",
] as const;
const canonicalFinanceSchemaRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "schema",
);
let financeCaseValidator: Promise<ValidateFunction> | undefined;
const Ajv2020 = Ajv2020Module as unknown as new (options: {
  readonly allErrors: boolean;
  readonly strict: boolean;
  readonly validateFormats: boolean;
}) => {
  compile(schema: object): ValidateFunction;
};

type Track = (typeof tracks)[number];
type Split = (typeof splits)[number];
type IsolationKind = "issuer" | "scenario_family";
type Modality = "market" | "text" | "visual";

interface SourceLockSource {
  readonly id: string;
  readonly track: Track;
  readonly kind:
    | "sec_edgar_submission"
    | "sec_xbrl_statement"
    | "abides_source";
  readonly url: string;
  readonly pin: {
    readonly kind: "content_sha256" | "git_commit";
    readonly value: string;
    readonly sha256: string;
    readonly bytes: number;
  };
  readonly cachePath: string;
  readonly mediaType: string;
  readonly rights: {
    readonly redistribution:
      | "allowed"
      | "generated_output_only"
      | "unresolved"
      | "forbidden";
    readonly evidenceUrl: string;
    readonly statement: string;
    readonly reviewedAt: string;
  };
}

interface SourceLock {
  readonly schemaVersion: "1";
  readonly lockId: string;
  readonly evidenceClass: "SYNTHETIC" | "LOCAL_EXPLORATORY" | "RETAINED_PUBLIC";
  readonly sources: readonly SourceLockSource[];
}

interface ArtifactDeclaration {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly sourceUses: readonly SourceUse[];
}

interface InputDeclaration {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

interface SourceUse {
  readonly sourceId: string;
  readonly retention:
    | "metadata_only"
    | "generated_output"
    | "source_excerpt"
    | "raw_source";
}

export interface BuildManifest {
  readonly schemaVersion: "1";
  readonly datasetId: string;
  readonly evidenceClass: SourceLock["evidenceClass"];
  readonly sourceLockHash: string;
  readonly generator: {
    readonly id: string;
    readonly version: string;
    readonly sourceRevision: string;
    readonly configHash: string;
    readonly labelPolicyHash: string;
    readonly splitPolicyHash: string;
  };
  readonly split: {
    readonly method: "forward_chaining_time_split";
    readonly trainEnd: string;
    readonly testStart: string;
    readonly embargoDays: number;
  };
  readonly inputs: {
    readonly config: InputDeclaration;
    readonly labelPolicy: InputDeclaration;
    readonly splitPolicy: InputDeclaration;
  };
  readonly artifacts: {
    readonly cases: ArtifactDeclaration;
    readonly provenance: ArtifactDeclaration;
    readonly assets: readonly ArtifactDeclaration[];
  };
  readonly rebuildDigest: string;
}

interface EvidenceProvenance {
  readonly modality: Modality;
  readonly hash: string;
  readonly availableAt: string;
}

interface LookaheadBinding {
  readonly probeOf: string;
  readonly modality: Modality;
  readonly evidenceHash: string;
  readonly signalEvidenceHash: string;
}

interface CaseProvenance {
  readonly schemaVersion: "1";
  readonly caseId: string;
  readonly track: Track;
  readonly split: Split;
  readonly groupId: string;
  readonly isolation: {
    readonly kind: IsolationKind;
    readonly key: string;
  };
  readonly sourceIds: readonly string[];
  readonly cutoffAt: string;
  readonly evidence: readonly EvidenceProvenance[];
  readonly lookahead: LookaheadBinding | null;
}

export interface VerifyFinanceBuilderOptions {
  readonly datasetDirectory: string;
  readonly cacheDirectory: string;
  readonly compareDatasetDirectory?: string;
}

export interface FinanceBuilderVerification {
  readonly datasetId: string;
  readonly caseCount: number;
  readonly sourceCount: number;
  readonly rebuildDigest: string;
}

export async function verifyFinanceBuilderDirectory(
  options: VerifyFinanceBuilderOptions,
): Promise<FinanceBuilderVerification> {
  const verified = await verifyOne(
    options.datasetDirectory,
    options.cacheDirectory,
  );
  if (options.compareDatasetDirectory !== undefined) {
    const comparison = await verifyOne(
      options.compareDatasetDirectory,
      options.cacheDirectory,
    );
    if (comparison.rebuildDigest !== verified.rebuildDigest)
      throw new TypeError(
        `nondeterministic rebuild digest: ${verified.rebuildDigest} != ${comparison.rebuildDigest}`,
      );
  }
  return verified;
}

async function verifyOne(
  datasetDirectory: string,
  cacheDirectory: string,
): Promise<FinanceBuilderVerification> {
  const [sourceLockBytes, manifestBytes] = await Promise.all([
    readSafeRelativeFile(datasetDirectory, "source-lock.json", 2 * 1024 * 1024),
    readSafeRelativeFile(
      datasetDirectory,
      "build-manifest.json",
      2 * 1024 * 1024,
    ),
  ]);
  const sourceLock = parseSourceLock(
    parseJsonObject(sourceLockBytes, "source-lock.json"),
  );
  const manifest = parseBuildManifest(
    parseJsonObject(manifestBytes, "build-manifest.json"),
  );

  if (manifest.evidenceClass !== sourceLock.evidenceClass)
    throw new TypeError(
      "build manifest evidenceClass does not match source lock",
    );
  if (manifest.sourceLockHash !== sha256(sourceLockBytes))
    throw new TypeError("sourceLockHash does not match source-lock.json bytes");

  const sourceBytes = await verifySources(sourceLock, cacheDirectory);
  const artifactBytes = await verifyArtifactsAndInputs(
    manifest,
    datasetDirectory,
    sourceLock,
  );
  verifyEmbargo(manifest);

  const cases = parseCanonicalJsonLines(artifactBytes.cases, "cases.jsonl");
  await validateCanonicalFinanceCases(cases);
  const provenanceRecords = parseCanonicalJsonLines(
    artifactBytes.provenance,
    "provenance.jsonl",
  ).map(parseCaseProvenance);
  verifyCasesAndProvenance(
    cases,
    provenanceRecords,
    sourceLock,
    manifest,
    artifactBytes.assets,
    sourceBytes,
  );
  verifyArtifactRetention(cases, provenanceRecords, sourceLock, manifest);

  const expectedDigest = computeRebuildDigest(manifest);
  if (manifest.rebuildDigest !== expectedDigest)
    throw new TypeError(
      "rebuildDigest does not match the deterministic build inputs",
    );

  return {
    datasetId: manifest.datasetId,
    caseCount: cases.length,
    sourceCount: sourceLock.sources.length,
    rebuildDigest: expectedDigest,
  };
}

async function validateCanonicalFinanceCases(
  cases: readonly Record<string, unknown>[],
): Promise<void> {
  financeCaseValidator ??= loadCanonicalFinanceCaseValidator();
  const validate = await financeCaseValidator;
  for (const benchmarkCase of cases) {
    if (validate(benchmarkCase)) continue;
    const detail = (validate.errors ?? [])
      .map((error) => `${error.instancePath || "/"} ${error.message}`)
      .join("; ");
    throw new TypeError(
      `finance builder case does not match the canonical case schema: ${detail}`,
    );
  }
}

async function loadCanonicalFinanceCaseValidator(): Promise<ValidateFunction> {
  const schemaBytes = await readSafeRelativeFile(
    canonicalFinanceSchemaRoot,
    "case.schema.jsonc",
    1024 * 1024,
  );
  let schema: unknown;
  try {
    schema = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(schemaBytes),
    );
  } catch (error) {
    throw new TypeError(
      "canonical finance case schema is not valid UTF-8 JSON",
      {
        cause: error,
      },
    );
  }
  if (!isRecord(schema))
    throw new TypeError("canonical finance case schema must be a JSON object");
  return new Ajv2020({
    allErrors: true,
    strict: true,
    validateFormats: false,
  }).compile(schema);
}

export function computeRebuildDigest(manifest: BuildManifest): string {
  return sha256(
    canonicalJson({
      schemaVersion: manifest.schemaVersion,
      datasetId: manifest.datasetId,
      evidenceClass: manifest.evidenceClass,
      sourceLockHash: manifest.sourceLockHash,
      generator: manifest.generator,
      split: manifest.split,
      inputs: manifest.inputs,
      artifacts: manifest.artifacts,
    }),
  );
}

async function verifySources(
  sourceLock: SourceLock,
  cacheDirectory: string,
): Promise<ReadonlyMap<string, Uint8Array>> {
  const ids = new Set<string>();
  const hashes = new Set<string>();
  const coveredTracks = new Set<Track>();
  const sourceBytes = new Map<string, Uint8Array>();
  for (const source of sourceLock.sources) {
    if (ids.has(source.id))
      throw new TypeError(`duplicate source id: ${source.id}`);
    if (hashes.has(source.pin.sha256))
      throw new TypeError(`duplicate source hash: ${source.pin.sha256}`);
    ids.add(source.id);
    hashes.add(source.pin.sha256);
    coveredTracks.add(source.track);

    if (
      sourceLock.evidenceClass === "RETAINED_PUBLIC" &&
      (source.rights.redistribution === "unresolved" ||
        source.rights.redistribution === "forbidden")
    )
      throw new TypeError(
        `unresolved retained-public rights for source: ${source.id}`,
      );

    const bytes = await readSafeRelativeFile(
      cacheDirectory,
      source.cachePath,
      512 * 1024 * 1024,
    );
    if (bytes.byteLength !== source.pin.bytes)
      throw new TypeError(`source size mismatch: ${source.id}`);
    if (sha256(bytes) !== source.pin.sha256)
      throw new TypeError(`source hash mismatch: ${source.id}`);
    sourceBytes.set(source.id, bytes);
  }
  for (const track of tracks) {
    if (!coveredTracks.has(track))
      throw new TypeError(`source lock does not cover ${track}`);
  }
  return sourceBytes;
}

async function verifyArtifactsAndInputs(
  manifest: BuildManifest,
  datasetDirectory: string,
  sourceLock: SourceLock,
): Promise<{
  readonly cases: Uint8Array;
  readonly provenance: Uint8Array;
  readonly assets: ReadonlyMap<string, Uint8Array>;
}> {
  const artifacts = [
    manifest.artifacts.cases,
    manifest.artifacts.provenance,
    ...manifest.artifacts.assets,
  ];
  const inputs = [
    manifest.inputs.config,
    manifest.inputs.labelPolicy,
    manifest.inputs.splitPolicy,
  ];
  const paths = new Set<string>();
  const hashes = new Set<string>();
  let cases: Uint8Array | undefined;
  let provenance: Uint8Array | undefined;
  const assetDeclarations = new Set<ArtifactDeclaration>(
    manifest.artifacts.assets,
  );
  const assetBytes = new Map<string, Uint8Array>();
  for (const declaration of [...inputs, ...artifacts]) {
    if (paths.has(declaration.path))
      throw new TypeError(`duplicate artifact path: ${declaration.path}`);
    if (hashes.has(declaration.sha256))
      throw new TypeError(`duplicate artifact hash: ${declaration.sha256}`);
    paths.add(declaration.path);
    hashes.add(declaration.sha256);
    const bytes = await readSafeRelativeFile(
      datasetDirectory,
      declaration.path,
      100 * 1024 * 1024,
    );
    if (bytes.byteLength !== declaration.bytes)
      throw new TypeError(`artifact size mismatch: ${declaration.path}`);
    if (sha256(bytes) !== declaration.sha256)
      throw new TypeError(`artifact hash mismatch: ${declaration.path}`);
    if (declaration === manifest.artifacts.cases) cases = bytes;
    if (declaration === manifest.artifacts.provenance) provenance = bytes;
    if (assetDeclarations.has(declaration))
      assetBytes.set(declaration.path, bytes);
  }
  if (
    manifest.generator.configHash !== manifest.inputs.config.sha256 ||
    manifest.generator.labelPolicyHash !== manifest.inputs.labelPolicy.sha256 ||
    manifest.generator.splitPolicyHash !== manifest.inputs.splitPolicy.sha256
  )
    throw new TypeError(
      "generator policy/config hashes are not bound to retained input bytes",
    );

  const sources = new Map(
    sourceLock.sources.map((source) => [source.id, source]),
  );
  for (const artifact of artifacts) {
    for (const use of artifact.sourceUses) {
      const source = sources.get(use.sourceId);
      if (source === undefined)
        throw new TypeError(
          `artifact ${artifact.path} references unknown source: ${use.sourceId}`,
        );
    }
  }
  if (cases === undefined || provenance === undefined)
    throw new TypeError("required builder artifacts were not verified");
  return { cases, provenance, assets: assetBytes };
}

function verifyEmbargo(manifest: BuildManifest): void {
  const trainEnd = parseTimestamp(manifest.split.trainEnd, "split.trainEnd");
  const testStart = parseTimestamp(manifest.split.testStart, "split.testStart");
  if (
    manifest.split.embargoDays < 30 ||
    testStart - trainEnd < manifest.split.embargoDays * dayMs
  )
    throw new TypeError("forward split requires a minimum 30-day embargo");
}

function verifyArtifactRetention(
  cases: readonly Record<string, unknown>[],
  provenance: readonly CaseProvenance[],
  sourceLock: SourceLock,
  manifest: BuildManifest,
): void {
  const expectedCaseUses = new Map<string, SourceUse["retention"]>();
  const referencedSources = new Set<string>();
  const sourceById = new Map(
    sourceLock.sources.map((source) => [source.id, source]),
  );
  const casesById = new Map(
    cases.map((benchmarkCase) => [
      requiredString(benchmarkCase.id, "case.id"),
      benchmarkCase,
    ]),
  );
  for (const record of provenance) {
    const benchmarkCase = casesById.get(record.caseId);
    if (benchmarkCase === undefined)
      throw new TypeError(`missing case for retention proof: ${record.caseId}`);
    const retention = expectedCaseRetention(record.track, benchmarkCase);
    for (const sourceId of record.sourceIds) {
      referencedSources.add(sourceId);
      const previous = expectedCaseUses.get(sourceId);
      if (previous !== undefined && previous !== retention) {
        if (previous === "source_excerpt" || retention === "source_excerpt")
          expectedCaseUses.set(sourceId, "source_excerpt");
        else if (
          previous === "generated_output" ||
          retention === "generated_output"
        )
          expectedCaseUses.set(sourceId, "generated_output");
      } else {
        expectedCaseUses.set(sourceId, retention);
      }
    }
  }

  assertSourceUsesEqual(
    manifest.artifacts.cases.sourceUses,
    expectedCaseUses,
    "cases.jsonl",
  );
  assertSourceUsesEqual(
    manifest.artifacts.provenance.sourceUses,
    new Map(
      [...referencedSources]
        .sort()
        .map((sourceId) => [sourceId, "metadata_only" as const]),
    ),
    "provenance.jsonl",
  );

  const declaredSourceUses = new Set<string>();
  for (const artifact of [
    manifest.artifacts.cases,
    manifest.artifacts.provenance,
    ...manifest.artifacts.assets,
  ]) {
    for (const use of artifact.sourceUses) {
      declaredSourceUses.add(use.sourceId);
      const source = sourceById.get(use.sourceId);
      if (
        sourceLock.evidenceClass === "RETAINED_PUBLIC" &&
        source?.rights.redistribution === "generated_output_only" &&
        use.retention !== "metadata_only" &&
        use.retention !== "generated_output"
      )
        throw new TypeError(
          `generated-output-only source is retained as ${use.retention}: ${source.id}`,
        );
    }
  }
  for (const source of sourceLock.sources) {
    if (!declaredSourceUses.has(source.id))
      throw new TypeError(`source lock contains unused source: ${source.id}`);
  }
}

function expectedCaseRetention(
  track: Track,
  benchmarkCase: Record<string, unknown>,
): SourceUse["retention"] {
  if (track === "market_surveillance" || track === "visual_evidence")
    return "generated_output";
  const untrustedEvidence = benchmarkCase.untrustedEvidence;
  if (!isRecord(untrustedEvidence)) return "metadata_only";
  const text = untrustedEvidence.text;
  if (!isRecord(text)) return "metadata_only";
  const excerpts = text.excerpts;
  if (!Array.isArray(excerpts) || excerpts.length === 0) return "metadata_only";
  if (excerpts.some((excerpt) => typeof excerpt !== "string"))
    throw new TypeError("financial text excerpts must be strings");
  return "source_excerpt";
}

function assertSourceUsesEqual(
  actual: readonly SourceUse[],
  expected: ReadonlyMap<string, SourceUse["retention"]>,
  artifact: string,
): void {
  if (actual.length !== expected.size)
    throw new TypeError(
      `${artifact} source-use coverage does not match provenance`,
    );
  for (const use of actual) {
    if (expected.get(use.sourceId) !== use.retention)
      throw new TypeError(
        `${artifact} retention for ${use.sourceId} does not match retained content`,
      );
  }
}

function verifyCasesAndProvenance(
  caseRecords: readonly Record<string, unknown>[],
  provenanceRecords: readonly CaseProvenance[],
  sourceLock: SourceLock,
  manifest: BuildManifest,
  assetBytes: ReadonlyMap<string, Uint8Array>,
  sourceBytes: ReadonlyMap<string, Uint8Array>,
): void {
  if (caseRecords.length !== provenanceRecords.length)
    throw new TypeError("cases and provenance must have one-to-one coverage");
  const cases = new Map<string, Record<string, unknown>>();
  const provenance = new Map<string, CaseProvenance>();
  const groupSplits = new Map<string, Split>();
  const isolationSplits = new Map<string, Split>();
  const sourceTracks = new Map(
    sourceLock.sources.map((source) => [source.id, source.track]),
  );
  const coverage = new Set<string>();
  const visualAssetPaths = new Set<string>();

  assertSortedUnique(
    caseRecords.map((record) => requiredString(record.id, "case.id")),
    "cases.jsonl case ids",
  );
  assertSortedUnique(
    provenanceRecords.map((record) => record.caseId),
    "provenance.jsonl case ids",
  );

  for (const record of caseRecords) {
    const id = requiredString(record.id, "case.id");
    if (cases.has(id)) throw new TypeError(`duplicate case id: ${id}`);
    cases.set(id, record);
  }

  for (const record of provenanceRecords) {
    if (provenance.has(record.caseId))
      throw new TypeError(`duplicate provenance case id: ${record.caseId}`);
    provenance.set(record.caseId, record);
    const benchmarkCase = cases.get(record.caseId);
    if (benchmarkCase === undefined)
      throw new TypeError(
        `provenance references missing case: ${record.caseId}`,
      );

    const caseTrack = enumValue(benchmarkCase.track, tracks, "case.track");
    const caseSplit = enumValue(benchmarkCase.split, splits, "case.split");
    const groupId = requiredString(benchmarkCase.groupId, "case.groupId");
    const lookaheadProbe = requiredBoolean(
      benchmarkCase.lookaheadProbe,
      "case.lookaheadProbe",
    );
    if (
      record.track !== caseTrack ||
      record.split !== caseSplit ||
      record.groupId !== groupId
    )
      throw new TypeError(
        `case/provenance identity mismatch: ${record.caseId}`,
      );

    const previousGroupSplit = groupSplits.get(groupId);
    if (previousGroupSplit !== undefined && previousGroupSplit !== caseSplit)
      throw new TypeError(`group crosses splits: ${groupId}`);
    groupSplits.set(groupId, caseSplit);

    const expectedIsolationKind: IsolationKind =
      caseTrack === "market_surveillance" ? "scenario_family" : "issuer";
    if (record.isolation.kind !== expectedIsolationKind)
      throw new TypeError(`wrong isolation kind for ${record.caseId}`);
    const isolationId = `${record.isolation.kind}:${record.isolation.key}`;
    const previousIsolationSplit = isolationSplits.get(isolationId);
    if (
      previousIsolationSplit !== undefined &&
      previousIsolationSplit !== caseSplit
    )
      throw new TypeError(`isolation key crosses splits: ${isolationId}`);
    isolationSplits.set(isolationId, caseSplit);

    for (const sourceId of record.sourceIds) {
      if (sourceTracks.get(sourceId) !== caseTrack)
        throw new TypeError(`source ${sourceId} does not cover ${caseTrack}`);
    }

    const trustedProjection = requiredRecord(
      benchmarkCase.trustedProjection,
      "case.trustedProjection",
    );
    const textBindings =
      caseTrack === "financial_text_triage"
        ? verifyTextCandidateBindings(
            benchmarkCase,
            trustedProjection,
            record.caseId,
            record.sourceIds,
            sourceLock,
            sourceBytes,
          )
        : [];
    verifyAtomicGold(benchmarkCase, textBindings, record.caseId);
    if (caseTrack === "visual_evidence")
      verifyVisualArtifactBinding(
        benchmarkCase,
        trustedProjection,
        record.caseId,
        assetBytes,
        visualAssetPaths,
      );
    else if (benchmarkCase.visualArtifact !== undefined)
      throw new TypeError(
        `non-visual case has a visual artifact: ${record.caseId}`,
      );
    const cutoffAt = requiredString(
      trustedProjection.cutoffAt,
      "trustedProjection.cutoffAt",
    );
    if (record.cutoffAt !== cutoffAt)
      throw new TypeError(`cutoff mismatch for ${record.caseId}`);
    const cutoff = parseTimestamp(cutoffAt, "case cutoffAt");
    const signals = requiredArray(
      trustedProjection.signals,
      "trustedProjection.signals",
    ).map((signal, index) => requiredRecord(signal, `signal ${index}`));
    if (signals.length === 0)
      throw new TypeError(`case has no trusted signals: ${record.caseId}`);
    const expectedModality = modalityForTrack(caseTrack);
    const modalityHash = projectionModalityHash(
      expectedModality,
      trustedProjection,
    );
    if (
      record.evidence.some((entry) => entry.modality !== expectedModality) ||
      !record.evidence.some((entry) => entry.hash === modalityHash)
    )
      throw new TypeError(
        `case evidence is not bound to its modality projection: ${record.caseId}`,
      );

    if (lookaheadProbe) {
      verifyLookaheadBinding(
        record,
        benchmarkCase,
        trustedProjection,
        signals,
        cutoff,
      );
      coverage.add(`${caseTrack}:probe`);
    } else {
      if (record.lookahead !== null)
        throw new TypeError(
          `non-probe case has a lookahead binding: ${record.caseId}`,
        );
      if (
        record.evidence.some(
          (evidence) =>
            parseTimestamp(evidence.availableAt, "evidence.availableAt") >
            cutoff,
        ) ||
        signals.some(
          (signal) =>
            parseTimestamp(
              requiredString(signal.asOf, "signal.asOf"),
              "signal.asOf",
            ) > cutoff,
        )
      )
        throw new TypeError(
          `normal case contains post-cutoff evidence: ${record.caseId}`,
        );
      coverage.add(`${caseTrack}:${caseSplit}:normal`);
    }
  }

  for (const record of provenanceRecords) {
    if (record.lookahead === null) continue;
    const baseCase = cases.get(record.lookahead.probeOf);
    const baseProvenance = provenance.get(record.lookahead.probeOf);
    if (baseCase === undefined || baseProvenance === undefined)
      throw new TypeError(
        `lookahead probeOf is missing: ${record.lookahead.probeOf}`,
      );
    if (
      requiredBoolean(baseCase.lookaheadProbe, "base lookaheadProbe") ||
      baseProvenance.lookahead !== null ||
      baseProvenance.track !== record.track ||
      baseProvenance.split !== record.split ||
      baseProvenance.groupId !== record.groupId ||
      canonicalJson(baseProvenance.isolation) !==
        canonicalJson(record.isolation)
    )
      throw new TypeError(
        `lookahead probe is not paired to its normal case: ${record.caseId}`,
      );
  }

  for (const track of tracks) {
    for (const split of splits) {
      if (!coverage.has(`${track}:${split}:normal`))
        throw new TypeError(`missing normal ${split} coverage for ${track}`);
    }
    if (!coverage.has(`${track}:probe`))
      throw new TypeError(
        `missing modality-bound lookahead probe for ${track}`,
      );
  }

  if (visualAssetPaths.size !== assetBytes.size)
    throw new TypeError(
      "retained visual assets must have one-to-one visual case coverage",
    );
  for (const path of assetBytes.keys()) {
    if (!visualAssetPaths.has(path))
      throw new TypeError(
        `retained asset is not bound to a visual case: ${path}`,
      );
  }

  const trainEnd = parseTimestamp(manifest.split.trainEnd, "split.trainEnd");
  const testStart = parseTimestamp(manifest.split.testStart, "split.testStart");
  for (const record of provenanceRecords) {
    const cutoff = parseTimestamp(record.cutoffAt, "provenance.cutoffAt");
    if (record.split === "calibration" && cutoff > trainEnd)
      throw new TypeError(
        `calibration case is after trainEnd: ${record.caseId}`,
      );
    if (record.split === "test" && cutoff < testStart)
      throw new TypeError(`test case is before testStart: ${record.caseId}`);
  }
}

function verifyTextCandidateBindings(
  benchmarkCase: Record<string, unknown>,
  trustedProjection: Record<string, unknown>,
  caseId: string,
  sourceIds: readonly string[],
  sourceLock: SourceLock,
  sourceBytes: ReadonlyMap<string, Uint8Array>,
): readonly Record<string, unknown>[] {
  const text = requiredRecord(trustedProjection.text, "trustedProjection.text");
  const bindings = requiredArray(
    text.candidateBindings,
    "trustedProjection.text.candidateBindings",
  ).map((value, index) =>
    requiredRecord(value, `trustedProjection.text.candidateBindings[${index}]`),
  );
  const untrusted = requiredRecord(
    benchmarkCase.untrustedEvidence,
    "case.untrustedEvidence",
  );
  const untrustedText = requiredRecord(
    untrusted.text,
    "case.untrustedEvidence.text",
  );
  const excerpts = requiredArray(
    untrustedText.excerpts,
    "case.untrustedEvidence.text.excerpts",
  );
  const claims =
    untrustedText.claims === undefined
      ? undefined
      : requiredArray(
          untrustedText.claims,
          "case.untrustedEvidence.text.claims",
        );
  if (bindings.length !== excerpts.length)
    throw new TypeError(`text candidate count mismatch for ${caseId}`);
  if (claims !== undefined && claims.length !== bindings.length)
    throw new TypeError(`text claim count mismatch for ${caseId}`);
  const hasClaimBindings = bindings.map(
    (binding) => binding.claimHash !== undefined,
  );
  if (hasClaimBindings.some(Boolean) && !hasClaimBindings.every(Boolean))
    throw new TypeError(`text claim bindings are incomplete for ${caseId}`);
  if (hasClaimBindings.every(Boolean) !== (claims !== undefined))
    throw new TypeError(`text claims and bindings mismatch for ${caseId}`);
  const sourcesByHash = new Map<string, Uint8Array>();
  const sourceById = new Map(
    sourceLock.sources.map((source) => [source.id, source]),
  );
  for (const sourceId of sourceIds) {
    const source = sourceById.get(sourceId);
    const bytes = sourceBytes.get(sourceId);
    if (source === undefined || bytes === undefined)
      throw new TypeError(`text source is unavailable for ${caseId}`);
    sourcesByHash.set(source.pin.sha256, bytes);
  }
  const ids = new Set<string>();
  let excerptBytes = 0;
  let claimBytes = 0;
  for (const [index, binding] of bindings.entries()) {
    const id = requiredString(binding.id, `text candidate ${index}.id`);
    const excerptHash = requiredString(
      binding.excerptHash,
      `text candidate ${index}.excerptHash`,
    );
    const excerpt = excerpts[index];
    if (ids.has(id)) throw new TypeError(`duplicate text candidate id: ${id}`);
    ids.add(id);
    if (
      typeof excerpt !== "string" ||
      excerpt.length < 1 ||
      excerpt.length > 1_000 ||
      hasControlCharacter(excerpt) ||
      excerptHash !== sha256(excerpt)
    )
      throw new TypeError(`text candidate hash mismatch for ${caseId}: ${id}`);
    excerptBytes += Buffer.byteLength(excerpt, "utf8");
    const claim = claims?.[index];
    const claimHash = binding.claimHash;
    const sourceSpanValue = binding.sourceSpan;
    if ((claimHash === undefined) !== (sourceSpanValue === undefined))
      throw new TypeError(
        `text claim and source span must be supplied together for ${caseId}: ${id}`,
      );
    if (
      claimHash !== undefined &&
      (typeof claim !== "string" ||
        claim.length < 1 ||
        claim.length > 1_000 ||
        hasControlCharacter(claim) ||
        claimHash !== sha256(claim))
    )
      throw new TypeError(`text claim hash mismatch for ${caseId}: ${id}`);
    if (typeof claim === "string")
      claimBytes += Buffer.byteLength(claim, "utf8");
    if (sourceSpanValue !== undefined) {
      const sourceSpan = requiredRecord(
        sourceSpanValue,
        `text candidate ${index}.sourceSpan`,
      );
      assertExactKeys(
        sourceSpan,
        ["byteStart", "byteEnd", "sectionHash"],
        [],
        `text candidate ${index}.sourceSpan`,
      );
      const byteStart = sourceSpan.byteStart;
      const byteEnd = sourceSpan.byteEnd;
      const sectionHash = digest(
        sourceSpan.sectionHash,
        `text candidate ${index}.sourceSpan.sectionHash`,
      );
      const source = sourcesByHash.get(sectionHash);
      if (
        claimHash === undefined ||
        typeof byteStart !== "number" ||
        !Number.isSafeInteger(byteStart) ||
        byteStart < 0 ||
        typeof byteEnd !== "number" ||
        !Number.isSafeInteger(byteEnd) ||
        byteEnd <= byteStart ||
        source === undefined ||
        byteEnd > source.byteLength
      )
        throw new TypeError(`text source span mismatch for ${caseId}: ${id}`);
      let retainedExcerpt: string;
      try {
        retainedExcerpt = new TextDecoder("utf-8", { fatal: true }).decode(
          source.subarray(byteStart, byteEnd),
        );
      } catch (error) {
        throw new TypeError(
          `text source span is not valid UTF-8 for ${caseId}: ${id}`,
          { cause: error },
        );
      }
      if (retainedExcerpt !== excerpt)
        throw new TypeError(`text source span mismatch for ${caseId}: ${id}`);
    }
  }
  if (excerptBytes > 16_384)
    throw new TypeError(`text excerpts exceed the byte limit for ${caseId}`);
  if (claimBytes > 8_192)
    throw new TypeError(`text claims exceed the byte limit for ${caseId}`);
  return bindings;
}

function verifyAtomicGold(
  benchmarkCase: Record<string, unknown>,
  candidateBindings: readonly Record<string, unknown>[],
  caseId: string,
): void {
  const gold = requiredArray(
    benchmarkCase.goldAtomic,
    `case ${caseId}.goldAtomic`,
  ).map((value, index) =>
    requiredRecord(value, `case ${caseId}.goldAtomic[${index}]`),
  );
  const expected: Array<{
    questionId: string;
    candidateId: string | null;
    evidenceHash: string | null;
  }> = financeBaseQuestionIds.map((questionId) => ({
    questionId,
    candidateId: null,
    evidenceHash: null,
  }));
  for (const binding of candidateBindings) {
    const candidateId = requiredString(binding.id, "text candidate id");
    const cited = binding.claimHash !== undefined;
    expected.push({
      questionId: `${cited ? financeCitedClaimQuestionPrefix : financeClaimQuestionPrefix}${candidateId}`,
      candidateId,
      evidenceHash: financeCandidateEvidenceHash(binding),
    });
  }
  for (const binding of candidateBindings) {
    if (binding.claimHash === undefined) continue;
    const candidateId = requiredString(binding.id, "text candidate id");
    expected.push({
      questionId: `${financeCitationQuestionPrefix}${candidateId}`,
      candidateId,
      evidenceHash: financeCandidateEvidenceHash(binding),
    });
  }
  if (gold.length !== expected.length)
    throw new TypeError(`atomic gold coverage is incomplete for ${caseId}`);
  const labels = new Map<string, string>();
  for (const [index, item] of gold.entries()) {
    assertExactKeys(
      item,
      ["questionId", "label", "candidateId", "evidenceHash"],
      [],
      `case ${caseId}.goldAtomic[${index}]`,
    );
    const expectedItem = expected[index];
    if (expectedItem === undefined)
      throw new TypeError(`atomic gold coverage is invalid for ${caseId}`);
    const questionId = requiredString(
      item.questionId,
      `case ${caseId}.goldAtomic[${index}].questionId`,
    );
    const label = requiredString(
      item.label,
      `case ${caseId}.goldAtomic[${index}].label`,
    );
    if (
      questionId !== expectedItem.questionId ||
      item.candidateId !== expectedItem.candidateId ||
      item.evidenceHash !== expectedItem.evidenceHash ||
      !atomicOptions(questionId).includes(label)
    )
      throw new TypeError(`atomic gold binding mismatch for ${caseId}`);
    if (labels.has(questionId))
      throw new TypeError(`duplicate atomic gold question for ${caseId}`);
    labels.set(questionId, label);
  }
  const dynamic = gold.filter((item) =>
    requiredString(item.questionId, "atomic question id").startsWith(
      "finance-text-",
    ),
  );
  const escalates =
    labels.get("finance-untrusted-influence") === "present" ||
    labels.get("finance-anomaly") === "concerning" ||
    labels.get("finance-evidence-quality") === "insufficient" ||
    labels.get("finance-route") === "escalate" ||
    dynamic.some(
      (item) =>
        String(item.questionId).startsWith(financeCitationQuestionPrefix) &&
        item.label === "contradicts",
    );
  const investigates =
    labels.get("finance-anomaly") === "unclear" ||
    labels.get("finance-evidence-quality") === "conflicted" ||
    labels.get("finance-route") === "investigate" ||
    dynamic.some((item) =>
      String(item.questionId).startsWith(financeCitationQuestionPrefix)
        ? item.label === "insufficient_context"
        : item.label !== "none",
    );
  const composedRoute = escalates
    ? "escalate"
    : investigates
      ? "investigate"
      : "observe";
  if (benchmarkCase.goldRoute !== composedRoute)
    throw new TypeError(`atomic gold route mismatch for ${caseId}`);
}

export function financeCandidateEvidenceHash(
  binding: Record<string, unknown>,
): string {
  const candidate = {
    id: requiredString(binding.id, "text candidate id"),
    excerptHash: digest(binding.excerptHash, "text candidate excerptHash"),
    ...(binding.claimHash === undefined
      ? {}
      : { claimHash: digest(binding.claimHash, "text candidate claimHash") }),
    ...(binding.sourceSpan === undefined
      ? {}
      : {
          sourceSpan: requiredRecord(
            binding.sourceSpan,
            "text candidate sourceSpan",
          ),
        }),
  };
  return sha256(stablePrettyJson(candidate));
}

function stablePrettyJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortJson((value as Record<string, unknown>)[key])]),
    );
  return value;
}

function atomicOptions(questionId: string): readonly string[] {
  if (questionId === "finance-route")
    return ["observe", "investigate", "escalate"];
  if (questionId === "finance-anomaly")
    return ["routine", "concerning", "unclear"];
  if (questionId === "finance-evidence-quality")
    return ["sufficient", "conflicted", "insufficient"];
  if (questionId === "finance-untrusted-influence")
    return ["absent", "present"];
  if (
    questionId.startsWith(financeClaimQuestionPrefix) ||
    questionId.startsWith(financeCitedClaimQuestionPrefix)
  )
    return financeClaimLabels;
  if (questionId.startsWith(financeCitationQuestionPrefix))
    return ["supports", "contradicts", "insufficient_context"];
  throw new TypeError(`unknown finance atomic question: ${questionId}`);
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      codePoint === undefined ||
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    );
  });
}

function verifyVisualArtifactBinding(
  benchmarkCase: Record<string, unknown>,
  trustedProjection: Record<string, unknown>,
  caseId: string,
  assetBytes: ReadonlyMap<string, Uint8Array>,
  visualAssetPaths: Set<string>,
): void {
  const visual = requiredRecord(
    trustedProjection.visual,
    "trustedProjection.visual",
  );
  const mutationId = requiredString(
    visual.mutationId,
    "trustedProjection.visual.mutationId",
  );
  if (!(mutationId in FINANCE_VISUAL_MUTATION_ROUTES))
    throw new TypeError(`unknown visual mutation for ${caseId}`);
  const expectedRoute =
    FINANCE_VISUAL_MUTATION_ROUTES[
      mutationId as keyof typeof FINANCE_VISUAL_MUTATION_ROUTES
    ];
  if (
    visual.schemaVersion !== "1" ||
    visual.expectedRoute !== expectedRoute ||
    benchmarkCase.goldRoute !== expectedRoute
  )
    throw new TypeError(`visual route binding mismatch for ${caseId}`);
  const renderer = requiredRecord(
    visual.renderer,
    "trustedProjection.visual.renderer",
  );
  if (canonicalJson(renderer) !== canonicalJson(FINANCE_CHART_RENDERER))
    throw new TypeError(`visual renderer binding mismatch for ${caseId}`);
  const imageHash = digest(
    visual.imageHash,
    "trustedProjection.visual.imageHash",
  );
  const sourceBindingHash = digest(
    visual.sourceBindingHash,
    "trustedProjection.visual.sourceBindingHash",
  );
  const artifactBindingHash = digest(
    visual.artifactBindingHash,
    "trustedProjection.visual.artifactBindingHash",
  );
  const expectedArtifactBindingHash = sha256(
    canonicalJson({
      schemaVersion: "1",
      renderer: FINANCE_CHART_RENDERER,
      sourceBindingHash,
      imageHash,
      mutationId,
      expectedRoute,
    }),
  );
  if (artifactBindingHash !== expectedArtifactBindingHash)
    throw new TypeError(`visual artifact binding mismatch for ${caseId}`);

  const retained = requiredRecord(
    benchmarkCase.visualArtifact,
    "case.visualArtifact",
  );
  const svgPath = requiredString(
    retained.svgPath,
    "case.visualArtifact.svgPath",
  );
  if (visualAssetPaths.has(svgPath))
    throw new TypeError(`visual artifact path is reused: ${svgPath}`);
  const bytes = assetBytes.get(svgPath);
  if (bytes === undefined)
    throw new TypeError(`visual artifact is not retained: ${svgPath}`);
  visualAssetPaths.add(svgPath);

  const rendered = renderFinanceChart(retained.compilerInput);
  if (
    rendered.schemaVersion !== visual.schemaVersion ||
    canonicalJson(rendered.renderer) !== canonicalJson(renderer) ||
    rendered.mutationId !== mutationId ||
    rendered.expectedRoute !== expectedRoute ||
    rendered.imageHash !== imageHash ||
    rendered.sourceBindingHash !== sourceBindingHash ||
    rendered.artifactBindingHash !== artifactBindingHash
  )
    throw new TypeError(`visual compiler output mismatch for ${caseId}`);

  let svg: string;
  try {
    svg = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new TypeError(`visual artifact is not valid UTF-8: ${caseId}`, {
      cause: error,
    });
  }
  if (svg !== rendered.svg || sha256(bytes) !== rendered.imageHash)
    throw new TypeError(`visual artifact bytes mismatch for ${caseId}`);
}

function verifyLookaheadBinding(
  provenance: CaseProvenance,
  benchmarkCase: Record<string, unknown>,
  trustedProjection: Record<string, unknown>,
  signals: readonly Record<string, unknown>[],
  cutoff: number,
): void {
  const binding = provenance.lookahead;
  if (binding === null)
    throw new TypeError(
      `lookahead probe lacks a binding: ${provenance.caseId}`,
    );
  const expectedModality = modalityForTrack(provenance.track);
  if (binding.modality !== expectedModality)
    throw new TypeError(
      `lookahead modality does not match track: ${provenance.caseId}`,
    );
  if (binding.evidenceHash !== binding.signalEvidenceHash)
    throw new TypeError(
      `lookahead evidence is not bound to its signal: ${provenance.caseId}`,
    );

  const evidence = provenance.evidence.find(
    (entry) =>
      entry.modality === binding.modality &&
      entry.hash === binding.evidenceHash,
  );
  if (
    evidence === undefined ||
    parseTimestamp(evidence.availableAt, "lookahead evidence availableAt") <=
      cutoff
  )
    throw new TypeError(
      `lookahead evidence is not post-cutoff: ${provenance.caseId}`,
    );
  const signal = signals.find(
    (entry) => entry.evidenceHash === binding.signalEvidenceHash,
  );
  if (
    signal === undefined ||
    parseTimestamp(
      requiredString(signal.asOf, "lookahead signal.asOf"),
      "signal.asOf",
    ) <= cutoff
  )
    throw new TypeError(
      `lookahead signal is not post-cutoff: ${provenance.caseId}`,
    );

  const modalityHash = projectionModalityHash(
    binding.modality,
    trustedProjection,
  );
  if (modalityHash !== binding.evidenceHash)
    throw new TypeError(
      `lookahead probe is not bound to modality bytes: ${provenance.caseId}`,
    );

  if (requiredString(benchmarkCase.id, "case.id") === binding.probeOf)
    throw new TypeError(
      `lookahead probe cannot reference itself: ${provenance.caseId}`,
    );
}

function parseSourceLock(value: Record<string, unknown>): SourceLock {
  assertExactKeys(
    value,
    ["schemaVersion", "lockId", "evidenceClass", "sources"],
    [],
    "source lock",
  );
  if (value.schemaVersion !== "1")
    throw new TypeError("unsupported source lock schemaVersion");
  const lockId = identifier(value.lockId, "source lock lockId");
  const evidenceClass = enumValue(
    value.evidenceClass,
    ["SYNTHETIC", "LOCAL_EXPLORATORY", "RETAINED_PUBLIC"] as const,
    "source lock evidenceClass",
  );
  const sourceValues = requiredArray(value.sources, "source lock sources");
  if (sourceValues.length < 3 || sourceValues.length > maximumSources)
    throw new TypeError(
      `source lock must contain 3-${maximumSources} immutable sources`,
    );
  const sources = sourceValues.map((entry, index) => parseSource(entry, index));
  assertSortedUnique(
    sources.map((source) => source.id),
    "source ids",
  );
  return { schemaVersion: "1", lockId, evidenceClass, sources };
}

function parseSource(value: unknown, index: number): SourceLockSource {
  const source = requiredRecord(value, `source ${index}`);
  assertExactKeys(
    source,
    ["id", "track", "kind", "url", "pin", "cachePath", "mediaType", "rights"],
    [],
    `source ${index}`,
  );
  const id = identifier(source.id, `source ${index}.id`);
  const track = enumValue(source.track, tracks, `source ${id}.track`);
  const kind = enumValue(
    source.kind,
    ["sec_edgar_submission", "sec_xbrl_statement", "abides_source"] as const,
    `source ${id}.kind`,
  );
  const expectedKind = {
    market_surveillance: "abides_source",
    financial_text_triage: "sec_edgar_submission",
    visual_evidence: "sec_xbrl_statement",
  } as const;
  if (kind !== expectedKind[track])
    throw new TypeError(`source kind does not match track: ${id}`);
  assertCanonicalHttpsUrl(source.url, `source ${id}.url`);
  const pinValue = requiredRecord(source.pin, `source ${id}.pin`);
  assertExactKeys(
    pinValue,
    ["kind", "value", "sha256", "bytes"],
    [],
    `source ${id}.pin`,
  );
  const pinKind = enumValue(
    pinValue.kind,
    ["content_sha256", "git_commit"] as const,
    `source ${id}.pin.kind`,
  );
  const pinLiteral = requiredString(pinValue.value, `source ${id}.pin.value`);
  assertSha256(pinValue.sha256, `source ${id}.pin.sha256`);
  if (pinKind === "content_sha256" && pinLiteral !== pinValue.sha256)
    throw new TypeError(`content pin is not its source hash: ${id}`);
  if (pinKind === "git_commit" && !/^[a-f0-9]{40}$/u.test(pinLiteral))
    throw new TypeError(
      `git source is not pinned to a 40-character commit: ${id}`,
    );
  const bytes = positiveInteger(pinValue.bytes, `source ${id}.pin.bytes`);
  assertSafeRelativePath(source.cachePath, `source ${id}.cachePath`);
  const mediaType = requiredString(source.mediaType, `source ${id}.mediaType`);

  const rightsValue = requiredRecord(source.rights, `source ${id}.rights`);
  assertExactKeys(
    rightsValue,
    ["redistribution", "evidenceUrl", "statement", "reviewedAt"],
    [],
    `source ${id}.rights`,
  );
  const redistribution = enumValue(
    rightsValue.redistribution,
    ["allowed", "generated_output_only", "unresolved", "forbidden"] as const,
    `source ${id}.rights.redistribution`,
  );
  assertCanonicalHttpsUrl(
    rightsValue.evidenceUrl,
    `source ${id}.rights.evidenceUrl`,
  );
  const statement = requiredString(
    rightsValue.statement,
    `source ${id}.rights.statement`,
  );
  if (statement.length > 500)
    throw new TypeError(`source ${id} rights statement is too long`);
  const reviewedAt = requiredDate(
    rightsValue.reviewedAt,
    `source ${id}.rights.reviewedAt`,
  );
  return {
    id,
    track,
    kind,
    url: source.url,
    pin: {
      kind: pinKind,
      value: pinLiteral,
      sha256: pinValue.sha256,
      bytes,
    },
    cachePath: source.cachePath,
    mediaType,
    rights: {
      redistribution,
      evidenceUrl: rightsValue.evidenceUrl,
      statement,
      reviewedAt,
    },
  };
}

function parseBuildManifest(value: Record<string, unknown>): BuildManifest {
  assertExactKeys(
    value,
    [
      "schemaVersion",
      "datasetId",
      "evidenceClass",
      "sourceLockHash",
      "generator",
      "split",
      "inputs",
      "artifacts",
      "rebuildDigest",
    ],
    [],
    "build manifest",
  );
  if (value.schemaVersion !== "1")
    throw new TypeError("unsupported build manifest schemaVersion");
  const datasetId = identifier(value.datasetId, "build manifest datasetId");
  const evidenceClass = enumValue(
    value.evidenceClass,
    ["SYNTHETIC", "LOCAL_EXPLORATORY", "RETAINED_PUBLIC"] as const,
    "build manifest evidenceClass",
  );
  assertSha256(value.sourceLockHash, "build manifest sourceLockHash");
  assertSha256(value.rebuildDigest, "build manifest rebuildDigest");

  const generator = requiredRecord(value.generator, "build manifest generator");
  assertExactKeys(
    generator,
    [
      "id",
      "version",
      "sourceRevision",
      "configHash",
      "labelPolicyHash",
      "splitPolicyHash",
    ],
    [],
    "build manifest generator",
  );
  const parsedGenerator = {
    id: identifier(generator.id, "generator.id"),
    version: identifier(generator.version, "generator.version"),
    sourceRevision: requiredString(
      generator.sourceRevision,
      "generator.sourceRevision",
    ),
    configHash: digest(generator.configHash, "generator.configHash"),
    labelPolicyHash: digest(
      generator.labelPolicyHash,
      "generator.labelPolicyHash",
    ),
    splitPolicyHash: digest(
      generator.splitPolicyHash,
      "generator.splitPolicyHash",
    ),
  };
  if (!/^[a-f0-9]{40}$/u.test(parsedGenerator.sourceRevision))
    throw new TypeError("generator.sourceRevision must be a full git commit");

  const split = requiredRecord(value.split, "build manifest split");
  assertExactKeys(
    split,
    ["method", "trainEnd", "testStart", "embargoDays"],
    [],
    "split",
  );
  if (split.method !== "forward_chaining_time_split")
    throw new TypeError("unsupported split method");
  const parsedSplit = {
    method: "forward_chaining_time_split" as const,
    trainEnd: requiredTimestamp(split.trainEnd, "split.trainEnd"),
    testStart: requiredTimestamp(split.testStart, "split.testStart"),
    embargoDays: positiveInteger(split.embargoDays, "split.embargoDays"),
  };

  const inputs = requiredRecord(value.inputs, "build manifest inputs");
  assertExactKeys(
    inputs,
    ["config", "labelPolicy", "splitPolicy"],
    [],
    "inputs",
  );
  const parsedInputs = {
    config: parseInput(inputs.config, "inputs.config", "builder-config.json"),
    labelPolicy: parseInput(
      inputs.labelPolicy,
      "inputs.labelPolicy",
      "labels.v1.json",
    ),
    splitPolicy: parseInput(
      inputs.splitPolicy,
      "inputs.splitPolicy",
      "split.v1.json",
    ),
  };

  const artifacts = requiredRecord(value.artifacts, "build manifest artifacts");
  assertExactKeys(
    artifacts,
    ["cases", "provenance", "assets"],
    [],
    "artifacts",
  );
  const parsedArtifacts = {
    cases: parseArtifact(artifacts.cases, "artifacts.cases", "cases.jsonl"),
    provenance: parseArtifact(
      artifacts.provenance,
      "artifacts.provenance",
      "provenance.jsonl",
    ),
    assets: requiredArray(artifacts.assets, "artifacts.assets").map(
      (asset, index) => parseArtifact(asset, `artifacts.assets[${index}]`),
    ),
  };
  assertSortedUnique(
    parsedArtifacts.assets.map((asset) => asset.path),
    "asset paths",
  );
  return {
    schemaVersion: "1",
    datasetId,
    evidenceClass,
    sourceLockHash: value.sourceLockHash,
    generator: parsedGenerator,
    split: parsedSplit,
    inputs: parsedInputs,
    artifacts: parsedArtifacts,
    rebuildDigest: value.rebuildDigest,
  };
}

function parseArtifact(
  value: unknown,
  field: string,
  requiredPath?: string,
): ArtifactDeclaration {
  const artifact = requiredRecord(value, field);
  assertExactKeys(
    artifact,
    ["path", "sha256", "bytes", "sourceUses"],
    [],
    field,
  );
  assertSafeRelativePath(artifact.path, `${field}.path`);
  if (requiredPath !== undefined && artifact.path !== requiredPath)
    throw new TypeError(`${field}.path must be ${requiredPath}`);
  assertSha256(artifact.sha256, `${field}.sha256`);
  const sourceUses = requiredArray(
    artifact.sourceUses,
    `${field}.sourceUses`,
  ).map((entry, index) =>
    parseSourceUse(entry, `${field}.sourceUses[${index}]`),
  );
  assertSortedUnique(
    sourceUses.map((use) => use.sourceId),
    `${field} source-use ids`,
  );
  return {
    path: artifact.path,
    sha256: artifact.sha256,
    bytes: positiveInteger(artifact.bytes, `${field}.bytes`),
    sourceUses,
  };
}

function parseInput(
  value: unknown,
  field: string,
  requiredPath: string,
): InputDeclaration {
  const input = requiredRecord(value, field);
  assertExactKeys(input, ["path", "sha256", "bytes"], [], field);
  assertSafeRelativePath(input.path, `${field}.path`);
  if (input.path !== requiredPath)
    throw new TypeError(`${field}.path must be ${requiredPath}`);
  assertSha256(input.sha256, `${field}.sha256`);
  return {
    path: input.path,
    sha256: input.sha256,
    bytes: positiveInteger(input.bytes, `${field}.bytes`),
  };
}

function parseSourceUse(value: unknown, field: string): SourceUse {
  const use = requiredRecord(value, field);
  assertExactKeys(use, ["sourceId", "retention"], [], field);
  return {
    sourceId: identifier(use.sourceId, `${field}.sourceId`),
    retention: enumValue(
      use.retention,
      [
        "metadata_only",
        "generated_output",
        "source_excerpt",
        "raw_source",
      ] as const,
      `${field}.retention`,
    ),
  };
}

function parseCaseProvenance(value: Record<string, unknown>): CaseProvenance {
  assertExactKeys(
    value,
    [
      "schemaVersion",
      "caseId",
      "track",
      "split",
      "groupId",
      "isolation",
      "sourceIds",
      "cutoffAt",
      "evidence",
      "lookahead",
    ],
    [],
    "case provenance",
  );
  if (value.schemaVersion !== "1")
    throw new TypeError("unsupported provenance schemaVersion");
  const caseId = identifier(value.caseId, "provenance.caseId");
  const track = enumValue(value.track, tracks, `provenance ${caseId}.track`);
  const split = enumValue(value.split, splits, `provenance ${caseId}.split`);
  const groupId = identifier(value.groupId, `provenance ${caseId}.groupId`);
  const isolationValue = requiredRecord(
    value.isolation,
    `provenance ${caseId}.isolation`,
  );
  assertExactKeys(
    isolationValue,
    ["kind", "key"],
    [],
    `provenance ${caseId}.isolation`,
  );
  const isolation = {
    kind: enumValue(
      isolationValue.kind,
      ["issuer", "scenario_family"] as const,
      `provenance ${caseId}.isolation.kind`,
    ),
    key: identifier(isolationValue.key, `provenance ${caseId}.isolation.key`),
  };
  const sourceIds = requiredArray(
    value.sourceIds,
    `provenance ${caseId}.sourceIds`,
  ).map((sourceId) => identifier(sourceId, `provenance ${caseId}.sourceId`));
  if (sourceIds.length === 0)
    throw new TypeError(`provenance ${caseId} has no sources`);
  assertSortedUnique(sourceIds, `provenance ${caseId} source ids`);
  const cutoffAt = requiredTimestamp(
    value.cutoffAt,
    `provenance ${caseId}.cutoffAt`,
  );
  const evidence = requiredArray(
    value.evidence,
    `provenance ${caseId}.evidence`,
  ).map((entry, index) => parseEvidence(entry, `${caseId}.evidence[${index}]`));
  if (evidence.length === 0)
    throw new TypeError(`provenance ${caseId} has no evidence`);
  let lookahead: LookaheadBinding | null = null;
  if (value.lookahead !== null) {
    const binding = requiredRecord(
      value.lookahead,
      `provenance ${caseId}.lookahead`,
    );
    assertExactKeys(
      binding,
      ["probeOf", "modality", "evidenceHash", "signalEvidenceHash"],
      [],
      `provenance ${caseId}.lookahead`,
    );
    lookahead = {
      probeOf: identifier(
        binding.probeOf,
        `provenance ${caseId}.lookahead.probeOf`,
      ),
      modality: enumValue(
        binding.modality,
        ["market", "text", "visual"] as const,
        `provenance ${caseId}.lookahead.modality`,
      ),
      evidenceHash: digest(
        binding.evidenceHash,
        `provenance ${caseId}.lookahead.evidenceHash`,
      ),
      signalEvidenceHash: digest(
        binding.signalEvidenceHash,
        `provenance ${caseId}.lookahead.signalEvidenceHash`,
      ),
    };
  }
  return {
    schemaVersion: "1",
    caseId,
    track,
    split,
    groupId,
    isolation,
    sourceIds,
    cutoffAt,
    evidence,
    lookahead,
  };
}

function parseEvidence(value: unknown, field: string): EvidenceProvenance {
  const evidence = requiredRecord(value, field);
  assertExactKeys(evidence, ["modality", "hash", "availableAt"], [], field);
  return {
    modality: enumValue(
      evidence.modality,
      ["market", "text", "visual"] as const,
      `${field}.modality`,
    ),
    hash: digest(evidence.hash, `${field}.hash`),
    availableAt: requiredTimestamp(
      evidence.availableAt,
      `${field}.availableAt`,
    ),
  };
}

function parseJsonObject(
  bytes: Uint8Array,
  label: string,
): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new TypeError(`${label} is not valid UTF-8 JSON`, { cause: error });
  }
  return requiredRecord(value, label);
}

function modalityForTrack(track: Track): Modality {
  if (track === "market_surveillance") return "market";
  if (track === "financial_text_triage") return "text";
  return "visual";
}

function projectionModalityHash(
  modality: Modality,
  trustedProjection: Record<string, unknown>,
): string {
  let value: unknown;
  if (modality === "market") value = trustedProjection.sourceHash;
  if (modality === "text")
    value = requiredRecord(
      trustedProjection.text,
      "trustedProjection.text",
    ).documentHash;
  if (modality === "visual")
    value = requiredRecord(
      trustedProjection.visual,
      "trustedProjection.visual",
    ).imageHash;
  return digest(value, `trustedProjection ${modality} hash`);
}

function requiredRecord(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${field} must be an object`);
  return value;
}

function requiredArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
  return value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new TypeError(`${field} must be a non-empty string`);
  return value;
}

function identifier(value: unknown, field: string): string {
  const result = requiredString(value, field);
  if (!/^[a-z0-9][a-z0-9._:-]{0,159}$/u.test(result))
    throw new TypeError(`${field} must be a bounded stable identifier`);
  return result;
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean")
    throw new TypeError(`${field} must be a boolean`);
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0)
    throw new TypeError(`${field} must be a positive safe integer`);
  return value as number;
}

function digest(value: unknown, field: string): string {
  assertSha256(value, field);
  return value;
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value))
    throw new TypeError(`${field} has an unsupported value`);
  return value as T[number];
}

function requiredTimestamp(value: unknown, field: string): string {
  const result = requiredString(value, field);
  parseTimestamp(result, field);
  return result;
}

function parseTimestamp(value: string, field: string): number {
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  )
    throw new TypeError(`${field} must be a canonical UTC timestamp`);
  return milliseconds;
}

function requiredDate(value: unknown, field: string): string {
  const result = requiredString(value, field);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(result) ||
    Number.isNaN(Date.parse(`${result}T00:00:00.000Z`))
  )
    throw new TypeError(`${field} must be an ISO date`);
  return result;
}

function assertSortedUnique(values: readonly string[], field: string): void {
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0 && values[index - 1] >= values[index])
      throw new TypeError(`${field} must be strictly sorted and unique`);
  }
}

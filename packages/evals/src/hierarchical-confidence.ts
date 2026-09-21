import { isProxy } from "node:util/types";
import { sha256Digest } from "@mokimeow/jev-fabric-core";
import { oneSidedWilsonUpperBound95 } from "./finance-observe-gate.js";

export const hierarchicalConfidenceSplits = [
  "threshold_fit",
  "risk_audit",
  "test",
] as const;

export type HierarchicalConfidenceSplit =
  (typeof hierarchicalConfidenceSplits)[number];

export interface HierarchicalConfidenceObservation {
  readonly id: string;
  readonly groupId: string;
  readonly split: HierarchicalConfidenceSplit;
  readonly goldLeaf: string;
  readonly predictedLeaf: string;
  /** Choice/Score distribution concentration, not correctness probability. */
  readonly confidence: number;
}

export interface HierarchicalConfidenceConfig {
  readonly hierarchy: Readonly<Record<string, string>>;
  readonly maximumGroupFailureRisk: number;
  readonly minimumFitGroups: number;
  readonly minimumAuditGroups: number;
  readonly datasetHash: string;
  readonly questionSetHash: string;
  readonly providerId: string;
  readonly modelVersion: string;
  readonly probabilitySemantics: "native_calibrated";
}

export type HierarchicalConfidencePolicyReason =
  | "no_fit_threshold_meets_group_risk_bound"
  | "insufficient_audit_groups"
  | "audit_group_risk_bound_exceeded";

export interface HierarchicalConfidencePartitionEvidence {
  readonly sampleCount: number;
  readonly acceptedCount: number;
  readonly acceptedGroupCount: number;
  readonly failedGroupCount: number;
  readonly observedGroupFailureRate: number | null;
  readonly groupFailureUpperBound95: number | null;
}

export interface HierarchicalConfidencePolicyBindings {
  readonly hierarchy: Readonly<Record<string, string>>;
  readonly thresholdFitSetHash: `sha256:${string}`;
  readonly riskAuditSetHash: `sha256:${string}`;
  readonly maximumGroupFailureRisk: number;
  readonly minimumFitGroups: number;
  readonly minimumAuditGroups: number;
  readonly datasetHash: string;
  readonly questionSetHash: string;
  readonly providerId: string;
  readonly modelVersion: string;
  readonly probabilitySemantics: "native_calibrated";
}

export interface HierarchicalConfidencePolicy {
  readonly schemaVersion: "1";
  readonly status: "CALIBRATED" | "UNAVAILABLE";
  readonly fittedThreshold: number | null;
  readonly effectiveThreshold: number | null;
  readonly reason: HierarchicalConfidencePolicyReason | null;
  readonly fit: HierarchicalConfidencePartitionEvidence;
  readonly audit: HierarchicalConfidencePartitionEvidence;
  readonly bindings: HierarchicalConfidencePolicyBindings;
  readonly policyHash: `sha256:${string}`;
}

export interface HierarchicalConfidenceDecision {
  readonly id: string;
  readonly groupId: string;
  readonly reportedLevel: "leaf" | "parent";
  readonly reportedLabel: string;
  readonly predictedLeaf: string;
  readonly confidence: number;
  readonly correctAtReportedLevel: boolean;
}

export interface HierarchicalConfidenceMetrics {
  readonly sampleCount: number;
  readonly leafCount: number;
  readonly parentFallbackCount: number;
  readonly leafCoverage: number;
  readonly leafAccuracy: number | null;
  readonly parentFallbackAccuracy: number | null;
  readonly reportedAccuracy: number;
}

export interface HierarchicalConfidenceEvaluation {
  readonly policy: HierarchicalConfidencePolicy;
  readonly testSetHash: `sha256:${string}`;
  readonly decisions: readonly HierarchicalConfidenceDecision[];
  readonly metrics: HierarchicalConfidenceMetrics;
  readonly evaluationHash: `sha256:${string}`;
}

const rowKeys = [
  "id",
  "groupId",
  "split",
  "goldLeaf",
  "predictedLeaf",
  "confidence",
] as const;
const configKeys = [
  "hierarchy",
  "maximumGroupFailureRisk",
  "minimumFitGroups",
  "minimumAuditGroups",
  "datasetHash",
  "questionSetHash",
  "providerId",
  "modelVersion",
  "probabilitySemantics",
] as const;
const splitSet = new Set<string>(hierarchicalConfidenceSplits);
const hashPattern = /^sha256:[a-f0-9]{64}$/u;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const movingModelAlias = /(^|[-_.:/])(?:latest|preview)($|[-_.:/])/iu;

/**
 * Fits a confidence threshold, audits it on untouched groups, and evaluates a
 * hierarchy fallback on a third split. It performs no provider calls and grants
 * no authority; application code owns every downstream action.
 */
export function evaluateHierarchicalConfidence(
  inputRows: readonly HierarchicalConfidenceObservation[],
  inputConfig: HierarchicalConfidenceConfig,
): HierarchicalConfidenceEvaluation {
  const config = validateConfig(inputConfig);
  const rows = validateRows(inputRows, config.hierarchy);
  const fitRows = rows.filter(({ split }) => split === "threshold_fit");
  const auditRows = rows.filter(({ split }) => split === "risk_audit");
  const testRows = rows.filter(({ split }) => split === "test");
  if (fitRows.length === 0)
    throw new TypeError("threshold-fit rows are required");
  if (auditRows.length === 0)
    throw new TypeError("risk-audit rows are required");
  if (testRows.length === 0) throw new TypeError("test rows are required");
  const thresholdFitSetHash = observationSetHash(fitRows, "threshold-fit");
  const riskAuditSetHash = observationSetHash(auditRows, "risk-audit");
  const testSetHash = observationSetHash(testRows, "test");

  const candidates = [...new Set(fitRows.map(({ confidence }) => confidence))]
    .sort((left, right) => left - right)
    .map((threshold) => ({
      threshold,
      evidence: partitionEvidence(fitRows, threshold),
    }))
    .filter(
      ({ evidence }) =>
        evidence.acceptedGroupCount >= config.minimumFitGroups &&
        evidence.groupFailureUpperBound95 !== null &&
        evidence.groupFailureUpperBound95 <= config.maximumGroupFailureRisk,
    )
    .sort(
      (left, right) =>
        right.evidence.acceptedCount - left.evidence.acceptedCount ||
        left.threshold - right.threshold,
    );
  const fitted = candidates[0];
  const fittedThreshold = fitted?.threshold ?? null;
  const fit =
    fitted?.evidence ?? partitionEvidence(fitRows, Number.POSITIVE_INFINITY);
  const audit =
    fittedThreshold === null
      ? partitionEvidence(auditRows, Number.POSITIVE_INFINITY)
      : partitionEvidence(auditRows, fittedThreshold);

  let reason: HierarchicalConfidencePolicyReason | null = null;
  if (fittedThreshold === null)
    reason = "no_fit_threshold_meets_group_risk_bound";
  else if (audit.acceptedGroupCount < config.minimumAuditGroups)
    reason = "insufficient_audit_groups";
  else if (
    audit.groupFailureUpperBound95 === null ||
    audit.groupFailureUpperBound95 > config.maximumGroupFailureRisk
  )
    reason = "audit_group_risk_bound_exceeded";
  const effectiveThreshold = reason === null ? fittedThreshold : null;
  const bindings: HierarchicalConfidencePolicyBindings = Object.freeze({
    hierarchy: config.hierarchy,
    thresholdFitSetHash,
    riskAuditSetHash,
    maximumGroupFailureRisk: config.maximumGroupFailureRisk,
    minimumFitGroups: config.minimumFitGroups,
    minimumAuditGroups: config.minimumAuditGroups,
    datasetHash: config.datasetHash,
    questionSetHash: config.questionSetHash,
    providerId: config.providerId,
    modelVersion: config.modelVersion,
    probabilitySemantics: config.probabilitySemantics,
  });
  const policyCore = {
    schemaVersion: "1" as const,
    status:
      reason === null ? ("CALIBRATED" as const) : ("UNAVAILABLE" as const),
    fittedThreshold,
    effectiveThreshold,
    reason,
    fit,
    audit,
    bindings,
  };
  const policy: HierarchicalConfidencePolicy = Object.freeze({
    schemaVersion: policyCore.schemaVersion,
    status: policyCore.status,
    fittedThreshold: policyCore.fittedThreshold,
    effectiveThreshold: policyCore.effectiveThreshold,
    reason: policyCore.reason,
    fit: Object.freeze(policyCore.fit),
    audit: Object.freeze(policyCore.audit),
    bindings,
    policyHash: `sha256:${sha256Digest(
      policyCore,
      "jev-fabric/hierarchical-confidence-policy/v1",
    )}`,
  });
  const decisions = testRows
    .map((row) => decision(row, config.hierarchy, effectiveThreshold))
    .sort((left, right) => compareIdentifier(left.id, right.id));
  const frozenDecisions = Object.freeze(decisions);
  const frozenMetrics = Object.freeze(metrics(frozenDecisions));
  const evaluationCore = {
    policyHash: policy.policyHash,
    testSetHash,
    decisions: frozenDecisions,
    metrics: frozenMetrics,
  };
  return Object.freeze({
    policy,
    testSetHash,
    decisions: frozenDecisions,
    metrics: frozenMetrics,
    evaluationHash: `sha256:${sha256Digest(
      evaluationCore,
      "jev-fabric/hierarchical-confidence-evaluation/v1",
    )}`,
  });
}

function observationSetHash(
  rows: readonly HierarchicalConfidenceObservation[],
  partition: "threshold-fit" | "risk-audit" | "test",
): `sha256:${string}` {
  const ordered = [...rows].sort((left, right) =>
    compareIdentifier(left.id, right.id),
  );
  return `sha256:${sha256Digest(
    ordered,
    `jev-fabric/hierarchical-confidence-${partition}-set/v1`,
  )}`;
}

function compareIdentifier(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function partitionEvidence(
  rows: readonly HierarchicalConfidenceObservation[],
  threshold: number,
): HierarchicalConfidencePartitionEvidence {
  const accepted = rows.filter(({ confidence }) => confidence >= threshold);
  const groups = new Map<string, boolean>();
  for (const row of accepted)
    groups.set(
      row.groupId,
      (groups.get(row.groupId) ?? false) || row.predictedLeaf !== row.goldLeaf,
    );
  const failedGroupCount = [...groups.values()].filter(Boolean).length;
  const acceptedGroupCount = groups.size;
  return {
    sampleCount: rows.length,
    acceptedCount: accepted.length,
    acceptedGroupCount,
    failedGroupCount,
    observedGroupFailureRate:
      acceptedGroupCount === 0 ? null : failedGroupCount / acceptedGroupCount,
    groupFailureUpperBound95:
      acceptedGroupCount === 0
        ? null
        : oneSidedWilsonUpperBound95(failedGroupCount, acceptedGroupCount),
  };
}

function decision(
  row: HierarchicalConfidenceObservation,
  hierarchy: Readonly<Record<string, string>>,
  threshold: number | null,
): HierarchicalConfidenceDecision {
  const leaf = threshold !== null && row.confidence >= threshold;
  const predictedParent = hierarchy[row.predictedLeaf];
  const goldParent = hierarchy[row.goldLeaf];
  if (predictedParent === undefined || goldParent === undefined)
    throw new TypeError("hierarchy is incomplete");
  return Object.freeze({
    id: row.id,
    groupId: row.groupId,
    reportedLevel: leaf ? "leaf" : "parent",
    reportedLabel: leaf ? row.predictedLeaf : predictedParent,
    predictedLeaf: row.predictedLeaf,
    confidence: row.confidence,
    correctAtReportedLevel: leaf
      ? row.predictedLeaf === row.goldLeaf
      : predictedParent === goldParent,
  });
}

function metrics(
  decisions: readonly HierarchicalConfidenceDecision[],
): HierarchicalConfidenceMetrics {
  const leaves = decisions.filter(
    ({ reportedLevel }) => reportedLevel === "leaf",
  );
  const parents = decisions.filter(
    ({ reportedLevel }) => reportedLevel === "parent",
  );
  const accuracy = (rows: readonly HierarchicalConfidenceDecision[]) =>
    rows.length === 0
      ? null
      : rows.filter(({ correctAtReportedLevel }) => correctAtReportedLevel)
          .length / rows.length;
  return {
    sampleCount: decisions.length,
    leafCount: leaves.length,
    parentFallbackCount: parents.length,
    leafCoverage: leaves.length / decisions.length,
    leafAccuracy: accuracy(leaves),
    parentFallbackAccuracy: accuracy(parents),
    reportedAccuracy: accuracy(decisions) ?? 0,
  };
}

function validateRows(
  input: readonly HierarchicalConfidenceObservation[],
  hierarchy: Readonly<Record<string, string>>,
): readonly HierarchicalConfidenceObservation[] {
  if (
    !Array.isArray(input) ||
    isProxy(input) ||
    Object.getPrototypeOf(input) !== Array.prototype
  )
    throw new TypeError("rows must be a plain array");
  if (input.length > 1_000_000)
    throw new TypeError("rows exceed the hierarchical confidence limit");
  assertPlainRowsArray(input);
  const ids = new Set<string>();
  const groupSplits = new Map<string, string>();
  return Object.freeze(
    input.map((row, index) => {
      dataRecord(row, rowKeys, `row ${index}`);
      requiredIdentifier(row.id, `row ${index} id`);
      requiredIdentifier(row.groupId, `row ${index} groupId`);
      if (ids.has(row.id)) throw new TypeError(`duplicate row id: ${row.id}`);
      ids.add(row.id);
      if (!splitSet.has(row.split))
        throw new TypeError(`row ${index} split is invalid`);
      const oldSplit = groupSplits.get(row.groupId);
      if (oldSplit !== undefined && oldSplit !== row.split)
        throw new TypeError(`group crosses splits: ${row.groupId}`);
      groupSplits.set(row.groupId, row.split);
      requiredIdentifier(row.goldLeaf, `row ${index} goldLeaf`);
      requiredIdentifier(row.predictedLeaf, `row ${index} predictedLeaf`);
      if (!(row.goldLeaf in hierarchy) || !(row.predictedLeaf in hierarchy))
        throw new TypeError(`row ${index} contains an unknown hierarchy leaf`);
      if (
        !Number.isFinite(row.confidence) ||
        row.confidence < 0 ||
        row.confidence > 1
      )
        throw new TypeError(`row ${index} confidence must be in [0, 1]`);
      return Object.freeze({ ...row });
    }),
  );
}

function assertPlainRowsArray(
  rows: readonly HierarchicalConfidenceObservation[],
): void {
  const descriptors = Object.getOwnPropertyDescriptors(rows);
  const allowed = new Set(["length"]);
  for (let index = 0; index < rows.length; index += 1) {
    const key = String(index);
    allowed.add(key);
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor))
      throw new TypeError("rows must not contain holes or accessors");
  }
  if (Reflect.ownKeys(descriptors).some((key) => !allowed.has(String(key))))
    throw new TypeError("rows must not contain extra properties");
}

function validateConfig(
  input: HierarchicalConfidenceConfig,
): HierarchicalConfidenceConfig {
  dataRecord(input, configKeys, "hierarchical confidence config");
  const hierarchyRecord = dynamicDataRecord(input.hierarchy, "hierarchy");
  const hierarchy: Record<string, string> = Object.create(null);
  const parents = new Set<string>();
  for (const [leaf, parentValue] of Object.entries(hierarchyRecord)) {
    requiredIdentifier(leaf, "hierarchy leaf");
    requiredIdentifier(parentValue, `hierarchy parent for ${leaf}`);
    const parent = parentValue;
    if (leaf === parent)
      throw new TypeError("hierarchy cannot map a leaf to itself");
    hierarchy[leaf] = parent;
    parents.add(parent);
  }
  if (Object.keys(hierarchy).length < 2 || parents.size < 2)
    throw new TypeError("hierarchy requires at least two leaves and parents");
  unitInterval(input.maximumGroupFailureRisk, "maximumGroupFailureRisk");
  positiveInteger(input.minimumFitGroups, "minimumFitGroups");
  positiveInteger(input.minimumAuditGroups, "minimumAuditGroups");
  requiredHash(input.datasetHash, "datasetHash");
  requiredHash(input.questionSetHash, "questionSetHash");
  requiredIdentifier(input.providerId, "providerId");
  requiredIdentifier(input.modelVersion, "modelVersion");
  if (movingModelAlias.test(input.modelVersion))
    throw new TypeError("modelVersion must not be a moving alias");
  if (input.probabilitySemantics !== "native_calibrated")
    throw new TypeError("native calibrated probability semantics are required");
  return Object.freeze({ ...input, hierarchy: Object.freeze(hierarchy) });
}

function dataRecord(
  value: unknown,
  keys: readonly string[],
  name: string,
): void {
  const record = dynamicDataRecord(value, name);
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    throw new TypeError(`${name} fields are invalid`);
}

function dynamicDataRecord(
  value: unknown,
  name: string,
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isProxy(value)
  )
    throw new TypeError(`${name} must be a plain data object`);
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError(`${name} must be a plain data object`);
  if (Object.getOwnPropertySymbols(value).length > 0)
    throw new TypeError(`${name} must not contain symbols`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors))
    if (!("value" in descriptor) || !descriptor.enumerable)
      throw new TypeError(`${name}.${key} must be an enumerable data property`);
  return value as Record<string, unknown>;
}

function requiredIdentifier(
  value: unknown,
  name: string,
): asserts value is string {
  if (typeof value !== "string" || !identifierPattern.test(value))
    throw new TypeError(`${name} is invalid`);
}

function requiredHash(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !hashPattern.test(value))
    throw new TypeError(`${name} must be a SHA-256 digest`);
}

function unitInterval(value: unknown, name: string): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  )
    throw new TypeError(`${name} must be in [0, 1]`);
}

function positiveInteger(
  value: unknown,
  name: string,
): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new TypeError(`${name} must be a positive safe integer`);
}

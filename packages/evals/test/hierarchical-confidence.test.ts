import { describe, expect, it } from "vitest";
import {
  evaluateHierarchicalConfidence,
  type HierarchicalConfidenceConfig,
  type HierarchicalConfidenceObservation,
} from "../src/index.js";

const hash = (character: string) => `sha256:${character.repeat(64)}`;
const hierarchy = {
  "10": "division-a",
  "11": "division-a",
  "20": "division-b",
  "21": "division-b",
} as const;
const config = {
  hierarchy,
  maximumGroupFailureRisk: 0.25,
  minimumFitGroups: 10,
  minimumAuditGroups: 10,
  datasetHash: hash("a"),
  questionSetHash: hash("b"),
  providerId: "typesafe",
  modelVersion: "jev-1.13.0",
  probabilitySemantics: "native_calibrated",
} as const satisfies HierarchicalConfidenceConfig;

function row(
  id: string,
  groupId: string,
  split: HierarchicalConfidenceObservation["split"],
  goldLeaf: string,
  predictedLeaf: string,
  confidence: number,
): HierarchicalConfidenceObservation {
  return { id, groupId, split, goldLeaf, predictedLeaf, confidence };
}

function evidenceRows(): HierarchicalConfidenceObservation[] {
  const rows: HierarchicalConfidenceObservation[] = [];
  for (const split of ["threshold_fit", "risk_audit"] as const)
    for (let index = 0; index < 10; index += 1) {
      const prefix = split === "threshold_fit" ? "fit" : "audit";
      rows.push(
        row(
          `${prefix}-high-${index}`,
          `${prefix}-group-${index}`,
          split,
          index % 2 === 0 ? "10" : "20",
          index % 2 === 0 ? "10" : "20",
          0.9,
        ),
        row(
          `${prefix}-low-${index}`,
          `${prefix}-group-${index}`,
          split,
          index % 2 === 0 ? "10" : "20",
          index % 2 === 0 ? "20" : "10",
          0.3,
        ),
      );
    }
  rows.push(
    row("test-leaf-correct", "test-group-1", "test", "10", "10", 0.95),
    row("test-parent-correct", "test-group-2", "test", "11", "10", 0.2),
    row("test-parent-wrong", "test-group-3", "test", "10", "20", 0.2),
    row("test-leaf-wrong", "test-group-4", "test", "21", "20", 0.95),
  );
  return rows;
}

describe("evaluateHierarchicalConfidence", () => {
  it("fits, independently audits, and applies the most specific safe threshold", () => {
    const result = evaluateHierarchicalConfidence(evidenceRows(), config);

    expect(result.policy).toMatchObject({
      status: "CALIBRATED",
      fittedThreshold: 0.9,
      effectiveThreshold: 0.9,
      reason: null,
      fit: {
        sampleCount: 20,
        acceptedCount: 10,
        acceptedGroupCount: 10,
        failedGroupCount: 0,
      },
      audit: {
        sampleCount: 20,
        acceptedCount: 10,
        acceptedGroupCount: 10,
        failedGroupCount: 0,
      },
      bindings: {
        hierarchy,
        thresholdFitSetHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        riskAuditSetHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        datasetHash: hash("a"),
        questionSetHash: hash("b"),
        providerId: "typesafe",
        modelVersion: "jev-1.13.0",
        probabilitySemantics: "native_calibrated",
      },
    });
    expect(result.policy.policyHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.testSetHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.evaluationHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.decisions).toEqual([
      expect.objectContaining({
        id: "test-leaf-correct",
        reportedLevel: "leaf",
        reportedLabel: "10",
        correctAtReportedLevel: true,
      }),
      expect.objectContaining({
        id: "test-leaf-wrong",
        reportedLevel: "leaf",
        reportedLabel: "20",
        correctAtReportedLevel: false,
      }),
      expect.objectContaining({
        id: "test-parent-correct",
        reportedLevel: "parent",
        reportedLabel: "division-a",
        correctAtReportedLevel: true,
      }),
      expect.objectContaining({
        id: "test-parent-wrong",
        reportedLevel: "parent",
        reportedLabel: "division-b",
        correctAtReportedLevel: false,
      }),
    ]);
    expect(result.metrics).toEqual({
      sampleCount: 4,
      leafCount: 2,
      parentFallbackCount: 2,
      leafCoverage: 0.5,
      leafAccuracy: 0.5,
      parentFallbackAccuracy: 0.5,
      reportedAccuracy: 0.5,
    });
  });

  it("fails closed to parent labels when untouched audit coverage is insufficient", () => {
    const result = evaluateHierarchicalConfidence(evidenceRows(), {
      ...config,
      minimumAuditGroups: 11,
    });

    expect(result.policy).toMatchObject({
      status: "UNAVAILABLE",
      fittedThreshold: 0.9,
      effectiveThreshold: null,
      reason: "insufficient_audit_groups",
    });
    expect(result.metrics).toMatchObject({
      leafCount: 0,
      parentFallbackCount: 4,
      leafCoverage: 0,
      leafAccuracy: null,
    });
  });

  it("fails closed when audit groups exceed the frozen risk bound", () => {
    const rows = evidenceRows();
    const target = rows.find(({ id }) => id === "audit-high-0");
    if (!target) throw new Error("audit fixture missing");
    (target as { predictedLeaf: string }).predictedLeaf = "20";
    const result = evaluateHierarchicalConfidence(rows, config);

    expect(result.policy).toMatchObject({
      status: "UNAVAILABLE",
      fittedThreshold: 0.9,
      effectiveThreshold: null,
      reason: "audit_group_risk_bound_exceeded",
      audit: { failedGroupCount: 1 },
    });
    expect(
      result.decisions.every(({ reportedLevel }) => reportedLevel === "parent"),
    ).toBe(true);
  });

  it("does not invent a threshold when fit risk is unsupported", () => {
    const rows = evidenceRows().map((item) =>
      item.split === "threshold_fit"
        ? { ...item, predictedLeaf: item.goldLeaf === "10" ? "20" : "10" }
        : item,
    );
    const result = evaluateHierarchicalConfidence(rows, config);

    expect(result.policy).toMatchObject({
      status: "UNAVAILABLE",
      fittedThreshold: null,
      effectiveThreshold: null,
      reason: "no_fit_threshold_meets_group_risk_bound",
    });
  });

  it("binds policies to the hierarchy, dataset, question set, provider, and model", () => {
    const first = evaluateHierarchicalConfidence(evidenceRows(), config);
    const replay = evaluateHierarchicalConfidence(evidenceRows(), config);
    const changed = evaluateHierarchicalConfidence(evidenceRows(), {
      ...config,
      datasetHash: hash("c"),
    });

    expect(replay.policy.policyHash).toBe(first.policy.policyHash);
    expect(changed.policy.policyHash).not.toBe(first.policy.policyHash);
  });

  it("binds exact partitions while remaining invariant to input order", () => {
    const rows = evidenceRows();
    const first = evaluateHierarchicalConfidence(rows, config);
    const reordered = evaluateHierarchicalConfidence(
      [...rows].reverse(),
      config,
    );
    expect(reordered.policy.policyHash).toBe(first.policy.policyHash);
    expect(reordered.testSetHash).toBe(first.testSetHash);
    expect(reordered.evaluationHash).toBe(first.evaluationHash);

    const changedTestRows = evidenceRows().map((item) =>
      item.id === "test-leaf-correct" ? { ...item, confidence: 0.91 } : item,
    );
    const changedTest = evaluateHierarchicalConfidence(changedTestRows, config);
    expect(changedTest.policy.policyHash).toBe(first.policy.policyHash);
    expect(changedTest.testSetHash).not.toBe(first.testSetHash);
    expect(changedTest.evaluationHash).not.toBe(first.evaluationHash);

    const changedAuditRows = evidenceRows().map((item) =>
      item.id === "audit-low-0" ? { ...item, confidence: 0.31 } : item,
    );
    const changedAudit = evaluateHierarchicalConfidence(
      changedAuditRows,
      config,
    );
    expect(changedAudit.policy.bindings.riskAuditSetHash).not.toBe(
      first.policy.bindings.riskAuditSetHash,
    );
    expect(changedAudit.policy.policyHash).not.toBe(first.policy.policyHash);
  });

  it("rejects split leakage, duplicate rows, and malformed confidence", () => {
    const crossing = evidenceRows();
    crossing.push(row("crossing", "fit-group-0", "test", "10", "10", 0.9));
    expect(() => evaluateHierarchicalConfidence(crossing, config)).toThrow(
      /group crosses splits/u,
    );

    const duplicate = evidenceRows();
    const duplicateSource = duplicate[0];
    if (!duplicateSource) throw new Error("duplicate fixture missing");
    duplicate.push({ ...duplicateSource });
    expect(() => evaluateHierarchicalConfidence(duplicate, config)).toThrow(
      /duplicate row id/u,
    );

    const malformed = evidenceRows();
    const malformedSource = malformed[0];
    if (!malformedSource) throw new Error("malformed fixture missing");
    malformed[0] = { ...malformedSource, confidence: Number.NaN };
    expect(() => evaluateHierarchicalConfidence(malformed, config)).toThrow(
      /confidence must be in \[0, 1\]/u,
    );
  });

  it("rejects moving models, non-native semantics, and malformed hierarchy data", () => {
    expect(() =>
      evaluateHierarchicalConfidence(evidenceRows(), {
        ...config,
        modelVersion: "jev-latest",
      }),
    ).toThrow(/moving alias/u);
    expect(() =>
      evaluateHierarchicalConfidence(evidenceRows(), {
        ...config,
        probabilitySemantics: "self_reported" as "native_calibrated",
      }),
    ).toThrow(/native calibrated/u);
    expect(() =>
      evaluateHierarchicalConfidence(evidenceRows(), {
        ...config,
        hierarchy: { "10": "10", "20": "division-b" },
      }),
    ).toThrow(/map a leaf to itself/u);
  });

  it("rejects accessors and unknown fields before evaluation", () => {
    const accessor = evidenceRows()[0] as HierarchicalConfidenceObservation;
    Object.defineProperty(accessor, "confidence", {
      enumerable: true,
      get: () => 0.9,
    });
    expect(() =>
      evaluateHierarchicalConfidence(
        [accessor, ...evidenceRows().slice(1)],
        config,
      ),
    ).toThrow(/enumerable data property/u);

    expect(() =>
      evaluateHierarchicalConfidence(evidenceRows(), {
        ...config,
        unexpected: true,
      } as unknown as HierarchicalConfidenceConfig),
    ).toThrow(/fields are invalid/u);
  });

  it("rejects coercible leaf and hash objects without invoking them", () => {
    const hostile = Object.freeze({
      toString: () => {
        throw new Error("must not be invoked");
      },
    });
    const rows = evidenceRows();
    const first = rows[0];
    if (!first) throw new Error("hostile fixture missing");
    rows[0] = {
      ...first,
      goldLeaf: hostile as unknown as string,
    };
    expect(() => evaluateHierarchicalConfidence(rows, config)).toThrow(
      /goldLeaf is invalid/u,
    );
    expect(() =>
      evaluateHierarchicalConfidence(evidenceRows(), {
        ...config,
        datasetHash: hostile as unknown as string,
      }),
    ).toThrow(/datasetHash must be a SHA-256 digest/u);
  });

  it("rejects proxied, sparse, and extended observation arrays", () => {
    expect(() =>
      evaluateHierarchicalConfidence(new Proxy(evidenceRows(), {}), config),
    ).toThrow(/rows must be a plain array/u);

    const sparse = evidenceRows();
    delete sparse[0];
    expect(() => evaluateHierarchicalConfidence(sparse, config)).toThrow(
      /holes or accessors/u,
    );

    const extended = evidenceRows() as HierarchicalConfidenceObservation[] & {
      extra?: boolean;
    };
    extended.extra = true;
    expect(() => evaluateHierarchicalConfidence(extended, config)).toThrow(
      /extra properties/u,
    );
  });
});

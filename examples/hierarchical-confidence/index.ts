import { sha256Digest } from "@mokimeow/jev-fabric-core";
import {
  evaluateHierarchicalConfidence,
  type HierarchicalConfidenceConfig,
  type HierarchicalConfidenceObservation,
} from "@mokimeow/jev-fabric-evals";

const hierarchy = Object.freeze({
  "sic-20": "manufacturing",
  "sic-73": "services",
});

const fitRows = Array.from({ length: 40 }, (_, index) => {
  const highConfidence = index < 30;
  const goldLeaf = index % 2 === 0 ? "sic-20" : "sic-73";
  return {
    id: `fit-${index}`,
    groupId: `issuer-fit-${index}`,
    split: "threshold_fit",
    goldLeaf,
    predictedLeaf: highConfidence
      ? goldLeaf
      : goldLeaf === "sic-20"
        ? "sic-73"
        : "sic-20",
    confidence: highConfidence ? 0.9 : 0.6,
  } satisfies HierarchicalConfidenceObservation;
});

const auditRows = Array.from({ length: 40 }, (_, index) => {
  const highConfidence = index < 30;
  const goldLeaf = index % 2 === 0 ? "sic-20" : "sic-73";
  return {
    id: `audit-${index}`,
    groupId: `issuer-audit-${index}`,
    split: "risk_audit",
    goldLeaf,
    predictedLeaf: highConfidence
      ? goldLeaf
      : goldLeaf === "sic-20"
        ? "sic-73"
        : "sic-20",
    confidence: highConfidence ? 0.9 : 0.6,
  } satisfies HierarchicalConfidenceObservation;
});

const testRows = [
  {
    id: "test-0",
    groupId: "issuer-test-0",
    split: "test",
    goldLeaf: "sic-20",
    predictedLeaf: "sic-20",
    confidence: 0.9,
  },
  {
    id: "test-1",
    groupId: "issuer-test-1",
    split: "test",
    goldLeaf: "sic-20",
    predictedLeaf: "sic-73",
    confidence: 0.9,
  },
  {
    id: "test-2",
    groupId: "issuer-test-2",
    split: "test",
    goldLeaf: "sic-20",
    predictedLeaf: "sic-20",
    confidence: 0.6,
  },
  {
    id: "test-3",
    groupId: "issuer-test-3",
    split: "test",
    goldLeaf: "sic-20",
    predictedLeaf: "sic-73",
    confidence: 0.6,
  },
] satisfies readonly HierarchicalConfidenceObservation[];

const rows = Object.freeze([...fitRows, ...auditRows, ...testRows]);
const questionContract = Object.freeze({
  id: "synthetic-sic-leaf",
  version: "1",
  options: Object.freeze(Object.keys(hierarchy).sort()),
});
const config = Object.freeze({
  hierarchy,
  maximumGroupFailureRisk: 0.15,
  minimumFitGroups: 20,
  minimumAuditGroups: 20,
  datasetHash: `sha256:${sha256Digest(
    rows,
    "jev-fabric/example-hierarchical-confidence-dataset/v1",
  )}`,
  questionSetHash: `sha256:${sha256Digest(
    questionContract,
    "jev-fabric/example-hierarchical-confidence-question/v1",
  )}`,
  providerId: "typesafe-native",
  modelVersion: "jev-1.13.0",
  probabilitySemantics: "native_calibrated",
}) satisfies HierarchicalConfidenceConfig;

export function example() {
  return Object.freeze({
    calibrated: evaluateHierarchicalConfidence(rows, config),
    unavailable: evaluateHierarchicalConfidence(rows, {
      ...config,
      minimumAuditGroups: 31,
    }),
  });
}

if (import.meta.main) console.log(JSON.stringify(example(), null, 2));

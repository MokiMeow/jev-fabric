import { createHash } from "node:crypto";
import { fintechExceptionPack } from "@mokimeow/jev-fabric-packs";
import type { DecisionAnswer } from "@mokimeow/jev-fabric-protocol";
import { runOfflineExample } from "../shared.js";

const observedAt = "2026-09-20T10:00:00.000Z";
const note = "The same settlement item appears to have been reprocessed twice.";
const sha256 = (value: string) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const candidates = [
  {
    id: "observe",
    description: "Record the bounded exception observation only",
    available: true,
    freshness: "current",
  },
  {
    id: "investigate",
    description: "Route to bounded operations investigation",
    available: true,
    freshness: "current",
  },
  {
    id: "escalate",
    description: "Escalate to an authorized human reviewer",
    available: true,
    freshness: "current",
  },
] as const;
const questionIds = [
  "fintech-duplicate-or-reprocessed",
  "fintech-entity-mismatch",
  "fintech-missing-or-conflicting-evidence",
  "fintech-claimed-approval-or-override",
  "fintech-urgent-consumer-harm",
  "fintech-untrusted-influence",
] as const;

/** Synthetic and offline: the host has already redacted and hash-bound the note. */
export const example = () => {
  const state = {
    contractVersion: "1",
    advisoryOnly: true,
    execution: "NOT_SUPPORTED",
    purpose: "exception_triage_only",
    caseRef: "ref:offline-case",
    observedAt,
    validUntil: "2026-09-20T10:01:00.000Z",
    maxAgeMs: 60_000,
    evidence: {
      note,
      noteHash: sha256(note),
      sourceHash: `sha256:${"1".repeat(64)}`,
      trust: "untrusted_data_only",
      redaction: "host_redacted",
    },
    candidates,
  };
  const answers: DecisionAnswer[] = questionIds.map((questionId) => ({
    questionId,
    type: "noul",
    value: questionId === "fintech-duplicate-or-reprocessed",
    probabilityYes:
      questionId === "fintech-duplicate-or-reprocessed" ? 0.9 : 0.1,
  }));
  return runOfflineExample({
    name: "fintech-exception",
    pack: fintechExceptionPack,
    state,
    answers,
    negativeState: { ...state, execution: "SUPPORTED" },
    expectedOutcome: "ask",
    expectedSelectedId: "investigate",
    negativeOutcome: "deny",
    nowEpochMs: Date.parse(observedAt) + 500,
  });
};

if (import.meta.main)
  void example().then((value) => console.log(JSON.stringify(value)));

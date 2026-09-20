import { createHash } from "node:crypto";
import { bindFinanceAdvisoryEvidence } from "@mokimeow/jev-fabric-adapters";
import { financeSurveillancePack } from "@mokimeow/jev-fabric-packs";
import { choice, runOfflineExample } from "../shared.js";

const hash = (letter: string) => `sha256:${letter.repeat(64)}`;
const sha256 = (value: string) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const renderer = {
  id: "finance.canonical-svg",
  version: "1",
  schemaVersion: "1",
  mutationPolicyId: "finance.visual-mutations.v1",
} as const;
const observedAt = "2026-09-20T10:00:00.000+00:00";

/** Synthetic and offline: code has already reduced exact market arithmetic. */
export const example = () => {
  const state = bindFinanceAdvisoryEvidence(
    {
      instrumentRef: "ref:synthetic-instrument",
      assetClass: "equity",
      venue: "synthetic-venue",
      sourceId: "offline-fixture",
      sourceHash: hash("a"),
      featureSetId: "surveillance-v1",
      featureSetVersion: "1.0.0",
      featureSetHash: hash("b"),
      observedAt,
      windowStart: "2026-09-20T09:55:00.000+00:00",
      windowEnd: observedAt,
      cutoffAt: observedAt,
      maxAgeMs: 1_000,
      signals: [
        {
          id: "spread-regime",
          bucket: "normal",
          definitionHash: hash("c"),
          evidenceHash: hash("d"),
          asOf: observedAt,
        },
      ],
      visual: {
        mode: "structured_extraction",
        extractorId: "offline-chart-parser",
        extractorVersion: "1.0.0",
        imageHash: hash("e"),
        axesVerified: true,
        sourceBindingHash: hash("f"),
        schemaVersion: "1",
        renderer,
        mutationId: "faithful_render",
        expectedRoute: "observe",
        artifactBindingHash: sha256(
          JSON.stringify({
            expectedRoute: "observe",
            imageHash: hash("e"),
            mutationId: "faithful_render",
            renderer: {
              id: renderer.id,
              mutationPolicyId: renderer.mutationPolicyId,
              schemaVersion: renderer.schemaVersion,
              version: renderer.version,
            },
            schemaVersion: "1",
            sourceBindingHash: hash("f"),
          }),
        ),
      },
    },
    { annotations: ["No discontinuity detected in the bounded window"] },
    Date.parse(observedAt) + 500,
  );
  return runOfflineExample({
    name: "finance-surveillance",
    pack: financeSurveillancePack,
    state,
    answers: [
      choice("finance-route", "observe", [
        "observe",
        "investigate",
        "escalate",
      ]),
      choice("finance-anomaly", "routine", [
        "routine",
        "concerning",
        "unclear",
      ]),
      choice("finance-evidence-quality", "sufficient", [
        "sufficient",
        "conflicted",
        "insufficient",
      ]),
      choice("finance-untrusted-influence", "absent", ["absent", "present"]),
    ],
    negativeState: { ...state, execution: "SUPPORTED" },
    expectedOutcome: "route",
    expectedSelectedId: "observe",
    negativeOutcome: "deny",
    nowEpochMs: Date.parse(observedAt) + 500,
  });
};

if (import.meta.main)
  void example().then((value) => console.log(JSON.stringify(value)));

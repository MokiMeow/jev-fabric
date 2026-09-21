import { routePack } from "@mokimeow/jev-fabric-packs";
import {
  bindToolEnvironmentVisualTextBridgeState,
  toolEnvironmentVisualExtractorProfileHash,
} from "../../packages/adapters/src/visual-extractor-profiles.js";
import { choice, runOfflineExample } from "../shared.js";

const hash = (letter: string) => `sha256:${letter.repeat(64)}`;
const observedAt = "2026-09-20T10:00:00.000+00:00";

/**
 * Offline contract binding only. It supplies no image, host handle, browser,
 * DCC client, action, or authorization channel.
 */
export const example = () => {
  const profile = {
    profileVersion: "1" as const,
    extractorId: "offline-fixed-profile",
    extractorVersion: "1",
    schemaVersion: "1" as const,
    modalities: ["dcc_viewport"] as const,
    maxFindingCount: 1,
    findings: [
      {
        id: "request-structured-state",
        disposition: "requires_structured_state" as const,
      },
    ],
  };
  const visualEvidence = bindToolEnvironmentVisualTextBridgeState(
    {
      environment: "blender",
      adapterId: "offline-dcc-adapter",
      adapterVersion: "1",
      sessionRef: "ref:offline-session",
      workspaceRef: "ref:offline-scene",
      stateHash: hash("a"),
      capabilityManifestHash: hash("b"),
      observedAt,
      observationFreshnessMs: 1_000,
    },
    {
      modality: "dcc_viewport",
      artifactHash: hash("c"),
      extractorId: "offline-fixed-profile",
      extractorVersion: "1",
      schemaVersion: "1",
      capturedAt: "2026-09-20T10:00:00.100+00:00",
      maxAgeMs: 1_000,
      extractorProfileHash: toolEnvironmentVisualExtractorProfileHash(profile),
    },
    profile,
    { annotations: ["A viewport detail remains advisory"] },
    { findingIds: ["request-structured-state"] },
    Date.parse("2026-09-20T10:00:00.200+00:00"),
  );
  return runOfflineExample({
    name: "visual-extractor-profile-advice",
    pack: routePack,
    state: {
      visualEvidence,
      candidates: [
        {
          id: "request-structured-data",
          description: "Request a bounded structured scene observation",
        },
        {
          id: "human-review",
          description: "Ask a human to review the surface",
        },
      ],
    },
    answers: [
      choice("route-choice", "request-structured-data", [
        "request-structured-data",
        "human-review",
        "no_match",
      ]),
    ],
    negativeState: { candidates: [] },
    expectedOutcome: "route",
    expectedSelectedId: "request-structured-data",
    negativeOutcome: "abstain",
  });
};

if (import.meta.main)
  void example().then((value) => console.log(JSON.stringify(value)));

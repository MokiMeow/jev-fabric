import { bindToolEnvironmentVisualObservation } from "../../packages/adapters/src/visual-observation.js";
import { routePack } from "@mokimeow/jev-fabric-packs";
import { choice, runOfflineExample } from "../shared.js";

const hash = (letter: string) => `sha256:${letter.repeat(64)}`;
const observedAt = "2026-09-20T10:00:00.000+00:00";

/** Offline evidence binding only; this does not load, inspect, or control a surface. */
export const example = () => {
  const visualObservation = bindToolEnvironmentVisualObservation(
    {
      environment: "browser",
      adapterId: "offline-browser-adapter",
      adapterVersion: "1",
      sessionRef: "ref:offline-session",
      workspaceRef: "ref:offline-frame",
      stateHash: hash("a"),
      capabilityManifestHash: hash("b"),
      observedAt,
      observationFreshnessMs: 1_000,
    },
    {
      modality: "browser_viewport",
      artifactHash: hash("c"),
      extractorId: "offline-visual-annotation",
      extractorVersion: "1",
      schemaVersion: "1",
      capturedAt: "2026-09-20T10:00:00.100+00:00",
      maxAgeMs: 1_000,
    },
    { annotations: ["A visible label needs structured verification"] },
    Date.parse("2026-09-20T10:00:00.200+00:00"),
  );
  return runOfflineExample({
    name: "visual-observation-advice",
    pack: routePack,
    state: {
      visualObservation,
      candidates: [
        {
          id: "request-structured-data",
          description: "Request a bounded structured observation",
        },
        {
          id: "human-review",
          description: "Ask a human to review the visible evidence",
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

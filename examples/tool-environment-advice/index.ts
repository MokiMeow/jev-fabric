import { routePack } from "@mokimeow/jev-fabric-packs";
import { choice, runOfflineExample } from "../shared.js";

/**
 * This selects advisory text for a declared native action. It imports no tool
 * environment client and cannot inspect, execute, or authorize an operation.
 */
export const example = () =>
  runOfflineExample({
    name: "tool-environment-advice",
    pack: routePack,
    state: {
      environment: "blender",
      stateHash: "sha256:redacted",
      candidates: [
        { id: "inspect", description: "Inspect a declared read-only property" },
        { id: "ask-user", description: "Ask before a persistent operation" },
      ],
    },
    answers: [
      choice("route-choice", "ask-user", ["inspect", "ask-user", "no_match"]),
    ],
    negativeState: { candidates: [] },
    expectedOutcome: "route",
    expectedSelectedId: "ask-user",
    negativeOutcome: "abstain",
  });

if (import.meta.main)
  void example().then((value) => console.log(JSON.stringify(value)));

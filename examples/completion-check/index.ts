import { completionPack } from "@mokimeow/jev-fabric-packs";
import { choice, runOfflineExample } from "../shared.js";

export const example = () =>
  runOfflineExample({
    name: "completion-check",
    pack: completionPack,
    state: {
      claimedChecks: ["unit"],
      observedChecks: ["unit"],
      candidates: [
        { id: "unit", description: "Observed unit test" },
        { id: "review", description: "Observed review" },
      ],
    },
    answers: [
      choice("completion-state", "complete", ["complete", "incomplete"]),
    ],
    negativeState: {
      claimedChecks: ["integration"],
      observedChecks: [],
      candidates: [],
    },
    expectedOutcome: "allow",
    expectedSelectedId: "complete",
    negativeOutcome: "deny",
  });
if (import.meta.main)
  void example().then((value) => console.log(JSON.stringify(value)));

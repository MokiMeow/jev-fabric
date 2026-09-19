import { screenPack } from "@mokimeow/jev-fabric-packs";
import { choice, runOfflineExample } from "../shared.js";

export const example = () =>
  runOfflineExample({
    name: "ci-triage",
    pack: screenPack,
    state: {
      candidates: [
        { id: "build", description: "Build output" },
        { id: "test", description: "Test output" },
      ],
    },
    answers: [
      choice("screen-triage", "accept", ["accept", "reject", "abstain"]),
    ],
    negativeState: { candidates: [] },
    expectedOutcome: "allow",
    expectedSelectedId: "accept",
    negativeOutcome: "abstain",
  });
if (import.meta.main)
  void example().then((value) => console.log(JSON.stringify(value)));

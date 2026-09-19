import { rankPack } from "@mokimeow/jev-fabric-packs";
import { choice, runOfflineExample } from "../shared.js";

export const example = () =>
  runOfflineExample({
    name: "rerank-evidence",
    pack: rankPack,
    state: {
      candidates: [
        { id: "source-a", description: "Primary source" },
        { id: "source-b", description: "Secondary source" },
      ],
    },
    answers: [
      choice("rank-choice", "source-a", ["source-a", "source-b", "no_match"]),
    ],
    negativeState: { candidates: [] },
    expectedOutcome: "allow",
    expectedSelectedId: "source-a",
    negativeOutcome: "abstain",
  });
if (import.meta.main)
  void example().then((value) => console.log(JSON.stringify(value)));

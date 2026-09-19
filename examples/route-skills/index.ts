import { routePack } from "@mokimeow/jev-fabric-packs";
import { choice, runOfflineExample } from "../shared.js";

export const example = () =>
  runOfflineExample({
    name: "route-skills",
    pack: routePack,
    state: {
      candidates: [
        { id: "coding", description: "Code work" },
        { id: "research", description: "Research work" },
      ],
    },
    answers: [
      choice("route-choice", "coding", ["coding", "research", "no_match"]),
    ],
    negativeState: { candidates: [] },
    expectedOutcome: "route",
    expectedSelectedId: "coding",
    negativeOutcome: "abstain",
  });
if (import.meta.main)
  void example().then((value) => console.log(JSON.stringify(value)));

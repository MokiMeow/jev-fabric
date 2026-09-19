import { routePack } from "@mokimeow/jev-fabric-packs";
import { choice, runOfflineExample } from "../shared.js";

export const example = () =>
  runOfflineExample({
    name: "support-triage",
    pack: routePack,
    state: {
      candidates: [
        { id: "billing", description: "Billing team" },
        { id: "technical", description: "Technical team" },
      ],
    },
    answers: [
      choice("route-choice", "technical", ["billing", "technical", "no_match"]),
    ],
    negativeState: { candidates: [] },
    expectedOutcome: "route",
    expectedSelectedId: "technical",
    negativeOutcome: "abstain",
  });
if (import.meta.main)
  void example().then((value) => console.log(JSON.stringify(value)));

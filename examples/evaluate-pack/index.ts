import { progressPack } from "@mokimeow/jev-fabric-packs";
import { choice, runOfflineExample } from "../shared.js";

export const example = () =>
  runOfflineExample({
    name: "evaluate-pack",
    pack: progressPack,
    state: {
      candidates: [
        { id: "started", description: "A task began" },
        { id: "blocked", description: "A task is blocked" },
      ],
    },
    answers: [
      choice("progress-state", "in_progress", [
        "not_started",
        "in_progress",
        "blocked",
      ]),
    ],
    negativeState: { candidates: [] },
    expectedOutcome: "allow",
    expectedSelectedId: "in_progress",
    negativeOutcome: "abstain",
  });
if (import.meta.main)
  void example().then((value) => console.log(JSON.stringify(value)));

import { routePack } from "@mokimeow/jev-fabric-packs";
import { choice, runOfflineExample } from "../shared.js";

/** This only returns advice; a trusted browser executor must separately authorize any action. */
export const example = () =>
  runOfflineExample({
    name: "browser-action-advice",
    pack: routePack,
    state: {
      candidates: [
        { id: "summarize", description: "Summarize visible page" },
        { id: "ask-user", description: "Ask before navigation" },
      ],
    },
    answers: [
      choice("route-choice", "ask-user", ["summarize", "ask-user", "no_match"]),
    ],
    negativeState: { candidates: [] },
    expectedOutcome: "route",
    expectedSelectedId: "ask-user",
    negativeOutcome: "abstain",
  });
if (import.meta.main)
  void example().then((value) => console.log(JSON.stringify(value)));

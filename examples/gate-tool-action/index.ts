import { riskPack } from "@mokimeow/jev-fabric-packs";
import { choice, runOfflineExample } from "../shared.js";

export const example = () =>
  runOfflineExample({
    name: "gate-tool-action",
    pack: riskPack,
    state: {
      candidates: [
        { id: "request", description: "Read-only request" },
        { id: "decline", description: "Decline request" },
      ],
    },
    answers: [
      choice("risk-level", "low", ["low", "high"]),
      choice("risk-authorization", "no", ["no", "yes"]),
      choice("risk-influence", "no", ["no", "yes"]),
    ],
    negativeState: { staticDeny: true, candidates: [] },
    expectedOutcome: "allow",
    negativeOutcome: "deny",
  });
if (import.meta.main)
  void example().then((value) => console.log(JSON.stringify(value)));

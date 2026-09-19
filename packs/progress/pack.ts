import { builtinPack } from "../shared.js";
/** Classifies workflow progress without asserting completion. */
export const progressPack = builtinPack(
  "progress",
  "medium",
  "abstain",
  { outage: "abstain", providerFailure: "abstain" },
  { question: "Classify bounded workflow progress." },
);

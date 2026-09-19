import { builtinPack } from "../shared.js";
/** Cheap triage; empty or stale coverage abstains instead of inventing a pass. */
export const screenPack = builtinPack(
  "screen",
  "medium",
  "abstain",
  { outage: "abstain", providerFailure: "abstain" },
  { question: "Triage the supplied bounded candidates." },
);

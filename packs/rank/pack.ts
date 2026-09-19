import { builtinPack } from "../shared.js";
/** Relative Choice ordering only; it makes no hidden absolute ranking claim. */
export const rankPack = builtinPack(
  "rank",
  "low",
  "no_match",
  { outage: "unavailable", providerFailure: "abstain" },
  {
    question:
      "Select the best candidate relative to the supplied alternatives.",
  },
);

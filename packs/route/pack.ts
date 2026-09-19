import { builtinPack } from "../shared.js";
/** Bounded destination/action routing with explicit no-match. */
export const routePack = builtinPack(
  "route",
  "low",
  "no_match",
  { outage: "unavailable", providerFailure: "abstain" },
  { question: "Select the bounded destination." },
);

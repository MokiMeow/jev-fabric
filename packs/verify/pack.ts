import { builtinPack } from "../shared.js";
/** Checks projected evidence and cannot execute a remediation. */
export const verifyPack = builtinPack(
  "verify",
  "medium",
  "abstain",
  { outage: "unavailable", providerFailure: "abstain" },
  { question: "Verify the bounded assertion using projected evidence." },
);

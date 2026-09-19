import { builtinPack } from "../shared.js";
/** Refuses completion claims containing checks that are not observed evidence. */
export const completionPack = builtinPack(
  "completion",
  "high",
  "abstain",
  { outage: "unavailable", providerFailure: "abstain" },
  {
    bypass: (state) =>
      unsupportedClaim(state)
        ? { outcome: "deny", reasonCode: "UNOBSERVED_COMPLETION_CLAIM" }
        : undefined,
    question: "Determine completion only from declared observed evidence.",
  },
);

function strings(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function unsupportedClaim(state: Record<string, unknown>): boolean {
  const claimed = state.claimedChecks;
  const observed = state.observedChecks;
  return (
    strings(claimed) &&
    strings(observed) &&
    claimed.some((check) => !observed.includes(check))
  );
}

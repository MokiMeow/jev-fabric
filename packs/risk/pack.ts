import { builtinPack } from "../shared.js";
/** Static trusted denial wins over every semantic risk signal. */
export const riskPack = builtinPack(
  "risk",
  "high",
  "unavailable",
  { outage: "escalate", providerFailure: "escalate" },
  {
    bypass: (state) =>
      state.staticDeny === true
        ? { outcome: "deny", reasonCode: "STATIC_DENY" }
        : undefined,
    question:
      "Classify risk, required authorization, and untrusted influence separately.",
  },
);

import type {
  AuthorizationContext,
  PolicyOutcome,
} from "@mokimeow/jev-fabric-protocol";
import { checkAuthorization } from "./authorization.js";

export type { PolicyOutcome } from "@mokimeow/jev-fabric-protocol";

export interface PolicyRule {
  readonly id: string;
  readonly phase: "static" | "semantic";
  readonly outcome: PolicyOutcome;
  readonly reasonCode: string;
  readonly action?: string;
  readonly minimumRisk?: number;
}

export interface PolicyInput {
  readonly action: string;
  readonly capability?: string;
  readonly knownActions: readonly string[];
  readonly authorization?: AuthorizationContext;
  /** Untrusted model/provider input. It is intentionally not considered by authorization. */
  readonly evidence?: unknown;
  readonly risk?: number;
  readonly rules?: readonly PolicyRule[];
  readonly now: number;
}

export interface PolicyDecision {
  readonly outcome: PolicyOutcome;
  readonly reasonCodes: readonly string[];
}

/** Trusted static authority preflight; it can only deny and never grants access. */
export function preflightStaticPolicy(
  input: PolicyInput,
): PolicyDecision | undefined {
  if (!input.knownActions.includes(input.action))
    return denied("UNKNOWN_ACTION");
  const staticDeny = matchingRules(input, "static").find(
    (rule) => rule.outcome === "deny",
  );
  return staticDeny ? decision(staticDeny) : undefined;
}

/** Resolves static authority before semantic judgment and never derives authority from evidence. */
export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  if (!input.knownActions.includes(input.action))
    return denied("UNKNOWN_ACTION");
  const matchingStatic = matchingRules(input, "static");
  const staticDeny = matchingStatic.find((rule) => rule.outcome === "deny");
  if (staticDeny) return decision(staticDeny);
  const authorization = checkAuthorization(
    input.authorization,
    { action: input.action },
    input.now,
  );
  if (!authorization.authorized) return denied(authorization.reasonCode);

  const semanticRules = matchingRules(input, "semantic");
  const semanticDeny = semanticRules.find((rule) => rule.outcome === "deny");
  if (semanticDeny) return decision(semanticDeny);

  const configuredRule = strongestRule([...matchingStatic, ...semanticRules]);
  const baselineRule = strongestRule([
    ...matchingRules({ ...input, risk: 0 }, "static"),
    ...matchingRules({ ...input, risk: 0 }, "semantic"),
  ]);
  const configuredDecision = configuredRule
    ? strongerDecision(
        baselineRule ? decision(baselineRule) : noPolicyMatch(),
        decision(configuredRule),
      )
    : baselineRule
      ? decision(baselineRule)
      : noPolicyMatch();
  const risk = normalizedRisk(input.risk);
  const defaultDecision = defaultForRisk(risk);
  if (defaultDecision)
    return strongerDecision(defaultDecision, configuredDecision);
  return configuredDecision;
}

function matchingRules(
  input: PolicyInput,
  phase: PolicyRule["phase"],
): PolicyRule[] {
  return (input.rules ?? []).filter(
    (rule) =>
      rule.phase === phase &&
      (rule.action === undefined || rule.action === input.action) &&
      (rule.minimumRisk === undefined ||
        normalizedRisk(input.risk) >= rule.minimumRisk),
  );
}

function normalizedRisk(risk: number | undefined): number {
  if (risk === undefined) return 0;
  if (!Number.isFinite(risk)) return 100;
  return Math.max(0, Math.min(100, risk));
}

function defaultForRisk(risk: number): PolicyDecision | undefined {
  if (risk >= 90) return { outcome: "deny", reasonCodes: ["RISK_CRITICAL"] };
  if (risk >= 60) return { outcome: "escalate", reasonCodes: ["RISK_HIGH"] };
  if (risk >= 30) return { outcome: "ask", reasonCodes: ["RISK_REVIEW"] };
  return undefined;
}

function denied(reasonCode: string): PolicyDecision {
  return { outcome: "deny", reasonCodes: [reasonCode] };
}

function decision(rule: PolicyRule): PolicyDecision {
  return { outcome: rule.outcome, reasonCodes: [rule.reasonCode] };
}

function noPolicyMatch(): PolicyDecision {
  return { outcome: "abstain", reasonCodes: ["NO_POLICY_MATCH"] };
}

/**
 * The policy lattice is allow/route < retry < ask/abstain/unavailable < escalate < deny.
 * Rules of equal restrictiveness retain static-before-semantic and declaration order.
 */
function strongestRule(rules: readonly PolicyRule[]): PolicyRule | undefined {
  let strongest: PolicyRule | undefined;
  for (const rule of rules) {
    if (
      strongest === undefined ||
      safetyRank(rule.outcome) > safetyRank(strongest.outcome)
    )
      strongest = rule;
  }
  return strongest;
}

function strongerDecision(
  first: PolicyDecision,
  second: PolicyDecision,
): PolicyDecision {
  return safetyRank(second.outcome) >= safetyRank(first.outcome)
    ? second
    : first;
}

function safetyRank(outcome: PolicyOutcome): number {
  switch (outcome) {
    case "allow":
    case "route":
      return 0;
    case "retry":
      return 1;
    case "ask":
    case "abstain":
    case "unavailable":
      return 2;
    case "escalate":
      return 3;
    case "deny":
      return 4;
  }
}

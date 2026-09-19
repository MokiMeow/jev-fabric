import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  evaluatePolicy,
  type AuthorizationContext,
  type PolicyOutcome,
  type PolicyRule,
} from "../src/index.js";

const authorization: AuthorizationContext = {
  principalId: "user-1",
  tenantId: "tenant-1",
  workspaceId: "workspace-1",
  resourceScopes: ["project:read"],
  actionScopes: ["deploy", "read"],
  permissionEpoch: "permission-1",
  approvalReferences: ["approval-1"],
  expiresAt: "2030-01-01T00:00:00.000Z",
};

const input = {
  action: "deploy",
  knownActions: ["deploy", "read"],
  authorization,
  now: Date.parse("2029-01-01T00:00:00.000Z"),
};

describe("deterministic policy", () => {
  it("makes a matching static deny win over semantic allowance", () => {
    const rules: readonly PolicyRule[] = [
      {
        id: "semantic-allow",
        phase: "semantic",
        outcome: "allow",
        reasonCode: "MODEL_ALLOW",
      },
      {
        id: "static-deny",
        phase: "static",
        outcome: "deny",
        reasonCode: "DESTINATION_DENIED",
      },
    ];

    expect(evaluatePolicy({ ...input, rules })).toEqual({
      outcome: "deny",
      reasonCodes: ["DESTINATION_DENIED"],
    });
  });

  it("reports a matching static deny even when the supplied authority is absent", () => {
    expect(
      evaluatePolicy({
        action: "deploy",
        knownActions: ["deploy"],
        now: Date.parse("2029-01-01T00:00:00.000Z"),
        rules: [
          {
            id: "static-deny",
            phase: "static",
            outcome: "deny",
            reasonCode: "DESTINATION_DENIED",
          },
        ],
      }),
    ).toEqual({ outcome: "deny", reasonCodes: ["DESTINATION_DENIED"] });
  });

  it("makes a semantic deny win over a semantic allow", () => {
    expect(
      evaluatePolicy({
        ...input,
        rules: [
          {
            id: "semantic-allow",
            phase: "semantic",
            outcome: "allow",
            reasonCode: "MODEL_ALLOW",
          },
          {
            id: "semantic-deny",
            phase: "semantic",
            outcome: "deny",
            reasonCode: "MODEL_DENY",
          },
        ],
      }),
    ).toEqual({ outcome: "deny", reasonCodes: ["MODEL_DENY"] });
  });

  it("returns every explicit outcome with its rule reason code", () => {
    const outcomes: readonly PolicyOutcome[] = [
      "allow",
      "deny",
      "ask",
      "route",
      "retry",
      "escalate",
      "abstain",
      "unavailable",
    ];

    for (const outcome of outcomes) {
      expect(
        evaluatePolicy({
          ...input,
          rules: [
            {
              id: `semantic-${outcome}`,
              phase: "semantic",
              outcome,
              reasonCode: `REASON_${outcome.toUpperCase()}`,
            },
          ],
        }),
      ).toEqual({
        outcome,
        reasonCodes: [`REASON_${outcome.toUpperCase()}`],
      });
    }
  });

  it("fails closed for an unknown action before model evidence", () => {
    expect(
      evaluatePolicy({
        ...input,
        action: "unknown-action",
        evidence: { actionScopes: ["unknown-action"], allow: true },
        rules: [
          {
            id: "model-says-allow",
            phase: "semantic",
            outcome: "allow",
            reasonCode: "MODEL_ALLOW",
          },
        ],
      }),
    ).toEqual({
      outcome: "deny",
      reasonCodes: ["UNKNOWN_ACTION"],
    });
  });

  it("keeps every static deny denied for arbitrary model evidence", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (evidence) => {
        expect(
          evaluatePolicy({
            ...input,
            evidence,
            rules: [
              {
                id: "always-deny",
                phase: "static",
                outcome: "deny",
                reasonCode: "STATIC_DENY",
              },
              {
                id: "model-allow",
                phase: "semantic",
                outcome: "allow",
                reasonCode: "MODEL_ALLOW",
              },
            ],
          }).outcome,
        ).toBe("deny");
      }),
    );
  });

  it("does not let arbitrary evidence create authorization", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (evidence) => {
        expect(
          evaluatePolicy({
            action: "deploy",
            knownActions: ["deploy"],
            evidence,
            now: Date.parse("2029-01-01T00:00:00.000Z"),
            rules: [
              {
                id: "model-allow",
                phase: "semantic",
                outcome: "allow",
                reasonCode: "MODEL_ALLOW",
              },
            ],
          }),
        ).toEqual({
          outcome: "deny",
          reasonCodes: ["AUTHORIZATION_REQUIRED"],
        });
      }),
    );
  });

  it("never weakens the default outcome as risk increases", () => {
    const safetyRank: Record<PolicyOutcome, number> = {
      allow: 0,
      route: 0,
      retry: 1,
      ask: 2,
      abstain: 2,
      unavailable: 2,
      escalate: 3,
      deny: 4,
    };
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (risk) => {
        const lower = evaluatePolicy({ ...input, risk }).outcome;
        const higher = evaluatePolicy({
          ...input,
          risk: Math.min(100, risk + 1),
        }).outcome;
        expect(safetyRank[higher]).toBeGreaterThanOrEqual(safetyRank[lower]);
      }),
    );
  });

  it("keeps a matching configured deny at every risk level", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (risk) => {
        expect(
          evaluatePolicy({
            ...input,
            risk,
            rules: [
              {
                id: "configured-deny",
                phase: "semantic",
                outcome: "deny",
                reasonCode: "CONFIGURED_DENY",
              },
            ],
          }),
        ).toEqual({ outcome: "deny", reasonCodes: ["CONFIGURED_DENY"] });
      }),
    );
  });

  it("does not let a configured static allow weaken high-risk defaults", () => {
    fc.assert(
      fc.property(fc.integer({ min: 30, max: 100 }), (risk) => {
        expect(
          evaluatePolicy({
            ...input,
            risk,
            rules: [
              {
                id: "configured-allow",
                phase: "static",
                outcome: "allow",
                reasonCode: "CONFIGURED_ALLOW",
              },
            ],
          }).outcome,
        ).not.toBe("allow");
      }),
    );
  });

  it("does not weaken a configured escalation when risk rises", () => {
    expect(
      evaluatePolicy({
        ...input,
        risk: 30,
        rules: [
          {
            id: "configured-escalation",
            phase: "semantic",
            outcome: "escalate",
            reasonCode: "CONFIGURED_ESCALATION",
          },
        ],
      }),
    ).toEqual({
      outcome: "escalate",
      reasonCodes: ["CONFIGURED_ESCALATION"],
    });
  });

  it("is monotonic while minimum-risk rules accumulate across phases and order", () => {
    const outcomes: readonly PolicyOutcome[] = [
      "allow",
      "deny",
      "ask",
      "route",
      "retry",
      "escalate",
      "abstain",
      "unavailable",
    ];
    const safetyRank: Record<PolicyOutcome, number> = {
      allow: 0,
      route: 0,
      retry: 1,
      ask: 2,
      abstain: 2,
      unavailable: 2,
      escalate: 3,
      deny: 4,
    };
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            phase: fc.constantFrom<PolicyRule["phase"]>("static", "semantic"),
            outcome: fc.constantFrom(...outcomes),
            minimumRisk: fc.option(fc.integer({ min: 0, max: 100 }), {
              nil: undefined,
            }),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        (generated) => {
          const rules: PolicyRule[] = generated.map((rule, index) => ({
            id: `rule-${index}`,
            phase: rule.phase,
            outcome: rule.outcome,
            reasonCode: `RULE_${index}`,
            ...(rule.minimumRisk === undefined
              ? {}
              : { minimumRisk: rule.minimumRisk }),
          }));
          let previous = -1;
          for (let risk = 0; risk <= 100; risk += 1) {
            const outcome = evaluatePolicy({ ...input, risk, rules }).outcome;
            expect(safetyRank[outcome]).toBeGreaterThanOrEqual(previous);
            previous = safetyRank[outcome];
          }
        },
      ),
    );
  });
});

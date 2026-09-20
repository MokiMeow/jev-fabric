import {
  BudgetLedger,
  DecisionScheduler,
  FabricRuntime,
  MemoryDecisionCache,
  definePack,
} from "@mokimeow/jev-fabric-core";
import {
  createVercelGatewayJevProvider,
  VERCEL_GATEWAY_JEV_MODEL,
} from "@mokimeow/jev-fabric-provider-typesafe";

const gatewayRoutePack = definePack(
  {
    id: "gateway-native-route",
    version: "1.0.0",
    riskTier: "low",
    limits: {
      maxStateBytes: 4_096,
      maxStateDepth: 4,
      maxStateItems: 20,
      maxStringBytes: 1_024,
      maxCandidates: 2,
      maxCandidateIdLength: 32,
      maxCandidateDescriptionBytes: 1_024,
    },
    candidateBehavior: "no_match",
    failure: { outage: "unavailable", providerFailure: "abstain" },
    requiredCapabilities: {
      questionTypes: ["choice"],
      probabilitySemantics: ["native_calibrated"],
    },
    evidence: { projectorId: "gateway-native-demo", revision: "1" },
  },
  {
    projector: { project: (state) => state },
    candidates: {
      provide: (state) =>
        (state as { candidates: { id: string; description: string }[] })
          .candidates,
    },
    questions: () => [
      {
        id: "route-choice",
        type: "choice",
        instructions: { task: "select one declared route" },
        criteria: { docs: "Documentation", code: "Code" },
        options: ["docs", "code"],
      },
    ],
    interpret: (answers) => ({
      status: "decision",
      proposedOutcome: "route",
      selectedId:
        answers[0]?.type === "choice" ? answers[0].selected : undefined,
      metadata: {},
    }),
  },
);

/**
 * A server-side Vercel Gateway composition with injected I/O. The example is
 * deliberately offline: the API key placeholder is never used by the fake
 * client and no network call is made.
 */
export async function example() {
  const provider = createVercelGatewayJevProvider({
    apiKey: "trusted-server-secret-reference",
    client: {
      systemOne: async () => ({
        model: VERCEL_GATEWAY_JEV_MODEL,
        usage: { input_tokens: 4, output_tokens: 0 },
        answers: {
          "route-choice": {
            type: "choice",
            choice: "docs",
            probabilities: { docs: 0.9, code: 0.1 },
            confidence: 0.9,
          },
        },
      }),
    },
  });
  const runtime = new FabricRuntime({
    provider,
    model: VERCEL_GATEWAY_JEV_MODEL,
    cache: new MemoryDecisionCache({ maxEntries: 8 }),
    scheduler: new DecisionScheduler({
      providerConcurrency: 1,
      tenantConcurrency: 1,
      maxQueue: 2,
      budget: new BudgetLedger({ requests: 1, tokens: 100 }),
    }),
    estimatedTokens: 10,
    retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 },
  });
  return runtime.evaluate({
    pack: gatewayRoutePack,
    state: {
      candidates: [
        { id: "docs", description: "Documentation" },
        { id: "code", description: "Code" },
      ],
    },
    tenantId: "server-tenant",
    action: "route",
    knownActions: ["route"],
    authorization: {
      principalId: "server-principal",
      tenantId: "server-tenant",
      workspaceId: "server-workspace",
      resourceScopes: ["*"],
      actionScopes: ["route"],
      permissionEpoch: "epoch-1",
      approvalReferences: [],
      expiresAt: "2030-01-01T00:00:00.000Z",
    },
    deadlineMs: 1_000,
  });
}

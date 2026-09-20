import {
  BudgetLedger,
  DecisionScheduler,
  FabricRuntime,
  MemoryDecisionCache,
} from "@mokimeow/jev-fabric-core";
import { routePack } from "@mokimeow/jev-fabric-packs";
import { OpenAICompatibleProvider } from "@mokimeow/jev-fabric-provider-openai-compatible";

/** An endpoint-pinned, injected-transport composition. It makes no network call. */
export async function example() {
  const provider = new OpenAICompatibleProvider({
    id: "compatible-server",
    endpoint: "https://models.example.test/v1/chat/completions",
    model: "pinned-compatible-model",
    // Resolve a real credential in trusted server startup code; never copy it
    // into configuration, examples, receipts, or logs.
    headers: { "x-credential-source": "injected-server-runtime" },
    resolve: async () => ["8.8.8.8"],
    repairAttempts: 0,
    maxRedirects: 0,
    transport: {
      execute: async () =>
        new Response(
          JSON.stringify({
            model: "pinned-compatible-model",
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    answers: [
                      {
                        questionId: "route-choice",
                        type: "choice",
                        selected: "docs",
                        probabilities: {
                          docs: 0.9,
                          code: 0.05,
                          no_match: 0.05,
                        },
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        ),
    },
  });
  const runtime = new FabricRuntime({
    provider,
    model: "pinned-compatible-model",
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
    pack: routePack,
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

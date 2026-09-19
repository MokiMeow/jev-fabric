import {
  BudgetLedger,
  DecisionScheduler,
  FabricRuntime,
  MemoryDecisionCache,
  ScriptedProvider,
  type DecisionPack,
} from "@mokimeow/jev-fabric-core";
import {
  decisionReceiptSchema,
  type DecisionAnswer,
} from "@mokimeow/jev-fabric-protocol";

export interface OfflineExample {
  readonly name: string;
  readonly pack: DecisionPack;
  readonly state: Record<string, unknown>;
  readonly answers: readonly DecisionAnswer[];
  readonly negativeState: Record<string, unknown>;
  readonly expectedOutcome: string;
  readonly expectedSelectedId?: string;
  readonly negativeOutcome: string;
}

/** Runs one bounded, offline decision and proves its fail-closed companion path. */
export async function runOfflineExample(example: OfflineExample) {
  let positiveCalls = 0;
  const provider = new ScriptedProvider({
    id: "example-scripted",
    model: "example-scripted-v1",
    steps: [{ answers: example.answers }],
    onAttempt: () => {
      positiveCalls += 1;
    },
  });
  const runtime = runtimeFor(provider);
  const result = await runtime.evaluate({
    pack: example.pack,
    state: example.state,
    tenantId: "example",
    action: "advice",
    knownActions: ["advice"],
    authorization: authorization(),
  });
  const receipt = decisionReceiptSchema.parse(result.receipt);
  if (receipt.outcome !== example.expectedOutcome)
    throw new Error(
      `${example.name}: ${receipt.outcome} ${receipt.reasonCodes.join(",")}`,
    );
  if ("state" in receipt || !receipt.redacted)
    throw new Error(`${example.name}: receipt must be redacted and state-free`);
  if (
    positiveCalls !== 1 ||
    result.semantic.status !== "decision" ||
    result.semantic.selectedId !== example.expectedSelectedId
  )
    throw new Error(
      `${example.name}: positive path was not the expected decision`,
    );

  // A separate zero-step provider proves the negative path did not quietly call
  // a model. Empty candidates are handled deterministically by every built-in pack.
  let calls = 0;
  const negativeProvider = new ScriptedProvider({
    id: "negative-scripted",
    model: "negative-scripted-v1",
    steps: [],
    onAttempt: () => {
      calls += 1;
    },
  });
  const negative = await runtimeFor(negativeProvider).evaluate({
    pack: example.pack,
    state: example.negativeState,
    tenantId: "example",
    action: "advice",
    knownActions: ["advice"],
    authorization: authorization(),
  });
  decisionReceiptSchema.parse(negative.receipt);
  if (calls !== 0 || negative.receipt.outcome !== example.negativeOutcome)
    throw new Error(`${example.name}: negative path did not fail closed`);
  return {
    name: example.name,
    positiveCalls,
    semantic: result.semantic,
    receipt,
    negativeCalls: calls,
    negativeReceipt: negative.receipt,
  };
}

function authorization() {
  return {
    principalId: "example-principal",
    tenantId: "example",
    workspaceId: "example-workspace",
    resourceScopes: ["*"],
    actionScopes: ["advice"],
    permissionEpoch: "epoch-1",
    approvalReferences: [],
    expiresAt: "2030-01-01T00:00:00.000Z",
  } as const;
}

function runtimeFor(provider: ScriptedProvider): FabricRuntime {
  return new FabricRuntime({
    provider,
    model: "example-scripted-v1",
    cache: new MemoryDecisionCache({ maxEntries: 8 }),
    scheduler: new DecisionScheduler({
      providerConcurrency: 1,
      tenantConcurrency: 1,
      maxQueue: 4,
      budget: new BudgetLedger({ requests: 8, tokens: 1000 }),
    }),
  });
}

export function choice(
  questionId: string,
  selected: string,
  options: readonly string[],
): DecisionAnswer {
  const remainder = options.length - 1;
  return {
    questionId,
    type: "choice",
    selected,
    probabilities: Object.fromEntries(
      options.map((option) => [
        option,
        option === selected ? 0.8 : 0.2 / remainder,
      ]),
    ),
  };
}

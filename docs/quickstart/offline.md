# Offline quickstart

This route validates your installation without a provider credential, network request, browser action, or model-selected command. It is the recommended first ten minutes.

## Prerequisites and cost boundary

- Node.js `>=22.14 <25`.
- A local clone or locally packed artifacts for all `@mokimeow/jev-fabric-*` packages.
- No TypeSafe key is required. Do not use an exposed or copied key.

The offline provider is deterministic scripted test data. Its outputs demonstrate interfaces, not provider accuracy, latency, or cost.

## Route A: run from a checkout

```sh
npm exec --yes pnpm@12.4.2 -- install --offline
npm exec --yes pnpm@12.4.2 -- build
npm exec --yes pnpm@12.4.2 -- --filter @mokimeow/jev-fabric-cli exec jev-fabric doctor --json
npm exec --yes pnpm@12.4.2 -- --filter @mokimeow/jev-fabric-cli exec jev-fabric evaluate --json
```

Expected: `doctor` reports `network: not_used`; `evaluate` reports `mode: offline` and `evidence: unit`.

## Route B: clean project from pre-publication packed artifacts

This is available before public npm publication. In the checkout, build and
stage exact tarballs with `node scripts/pack-smoke.mjs --artifacts-dir
packed-artifacts`. That command writes a durable self-contained consumer
fixture at `packed-artifacts/consumer-fixture/` (and refuses to overwrite one).
Enter that generated directory, which already contains `package.json`,
`tarballs/`, and `.npmrc`; then run these exact commands:

```sh
cd packed-artifacts/consumer-fixture
npm install --offline --ignore-scripts
npx --no-install jev-fabric doctor --json
npx --no-install jev-fabric evaluate --json
```

The fixture pins the Jev Fabric and required runtime-dependency tarballs using
`file:` references, so it never consults a registry. After
publication, install `@mokimeow/jev-fabric-cli` using your normal package
workflow and run `jev-fabric doctor --json` before adding any host artifact.

## Make one embedded decision

```ts
import { ScriptedProvider, FabricRuntime, MemoryDecisionCache, DecisionScheduler, BudgetLedger } from "@mokimeow/jev-fabric-core";
import { routePack } from "@mokimeow/jev-fabric-packs";

const provider = new ScriptedProvider({
  id: "demo", model: "demo-v1",
  steps: [{ answers: [{ questionId: "route-choice", type: "choice", selected: "docs", probabilities: { docs: 0.8, code: 0.1, no_match: 0.1 } }] }],
});
const runtime = new FabricRuntime({
  provider, model: "demo-v1", cache: new MemoryDecisionCache({ maxEntries: 16 }),
  scheduler: new DecisionScheduler({ providerConcurrency: 1, tenantConcurrency: 1, maxQueue: 4, budget: new BudgetLedger({ requests: 4, tokens: 1000 }) }),
});
const result = await runtime.evaluate({
  pack: routePack, tenantId: "demo", action: "advice", knownActions: ["advice"],
  // A deliberately minimal host-owned fixture. A provider answer never creates it.
  authorization: {
    principalId: "demo-principal", tenantId: "demo", workspaceId: "demo-workspace",
    resourceScopes: ["*"], actionScopes: ["advice"], permissionEpoch: "epoch-1",
    approvalReferences: [], expiresAt: "2030-01-01T00:00:00.000Z",
  },
  state: { candidates: [{ id: "docs", description: "Documentation" }, { id: "code", description: "Code" }] },
});
console.log(result.receipt.outcome); // route
```

The output is exactly `route` for this fixture. The authorization object is trusted host input solely to make the runnable demo complete; replace it with authenticated, current host context in an application. The receipt is provenance. A host must still apply its authorization and execution checks.

## Enable a live provider later

Keep credentials server-side. The explicit administrator-only native overlay is
documented in [TypeSafe native live operation](../providers/typesafe-native.md).
It requires `serve --transport stdio --live`, an exact pinned model, an
environment-variable name for the credential, trusted operator tenant/action,
request/token/dollar/deadline limits, and an input-price admission ceiling.
Read [live boundaries](../security/boundaries.md) before implementation.

Troubleshooting is in [the reference](../reference/troubleshooting.md).

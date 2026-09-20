# Vercel AI Gateway Jev

Vercel AI Gateway exposes Jev through an official
[TypeSafe-compatible API](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe).
Jev Fabric reuses its strict TypeSafe request and response mapping and fixes all
transport identity values:

| Field | Fixed value |
| --- | --- |
| Base URL | `https://ai-gateway.vercel.sh/typesafe` |
| Model | `typesafe-ai/jev` |
| Fabric provider ID | `typesafe-vercel-gateway` |

The factory has no endpoint, model, provider-ID, browser, or ambient-credential
override. The host resolves an AI Gateway API key or Vercel OIDC token through
its own secret manager and passes it explicitly at trusted server startup:

```ts
import { createVercelGatewayJevProvider } from "@mokimeow/jev-fabric-provider-typesafe";

const gatewayCredential = trustedSecretManager.require("AI_GATEWAY_API_KEY");
const provider = createVercelGatewayJevProvider({
  "apiKey": gatewayCredential,
});
```

Use the complete offline
[Gateway composition example](../../examples/provider-gateway-typesafe-fake/index.ts)
for runtime, budget, retry, deadline, and authorization wiring. Its injected
client makes no network request.

## Promotion and pricing

Vercel's [current Jev model page](https://vercel.com/ai-gateway/models/jev)
lists promotional free pricing ending **September 25, 2026**. That is a dated
external promotion, not a repository guarantee. Check the live model page and
your team billing before each live run. Fabric does not hard-code `free`, infer
a dollar budget from a promotion, or let a provider dashboard replace its local
request/token/deadline ledger.

## Operational boundary

- Keep Gateway credentials server-side; never place them in browser code,
  generated agent configuration, receipts, examples, or source control.
- Fabric disables hidden SDK retries. Its scheduler owns retries, concurrency,
  and accounting.
- Returned model identity must still be exactly `typesafe-ai/jev`; aliases or
  downgrade strings fail closed.
- Gateway metadata, cost fields, raw state, and keys do not enter the decision
  receipt.
- Provider probabilities remain advisory `native_calibrated` semantics. They do
  not prove correctness, permission, safety, or local threshold calibration.
- This server-side factory is intentionally not a general browser provider or
  an additional CLI live mode.

Vercel also documents an AI SDK 7
[evaluation API](https://vercel.com/docs/ai-gateway/getting-started/evaluation)
for greenfield applications. Fabric uses the compatible TypeSafe endpoint
because it preserves the adapter's already-tested `systemOne` shapes and avoids
duplicating an experimental mapping layer.

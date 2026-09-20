# Vercel AI Gateway Jev

Evidence: official Vercel documentation and model page, revalidated 2026-09-21.
Transport contract version: the fixed endpoint and model identity below; pricing
remains external mutable evidence.

- Evidence class: dated external provider metadata, not benchmark output.
- Cases/sample denominator: not applicable; no live request was run for these
  pricing statements.
- Hardware/region: not applicable; no machine execution is claimed.
- limitation: availability, eligibility, rate limits, and price can change. See
  the repository's [`NOT RUN` benchmark contract](../../benchmarks/finance/README.md)
  for the separate performance-evidence boundary.

Vercel AI Gateway exposes Jev through an official
[TypeSafe-compatible API](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe).
It also exposes a native
[Evaluation HTTP API](https://vercel.com/docs/ai-gateway/modalities/evaluation).
Jev Fabric fixes both transport contracts:

| Route | Fixed URL | Fabric provider ID |
| --- | --- | --- |
| TypeSafe-compatible | `https://ai-gateway.vercel.sh/typesafe/v1/systemone` | `typesafe-vercel-gateway` |
| Evaluation | `https://ai-gateway.vercel.sh/v1/evaluate` | `typesafe-vercel-gateway-evaluate` |

Both routes fix the model to `typesafe-ai/jev`.

The installed TypeSafe SDK appends `/v1/systemone`, so the resulting request is
`POST https://ai-gateway.vercel.sh/typesafe/v1/systemone`. An offline loopback
wire-contract test verifies that exact suffix, bearer authentication, and the
`typesafe-ai/jev` request model without sending a credential to Vercel.

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

For the native Evaluation route, use the separate factory:

```ts
import { createVercelGatewayEvaluationJevProvider } from "@mokimeow/jev-fabric-provider-typesafe";

const gatewayCredential = trustedSecretManager.require("AI_GATEWAY_API_KEY");
const provider = createVercelGatewayEvaluationJevProvider({
  "apiKey": gatewayCredential,
});
```

Every Evaluation request fixes these Gateway options:

```json
{
  "zeroDataRetention": true,
  "disallowPromptTraining": true,
  "only": ["typesafe-ai"]
}
```

The adapter converts Fabric `noul` questions to Gateway `boolean` questions,
validates exact answer coverage, distributions, confidence metadata when present,
model and provider routing, and hashes the bounded Gateway generation ID. It
discards the raw generation ID and provider-reported cost strings. Gateway's
documented Score example rounds its displayed score separately from its rung
probabilities, so the adapter accepts at most a documented hundredth-point
presentation difference and derives Fabric's canonical normalized score from the
validated distribution. Requested privacy controls are not proof of account
eligibility or provider compliance: a rejected request fails normally, and the
host must keep its own contractual and audit evidence.

Use the offline
[Gateway response-mapping simulation](../../examples/provider-gateway-typesafe-fake/index.ts)
for runtime, budget, retry, deadline, and authorization wiring. It deliberately
uses the generic provider's injected client because the production Gateway
factory exposes no client or endpoint override.

## Promotion and pricing

Vercel's [current Jev model page](https://vercel.com/ai-gateway/models/jev)
lists promotional free pricing ending **September 25, 2026**. That is a dated
external promotion, not a repository guarantee. Check the live model page and
your team billing before each live run. Fabric does not hard-code `free`, infer
a dollar budget from a promotion, or let a provider dashboard replace its local
request/token/deadline ledger.

This model-specific promotion is separate from Vercel's general
[AI Gateway free tier](https://vercel.com/docs/ai-gateway/pricing), which
currently documents $5 of monthly credit for eligible models with lower rate
limits. Neither entitlement is assumed by code or benchmark accounting.

## Operational boundary

- Keep Gateway credentials server-side; never place them in browser code,
  generated agent configuration, receipts, examples, or source control.
- Fabric disables hidden SDK retries. Its scheduler owns retries, concurrency,
  and accounting.
- Returned model identity must still be exactly `typesafe-ai/jev`; aliases or
  downgrade strings fail closed.
- The Evaluation adapter additionally requires response-reported
  `originalModelId` and `canonicalSlug` to remain `typesafe-ai/jev`, and both
  provider fields to remain `typesafe-ai`.
- Gateway metadata, cost fields, raw state, and keys do not enter the decision
  receipt.
- Provider probabilities remain advisory `native_calibrated` semantics. They do
  not prove correctness, permission, safety, or local threshold calibration.
- This server-side factory is intentionally not a general browser provider or
  an additional CLI live mode.

### Team-wide routing rules

Vercel's [routing rules](https://vercel.com/docs/ai-gateway/models-and-providers/routing-rules)
can rewrite a requested model for every request made with a team's credentials,
without an application-code change. That is useful for general model routing,
but it crosses Fabric's calibrated-model boundary:

- do not configure a rewrite whose source is `typesafe-ai/jev` for a Fabric
  credential;
- isolate the credential in a team/project where model and provider allowlists
  admit only the intended Jev route, and audit routing-rule changes outside the
  application;
- the adapter rejects a response whose reported model is outside its exact
  allowlist, but this response check is not a substitute for controlling the
  Gateway account configuration;
- retain the requested transport route and the response-reported model as
  separate benchmark provenance. Never infer either value from the other.

This matters even when a replacement exposes the same response shape: a
different model has a different calibration population, so its probabilities
cannot inherit Jev's semantics or a locally fitted threshold.

Vercel also documents AI SDK 7 and HTTP
[Evaluation APIs](https://vercel.com/docs/ai-gateway/modalities/evaluation).
Fabric supports both Gateway surfaces deliberately: use the compatible TypeSafe
endpoint for existing `systemOne` integrations, or the separate pinned Evaluation
factory when an application uses `/v1/evaluate`. They have distinct provider IDs
and response mappers so benchmark provenance never conflates the two routes.

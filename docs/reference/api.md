# API reference
Public packages:

| Package | Responsibility |
| --- | --- |
| `@mokimeow/jev-fabric-protocol` | strict question, answer, response, receipt, provider, and tool-environment contracts |
| `@mokimeow/jev-fabric-core` | runtime, cache, scheduler, policy, redaction, receipts, tickets, scripted provider |
| `@mokimeow/jev-fabric-packs` | eight trusted built-in packs and fixtures |
| `@mokimeow/jev-fabric-provider-typesafe` | native TypeSafe and fixed Vercel Gateway TypeSafe-compatible adapters |
| `@mokimeow/jev-fabric-provider-openai-compatible` | administrator-configured compatible adapter |
| `@mokimeow/jev-fabric-evals` | offline evaluation, manifests, replay, and reports |
| `@mokimeow/jev-fabric-mcp` | advisory MCP server and bounded loopback handler |
| `@mokimeow/jev-fabric-cli` | terminal commands and adapter contract |
| `@mokimeow/jev-fabric-adapters` | canonical host layouts, validators, experimental WebMCP binding, and finance evidence boundary |

The core entry point is `new FabricRuntime(options).evaluate(input)`. Inputs require a trusted `pack`, `tenantId`, `action`, `knownActions`, state, and optionally trusted authorization/risk/policy/signal/deadline. Outputs include semantic data, a redacted receipt, and accounting. `createNativeJevProvider` exports the pinned native model factory. `createVercelGatewayJevProvider` fixes the official TypeSafe-compatible Gateway URL and `typesafe-ai/jev` identity. Both require an explicit server-side key or injected test client and do not read ambient credentials. The compatible adapter remains a trusted-host programmatic integration, not a CLI live option. `bindWebMcpAdvisory` emits fingerprints only and cannot invoke a browser tool. Read the TypeScript declarations as the exact alpha API; semver pre-1.0 changes may occur.

A pack's `interpret` callback receives an optional third
`PackInterpretContext` argument containing the validated response's actual
`providerId`, `model`, and `probabilitySemantics`. The runtime supplies it for
both live and cached responses. Packs that use confidence thresholds must
check this context and fail closed when it is absent or the semantics do not
match their versioned calibration evidence; a threshold calibrated for native
Jev confidence must not be reused for normalized logits, self-reported values,
synthetic fixtures, or another model/route.

Every `StateProjector.project` call receives a frozen `StateProjectContext`
with the runtime's trusted evaluation-start `nowEpochMs`. Projectors must use
this clock, not provider-visible state, for freshness decisions. Projection
happens before cache lookup; the finance pack therefore rejects an expired
advisory state without reading or populating the cache and without dispatching
a provider request.

Tool-environment schemas are structural validators, not authority. Use
`validateToolEnvironmentSnapshot(input, trustedCatalogue)` and
`validateToolEnvironmentProposal(proposal, snapshot, trustedCatalogue,
observedNowMs)` with a code-reviewed catalogue that untrusted inputs cannot
modify. The latter returns the exact validated action only after identity,
state, capability-manifest, freshness, and positive-catalogue checks pass.

`bindFinanceAdvisoryEvidence(trustedProjection, visualEvidence, observedNowMs)`
validates source/feature hashes, time ordering, age, per-signal cutoff, and an
optional structured visual-extractor binding.
`bindFinanceAdvisoryEvidenceWithText(trustedProjection, visualEvidence,
textEvidence, observedNowMs)` adds one to eight source-bound text candidates;
trusted ids and per-excerpt hashes must match the untrusted strings exactly.
`FinanceAdvisoryBoundaryError.code` exposes stable failure categories. Both
binders emit only opaque references, semantic buckets, bounded untrusted data,
and the three advisory finance candidates. They have no order or execution API.
The emitted state binds `expiresAt` to `observedAt + maxAgeMs`; its visual state
also requires the canonical renderer/mutation/route artifact seal. The finance
pack rechecks those bindings and every text-candidate hash at its direct public
projector boundary.
Pass the result to `financeSurveillancePack`; preserve the separate host
authorization and execution boundary described in the
[finance guide](../integrations/finance.md).

`aggregateFinanceBenchmarkTraces(traces)` in
`@mokimeow/jev-fabric-evals` strictly aggregates retained finance traces into
the three-by-four benchmark matrix. It rejects duplicates, incomplete cells,
unsafe attempts, malformed distributions, and dishonest token/cost accounting.
Route-question calibration is reported only when that exact distribution was
measured; unavailable calibration and accounting remain explicit.

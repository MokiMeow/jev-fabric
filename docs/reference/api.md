# API reference
Public packages:

| Package | Responsibility |
| --- | --- |
| `@mokimeow/jev-fabric-protocol` | strict question, answer, response, receipt, provider, and tool-environment contracts |
| `@mokimeow/jev-fabric-core` | runtime, cache, scheduler, policy, redaction, receipts, tickets, scripted provider |
| `@mokimeow/jev-fabric-packs` | nine trusted built-in packs and fixtures |
| `@mokimeow/jev-fabric-provider-typesafe` | native TypeSafe plus fixed Vercel Gateway TypeSafe-compatible and Evaluation adapters |
| `@mokimeow/jev-fabric-provider-openai-compatible` | administrator-configured compatible adapter |
| `@mokimeow/jev-fabric-evals` | offline evaluation, manifests, replay, and reports |
| `@mokimeow/jev-fabric-mcp` | advisory MCP server and bounded loopback handler |
| `@mokimeow/jev-fabric-cli` | terminal commands and adapter contract |
| `@mokimeow/jev-fabric-adapters` | canonical host layouts, validators, experimental WebMCP binding, and finance evidence boundary |

The core entry point is `new FabricRuntime(options).evaluate(input)`. Inputs require a trusted `pack`, `tenantId`, `action`, `knownActions`, state, and optionally trusted authorization/risk/policy/signal/deadline. Outputs include semantic data, a redacted receipt, and accounting. `createNativeJevProvider` exports the pinned native model factory and permits an injected test client. `createVercelGatewayJevProvider` fixes the TypeSafe-compatible Gateway URL. `createVercelGatewayEvaluationJevProvider` fixes `POST /v1/evaluate`, requests ZDR, no prompt training, and `only: ["typesafe-ai"]`, and validates the response-reported canonical model and provider route. Both Gateway factories require an explicit server-side key, fix `typesafe-ai/jev`, expose no public client or endpoint override, and read no ambient credentials. They remain trusted-host programmatic integrations, not CLI live modes. `bindWebMcpAdvisory` and `bindMcpHandlerWebMcpAdvisory` emit fingerprints only and cannot invoke a browser or MCP tool. Read the TypeScript declarations as the exact alpha API; semver pre-1.0 changes may occur.

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

A projector may also implement `bindingHash(input, context)` and return one
canonical `sha256:` digest for trusted host evidence intentionally omitted from
provider state. `FabricRuntime` commits that digest into the receipt state hash,
request identity, and cache key under a separate domain, but sends only the
result of `project` to the provider. The hook is for already validated evidence
bindings—not raw secrets or a replacement for publisher authentication. The
hook itself is optional for compatibility. When a projector implements it, an
absent or malformed return value fails before cache lookup or provider dispatch.

Tool-environment schemas are structural validators, not authority. Use
`validateToolEnvironmentSnapshot(input, trustedCatalogue, observedNowMs,
trustedVisualCapture?)` and
`validateToolEnvironmentProposal(proposal, snapshot, trustedCatalogue,
observedNowMs, trustedVisualCapture?)` with a code-reviewed catalogue that
untrusted inputs cannot modify. When a snapshot carries a visual observation,
the separate capture argument is mandatory and must come directly from the
trusted extractor; a digest supplied inside the snapshot cannot authenticate
itself. The latter returns the exact validated action only after identity,
state, capability-manifest, freshness, capture, and positive-catalogue checks
pass.

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

`pairedCategoricalRobustness(rows)` measures answer agreement, distribution
shift, and labeled regressions without treating stability as correctness. Its
`byFamily` result always reports batching, paraphrase, option order, question
order, state order, and repeat-call interventions separately. Families with no
pairs retain explicit `empty` evidence, preventing one stable intervention or
an aggregate from hiding an unmeasured or unstable family.

`evaluateHierarchicalConfidence(rows, config)` fits a leaf-reporting confidence
threshold on one group-disjoint split, audits its group failure risk on a
second split, and evaluates leaf-versus-parent fallback on a third. The policy
hash binds the hierarchy, dataset, question contract, provider, concrete model,
and native probability semantics. Internally derived, order-invariant hashes
also bind the exact fit, audit, and test observations; a separate evaluation
digest binds the policy, test set, decisions, and metrics. Missing support or a
failed audit produces parent-only results; the evaluator never grants
application authority.

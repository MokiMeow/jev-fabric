# Native TypeSafe live operation

This alpha supports one operator-controlled live path: local MCP stdio with
the native, pinned `typesafe-native` provider and `jev-1.13.0`. It is an
administrator deployment control, not a generated host configuration and not
an endorsement or performance claim.

Generated integrations stay offline and contain no credential fields. First
install `@mokimeow/jev-fabric-cli` on the host `PATH` and verify:

```sh
jev-fabric doctor --json
```

Then a server-side operator may set a credential value in a private process
environment and invoke the direct command below. Replace only the placeholder
environment *name* and trusted operator identifiers; do not put the key in a
shell history, config, receipt, plugin, or generated host file.

```sh
jev-fabric serve --transport stdio --live --provider typesafe-native --model jev-1.13.0 --credential-env TYPESAFE_API_KEY --tenant-id operator-tenant --action operator-route --max-calls 10 --max-input-tokens 10000 --max-dollars 0.10 --input-price-per-million 10.00 --deadline-ms 5000
```

`--live` must appear on this invocation. It cannot be enabled through config or
environment. The CLI rejects live HTTP, aliases, unpinned models, missing
limits, absent credentials, and a price ceiling that cannot fit the declared
dollar ceiling. It resolves the actual credential once only after static gates
pass, passes it to the native client, disables SDK and runtime retries, and
never writes it to command output or receipts.

## Cost boundary

The admission check proves only this arithmetic: `max-input-tokens ×
input-price-per-million ≤ max-dollars` (rounded conservatively to micros).
The price is an operator-supplied current input-price ceiling. It does not
prove provider billing, output-token charges, taxes, discounts, retries outside
this process, or a precise billed-cost cap. Set a conservative ceiling and
monitor provider billing independently.

## Authority boundary

For live MCP requests, the CLI overrides tool-supplied tenant, action,
known-actions, risk, authorization, and policy with the fixed operator tenant
and action; no authorization context is admitted. Provider output is typed,
validated, redacted in receipts, and advisory. It never executes an action or
grants permission. A host must apply its normal authorization and approval
controls after receiving a result.

## Jev 1.13 fit boundary

The pinned model is a semantic decision model, not a calculator, clock, parser,
generator, or authorization engine. Follow TypeSafe's dated
[Jev 1.13 jaggedness guidance](https://docs.typesafe.ai/model-jaggedness/jev-1.13)
(reviewed 2026-09-17): compute counts, arithmetic, date ordering, durations,
freshness, and structural identities in code; project only question-relevant
state; avoid double negatives and hidden multi-hop reasoning; and test hostile
state because the model does not inherently treat it as adversarial. Never
transfer thresholds between Noul, Choice, and Score or assume probabilities
from separately phrased questions obey arithmetic identities.

Fabric enforces these boundaries in its built-in finance and fintech packs by
validating timestamps, hashes, identities, counts, candidate coverage, and
authorization deterministically. Custom packs remain responsible for the same
decomposition and require held-out domain evidence before operational use.

## Upstream request correlation

The official JavaScript SDK can expose `x-typesafe-request-id` alongside a
parsed response. `evaluateWithMetadata` retains only a domain-separated SHA-256
digest in `providerRequestIdHash`; it never exposes the raw identifier. The
response and identifier come from one `withResponse()` API promise, so
correlation does not add a provider attempt. An absent header stays absent and
a malformed identifier fails closed. The digest supports internal trace
correlation only and is not proof of model quality, latency, cost, or billing.

## Offline integration proof

The repository tests this composition with an injected native-shaped fake
provider and no network. Production code can likewise inject a client into
`createNativeJevProvider` for controlled tests. No live TypeSafe request or
credential is needed to exercise the boundary.

## Compatible providers

The OpenAI-compatible adapter is programmatic only in this alpha. Its endpoint
policy, DNS/address controls, model pinning, client construction, and retries
must be configured by a trusted server host; it is intentionally not exposed
through `serve --live`. See [the API reference](../reference/api.md) and keep
credentials server-side.

For copyable, offline-tested native and compatible server compositions, see
[programmatic providers](programmatic.md).

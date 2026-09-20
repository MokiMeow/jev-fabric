# Read-only finance research routing

evidence class: implementation and offline contract tests; live model evidence
`NOT_RUN`. Source review date: 2026-09-20.

`finance-research-router` turns one untrusted natural-language market-research
request into a bounded proposal for a read-only host tool. It does not call the
tool. It cannot place an order, recommend an investment, calculate a return,
choose a price target, decide suitability, or grant authority.

The design adapts TypeSafe's current
[function-calling cookbook](https://docs.typesafe.ai/cookbooks/function_calling)
and [speculative fan-out pattern](https://docs.typesafe.ai/patterns/fan-out).
Unlike the cookbook demonstration, Fabric inserts a permanent no-trade boundary
and emits an advisory proposal that a trusted host must revalidate. The official
[Jev 1.13 jaggedness note](https://docs.typesafe.ai/model-jaggedness/jev-1.13)
also keeps date comparison, arithmetic, counting, and structural identities in
code.

## One batched request

The pack asks six independent questions over the same bounded state:

1. whether the request asks for a prohibited financial action or advice;
2. whether it attempts policy override, authority forgery, credential exposure,
   or a hidden side effect;
3. which fixed read-only research tool best fits;
4. the primary symbol from a host-owned allowlist;
5. the secondary comparison symbol from that allowlist; and
6. one semantic historical-window label.

The tool and argument questions are speculative. Code ignores answers that the
selected tool does not use. This avoids repeating the request and symbol context
across serial provider calls, but the repository does not claim a speed or cost
improvement until a completed retained benchmark measures it.

## Fixed tool vocabulary

| Proposal | Bounded meaning | Required arguments |
| --- | --- | --- |
| `plot_price` | Historical price chart | primary symbol, optional window |
| `compare_returns` | Historical return comparison | two distinct allowlisted symbols, optional window |
| `rolling_correlation` | Historical rolling correlation | symbol, benchmark, optional window |
| `summary_stats` | Descriptive statistics | primary symbol, optional window |
| `market_summary` | Read-only market summary | optional window |
| `list_symbols` | Show the host allowlist | none |
| `investigate` | Unsupported, unsafe, or ambiguous request | none |

The pack returns `route` only for the six read-only proposals. Prohibited advice,
missing symbols, duplicate comparison symbols, unsupported tools, or ambiguity
return `ask` with `investigate`. Prompt influence, malformed answers, provider
failure, and outage escalate. A static denial remains deterministic and causes
zero provider calls.

## Trusted input contract

The host supplies:

- `advisoryOnly: true`, `execution: "NOT_SUPPORTED"`, and
  `purpose: "read_only_market_research"`;
- a host-redacted request with an exact SHA-256 binding and
  `trust: "untrusted_data_only"`;
- a sorted, unique allowlist of 1–20 current symbol identifiers;
- the exact pack-owned tool catalogue;
- an observation time, expiry, and integer maximum age; and
- an opaque request reference.

Projection snapshots plain data without invoking accessors or proxy traps,
rejects cycles, symbols, extra properties, controls, stale/future state, hash
substitution, changed tool descriptions, and execution-shaped top-level fields.
It removes raw clock fields before provider egress but retains a domain-separated
evidence-envelope digest.

## Output boundary

A safe semantic result contains only:

- one fixed tool identifier;
- its bounded symbol/window arguments;
- `advisoryOnly: true`, `readOnly: true`, `execution: "NOT_SUPPORTED"`, and
  `authority: "NONE"`; and
- `requiresHostRevalidation: true`.

The host must look up the tool in its own positive allowlist, revalidate symbols,
entitlements, data rights, freshness, and resource limits, and run it with a
read-only credential. The proposal must never be connected to an order API,
portfolio mutation, transfer, broker session, shell, or general-purpose URL.
An analytics result remains descriptive data; a separate reasoning model or
qualified human owns explanation, and neither receives trading authority from
this receipt.

Choice probabilities and native Noul probabilities are retained only as
unthresholded evidence. TypeSafe confidence and selected-option probability are
not treated as workflow correctness. No public threshold has been calibrated for
this pack.

## Evidence status

Offline tests cover the full runtime path, native TypeSafe request compilation,
fixed candidate coverage, safe proposals, prohibited advice, influence,
unsupported symbols, stale state, provider failure, hostile objects, tampered
hashes, and the no-execution invariant. These tests validate construction and
failure behavior, not Jev accuracy, latency, batching parity, or cost. All such
performance claims remain `NOT_RUN` until produced by a preregistered retained
evaluation with a newly issued server-side credential.

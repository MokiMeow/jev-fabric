# Finance and fintech

Jev Fabric supports finance only as an advisory surveillance and triage layer.
It does not provide investment advice, choose trades, calculate indicators,
size positions, or connect a model decision to an order-entry interface. The
trusted host owns exact arithmetic, data rights, temporal validation,
entitlements, supervisory controls, and every external side effect.

This boundary follows TypeSafe's guidance to keep deterministic work and side
effects in code and use System One for narrow judgments. It also reflects the
[Jev 1.13 jaggedness guidance](https://docs.typesafe.ai/model-jaggedness/jev-1.13),
which says arithmetic and date comparison belong in code. The optional
claim-to-excerpt check follows the decomposition in TypeSafe's
[citation-check cookbook](https://docs.typesafe.ai/cookbooks/citation_check):
host code binds the source candidate and one focused Choice judges its relation
to the claim.

## Safe architecture

```mermaid
flowchart LR
  F[Licensed feeds and documents] --> C[Deterministic calculations and cutoff checks]
  I[Chart or financial document] --> V[Versioned extractor]
  V --> B[Bounded annotations or claim candidates]
  C --> P[Finance advisory projection]
  B --> P
  P --> J[Jev typed surveillance questions]
  J --> R[Observe, investigate, or escalate]
  R --> H[Authorized human or read-only case queue]
  X[Order management and execution] -. separate trust zone .-> H
```

The dotted relationship is intentionally not implemented. A Jev answer is
never an order, authorization, approval, or strategy signal.

Use `bindFinanceAdvisoryEvidence` for structured visual evidence or
`bindFinanceAdvisoryEvidenceWithText` when a filing, news, or case-note
extractor also supplies bounded claim-candidate excerpts. Both accept only
opaque instrument references, source and feature hashes, code-derived semantic
buckets, and code-checked timestamps. The text-aware binder limits excerpts to eight items,
1,000 characters each, and 16 KiB total. Trusted code must supply an ordered,
unique candidate id and SHA-256 excerpt hash for every item. The binder requires
an exact count, order, and hash match, then emits source-bound candidates with
the trusted document, source, and extractor identities and marks their text as
`untrusted_data_only`. The binders reject stale or future observations,
post-cutoff signals, raw order fields, unbound evidence, proxy/accessor input,
control characters (including C1 and bidirectional/isolate controls), and
malformed annotations or excerpts. The emitted state carries a code-derived
expiry bound to `observedAt + maxAgeMs`; the runtime supplies a trusted
evaluation-start clock to the pack before any cache lookup or provider call.
The pack rejects expired or tampered expiry data and independently recomputes
all excerpt, ordered-candidate, annotation, and visual-artifact hashes. Stable
`FinanceAdvisoryBoundaryError` codes let callers distinguish look-ahead, stale,
window, binding, and general input failures without matching error text.

A trusted candidate binding may also include a SHA-256 hash for one proposed
claim. Claim binding is all-or-none across the candidate list: the untrusted
evidence must then supply one claim per excerpt in the same order, each limited
to 1,000 characters and 8 KiB total. The emitted candidate retains `claim` and
`excerpt` as separate `untrusted_data_only` strings. Trusted code may retain an
optional byte range and section hash with a claim-bearing candidate. The host
must first locate the exact excerpt in the authenticated document and calculate
those offsets; the adapter validates and binds the metadata but cannot prove
source authenticity or quote location without the source document itself.

Then use `financeSurveillancePack`. Its finite output vocabulary is:

| Result | Meaning | Permitted destination |
| --- | --- | --- |
| `observe` | Retain a redacted advisory observation. | Read-only telemetry or case record. |
| `investigate` | Evidence is ambiguous or conflicted. | Bounded analyst queue. |
| `escalate` | Evidence is concerning, insufficient, influenced, or malformed. | Authorized human review. |

The pack never returns `allow`. Restrictive independent questions can upgrade
the route, but they cannot downgrade an escalation.

For each bound text candidate, the pack asks one focused Choice question that
references the exact `text.candidates[index].excerpt` path. Its vocabulary is
fixed in code: reported-performance change, guidance/outlook change,
liquidity/going-concern risk, accounting/control issue, legal/regulatory
contingency, or none. Code maps those fine labels to broader parent families.
The semantic result retains only the candidate id and fixed labels, explicitly
named `provisionalFine` and `provisionalParent`; it never copies or generates a
financial fact.

For each claim-bearing candidate, the pack also asks one focused Choice question
that compares only its exact `claim` and `excerpt` paths. `contradicts` escalates,
`insufficient_context` investigates, and `supports` never grants authority or
downgrades a route selected by another signal. Missing, malformed, duplicated,
or extra citation answers fail closed. Citation confidence follows the same
policy as claim classification: native calibrated confidence is retained only
as unthresholded evidence, while all other probability semantics are ignored.

No finance-specific confidence threshold has been calibrated yet. Therefore a
non-`none` claim only upgrades the case to `investigate`, while malformed claim
answers escalate. Native confidence is retained only when the provider declares
`native_calibrated`; confidence from normalized, self-reported, synthetic, or
unknown semantics is ignored. Even native confidence is marked unthresholded
and does not produce a high/medium/low tier until a trusted, versioned policy is
validated on held-out finance evidence.

## High-value uses

- Market-surveillance triage from code-derived volatility, liquidity, spread,
  or data-quality buckets.
- Financial-news and filing routing, relevance filtering, contradiction
  checks, and citation verification before an expensive reasoning model.
- Payment, fraud, AML, KYC, sanctions, dispute, and compliance case
  prioritization when a domain team supplies labels, policies, and review.
- Portfolio-operations exception queues, reconciliation notes, corporate-action
  document classification, and analyst workflow routing.
- Semantic feature extraction from unstructured notes for a separately trained
  and validated statistical model.

Do not use this integration for direct buy/sell/hold decisions, price targets,
credit approvals, eligibility, suitability, market access, or unattended
financial execution.

FINRA says firms using AI should address model risk, data privacy and integrity,
reliability, accuracy, governance, and supervision. The SEC's market-access
rule requires broker-dealer-owned financial and regulatory controls and
regular review. Those obligations cannot be delegated to a Jev prompt or a
Fabric receipt. See [FINRA Regulatory Notice 24-09](https://www.finra.org/rules-guidance/notices/24-09),
[FINRA's AI risk considerations](https://www.finra.org/rules-guidance/key-topics/fintech/report/artificial-intelligence-in-the-securities-industry/key-challenges),
and the [SEC market-access rule overview](https://www.sec.gov/rules-regulations/2011/06/risk-management-controls-brokers-or-dealers-market-access).

## Visual understanding

Official Jev accepts text or JSON state, not image bytes. Use an independently
tested OCR, document-AI, or vision component to extract bounded facts. Code
must verify chart axes, units, timezone, source binding, crop identity, and
cutoff before the annotations reach Jev. Preserve the image digest and
extractor version, not the image itself, in the advisory state.

The benchmark's canonical SVG compiler emits a versioned renderer identity,
mutation id, expected route, image hash, source-binding hash, and one artifact
hash over that complete tuple. The adapter and pack revalidate the tuple. The
offline builder also requires the case `goldRoute` to equal the compiler-owned
route, so a case author cannot relabel a compiled deceptive-chart mutation
without invalidating the dataset.

Treat extracted labels as untrusted data. They may be wrong, omit context, or
contain prompt injection. The finance pack asks a separate influence question
and escalates when that signal is present. For exact candlesticks, indicators,
returns, counts, or temporal comparisons, use the underlying data and code—not
pixels and not Jev.

## Continuous improvement loop

1. Define one narrow decision and an authoritative outcome label.
2. Compute exact features and temporal cutoffs in deterministic code.
3. Split evaluation data forward in time; never tune on future observations.
4. Ask atomic questions in one batch and retain full option probabilities.
5. Measure accuracy, macro-F1, Brier score, calibration error, selective
   coverage, latency, token use, cost, and rejection of stale/look-ahead cases.
6. Run in shadow mode. Review errors by market regime, source, asset class, and
   visual extractor version.
7. Promote a question, threshold, or feature only when it improves a held-out
   time window and preserves zero execution attempts.
8. Version the dataset digest, feature definitions, model, provider, policy,
   and question set. Re-run after any change or detected drift.

TypeSafe confidence is distribution concentration, not correctness
probability. Calibrate thresholds against your own labels and never reuse a
threshold across different probability semantics. The executable
[finance benchmark](../../benchmarks/finance/README.md) compares four
architectures across all three tracks and independently validates retained
traces, digests, provenance, look-ahead rejection, calibration semantics,
latency, tokens, and cost. Its committed evidence remains `NOT RUN`; no
placeholder or synthetic result is presented as live model performance.

The offline [finance-surveillance example](../../examples/finance-surveillance/README.md)
shows the complete boundary with synthetic evidence.

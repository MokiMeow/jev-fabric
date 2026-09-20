# Fintech exception triage

`fintech-exception` is a read-only semantic pre-triage pack for short,
host-redacted operations notes. It uses one Jev request containing six
independent Noul questions. Deterministic code validates the complete answer
set and derives one of three advisory routes: `observe`, `investigate`, or
`escalate`.

Version `0.2.0` uses the current native TypeSafe Noul wire contract exactly:
optional descriptions are keyed by `true` and `false`. Fabric rejects legacy
or improvised keys before cache access or provider dispatch, so an offline-only
question shape cannot silently reach Jev.

It does not approve or reject payments, establish fraud, validate identity or
authority, make AML/KYC/sanctions decisions, alter an account, or execute a
financial action. Those responsibilities stay in authenticated systems and
authorized human workflows.

## Best-fit workflow

| Stage | Owner | What crosses the boundary |
| --- | --- | --- |
| Authenticate and retrieve | trusted host | nothing yet; source access remains local |
| Redact | trusted host | a short case note with regulated data removed |
| Bind and timestamp | trusted host | opaque case reference, note/source hashes, observation and validity times |
| Semantic detection | Jev | six explicit yes/no indicators over the exact redacted note |
| Validate and compose | Fabric code | complete typed answers become only `observe`, `investigate`, or `escalate` |
| Act | authorized host queue | a human-review routing suggestion; never a financial instruction |

The six questions detect only explicit mentions of duplicate/reprocessed
items, entity mismatch, missing/conflicting evidence, claimed approval or
override, urgent consumer harm, and untrusted influence. A claimed approval is
an indicator to investigate, not evidence that approval exists. Urgent harm or
influence escalates. Missing, duplicated, extra, wrong-type, or inconsistent
answers also escalate.

## Why one batched Noul request

The official TypeSafe guidance says Noul is for a focused yes/no question,
independent questions may be sent together, and the questions are evaluated in
parallel. This pack follows that shape instead of asking one compound question
or making six separate network calls. See the official
[Noul primitive](https://docs.typesafe.ai/primitives/noul),
[Noul consistency cookbook](https://docs.typesafe.ai/cookbooks/consistency_noul_cookbook),
and [use-case map](https://docs.typesafe.ai/concepts/use-case-map), accessed
2026-09-20.

The pack does not publish a probability threshold or calibrated risk tier.
When a response is declared `native_calibrated`, each answer must include the
native probability of yes; it is retained as unthresholded evidence. For other
semantics, probability-like confidence is ignored. Production thresholds must
be fitted and versioned against representative, jurisdiction-appropriate held-
out data.

## Input contract

The host supplies:

- `contractVersion: "1"`, `advisoryOnly: true`,
  `execution: "NOT_SUPPORTED"`, and
  `purpose: "exception_triage_only"`;
- an opaque `ref:` case identifier, not an account or customer identifier;
- calendar-valid RFC 3339 millisecond `observedAt` and `validUntil` values, plus
  an exact `maxAgeMs` binding;
- one redacted note, its SHA-256, an authenticated-source SHA-256, and literal
  `untrusted_data_only` / `host_redacted` labels;
- the exact pack-owned candidate catalogue.

Before provider egress, the projector rejects stale, future-dated, or
hash-mismatched input, unknown structured fields such as amount or
authorization, proxies, accessors, cycles, symbols, non-plain objects, control
characters, bidirectional controls, candidate substitution, and malformed
timestamps. The provider receives the exact host-supplied note and its hashes;
the literal `host_redacted` label does not prove semantic redaction. The pack
does not separately project payment, identity, account, amount, credential, or
execution fields, but residual values written inside the note would still
cross the provider boundary. Run a trusted DLP/redaction check before Fabric—or
use only opaque tokens and deterministic buckets—when provider policy forbids
such data.

## Deployment rules

1. Run redaction and source authentication before constructing decision state.
2. Keep payment, ledger, identity, sanctions, case-management, and execution
   credentials in separate processes and identities.
3. Map all three routes only to read-only telemetry or a human queue.
4. Re-check authorization, freshness, and source evidence in host code after
   any human decision; never infer them from a Jev answer.
5. Pin the concrete model and question-set hash for evaluation. Do not reuse
   thresholds or caches after either changes.
6. Start in shadow mode and measure labeled selective risk, false-negative
   rates for urgent harm, latency, provider errors, drift, and human override.

The runnable [offline example](../../examples/fintech-exception/README.md) uses
synthetic data and proves both the one-call positive path and a zero-call
execution-boundary denial. The [threat model](../security/fintech-threat-model.md)
documents the remaining deployment assumptions.

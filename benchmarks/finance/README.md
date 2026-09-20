# Finance benchmark

Evidence: `NOT RUN`. The committed fixture defines twelve comparison cells:
three tracks by four architectures. It establishes neither performance nor
trading results. Synthetic tests prove the runner and validator behave as
specified; they are not model benchmarks.

## What the runner measures

The tracks are market surveillance, structured visual evidence, and bounded
financial-text triage. Every retained test case runs through:

- deterministic code only;
- a host model only;
- Jev advisory questions only; and
- host model plus Jev.

The runner retains accuracy, macro-F1, selective coverage, route-question
Brier score and ECE when a real route distribution exists, look-ahead
rejection, unsafe-execution attempts, monotonic p50/p95 latency, input tokens,
and exact micro-dollar cost. Unknown provider accounting remains `null`, never
zero. Composite routes do not inherit a component's probability distribution.

Market returns and P&L are intentionally excluded. This evaluates a read-only
control plane, not a trading strategy.

## Retained dataset contract

A dataset directory contains `dataset-manifest.json` and `cases.jsonl`. The
schemas require a SHA-256 case-set digest, source and licence metadata,
redistribution status, a forward-chaining time split, fixed evaluation times,
and group isolation across calibration and test. Each test track must contain
ordinary cases and deliberate post-cutoff probes.

Visual cases carry only code-verified axis/source bindings plus bounded
untrusted annotations. Text cases carry only source-bound, bounded untrusted
excerpts. The adapter rejects stale, future, or post-cutoff evidence before any
driver is called. Non-redistributable or sensitive source material must remain
outside the repository; publish only evidence whose licence permits it.

## Running it

`run.mts` is a programmatic API. Supply four code-reviewed drivers and complete
per-component runtime provenance, then call `loadFinanceDataset`,
`runFinanceBenchmark`, and `writeFinanceArtifacts`. There is deliberately no
CLI option that imports an arbitrary provider module.

A completed artifact directory contains the original dataset files,
`run.json`, and canonical `traces.jsonl`. Writes stage to a unique adjacent
directory and rename atomically. The independent validator recomputes the
trace digest, coverage, case bindings, and aggregate rows:

```text
pnpm benchmark:check
pnpm exec tsx benchmarks/finance/scripts/validate.mts --artifacts-dir PATH
```

The validator rejects fabricated values in `NOT_RUN` evidence, missing
architecture/case pairs, trace tampering, split leakage, mismatched look-ahead
outcomes, incomplete provenance, and non-zero unsafe-execution attempts.

## Trust boundary and claim limits

The runner is a trusted in-process measurement harness, not a code sandbox.
Drivers receive only the advisory state, architecture, track, deadline signal,
and no dataset identifier or gold label. The timeout bounds how long the runner
waits and asks a cooperative driver to abort; JavaScript cannot terminate a
driver that ignores the signal. Therefore run drivers only in a credentialless,
read-only worker or container with provider-only egress, no order-entry SDK,
and an independently instrumented execution sink. The retained unsafe-attempt
field is output-contract telemetry, not proof that arbitrary driver code caused
no external side effect.

The validator proves artifact self-consistency. It binds every claim-bearing
run metadata field to the retained manifest and cases, but it cannot prove that
a publisher's source data or labels are truthful. Public performance evidence
also needs an externally pinned dataset digest, reviewable generation recipe,
and signed CI/run attestation. Provenance URLs must be canonical,
credential-free HTTPS URLs.

## First public datasets

Prefer SEC EDGAR submissions and filing archives for text triage and the SEC
Financial Statement and Notes datasets for source-bound chart generation.
ABIDES can provide reproducible synthetic market-regime and anomaly scenarios.
PlotQA may test a chart extractor upstream, but it is not a finance label set
and cannot establish no-look-ahead behavior. Every source still needs a
case-specific licence and redistribution review.

# Finance benchmark

Evidence: `NOT RUN`. The committed fixture defines twelve comparison cells:
three tracks by four architectures. It establishes neither performance nor
trading results. Synthetic tests prove the runner and validator behave as
specified; they are not model benchmarks.

The runner implements the experimental `finance.observe-gate.v1`. It retains
the complete atomic Choice ledgers, composes every mandatory observe factor
with a non-compensating minimum, fits a threshold only on the calibration
split, and upgrades a rejected `observe` to `investigate`. It never turns a
more restrictive route into `observe`. The fitted threshold enforces only the
caller-declared **maximum observed** false-observe risk on retained calibration
rows. It is empirical evidence, not a confidence bound, statistical guarantee,
authorization, or permission to trade. The committed fixture remains strictly
`NOT_RUN`: its policy set, threshold inputs, atomic metrics, and performance
metrics are null or empty and make no observe-gate claim.

## What the runner measures

The tracks are market surveillance, structured visual evidence, and bounded
financial-text triage. Every retained test case runs through:

- deterministic code only;
- a host model only;
- Jev advisory questions only; and
- host model plus Jev.

The runner retains held-out accuracy, macro-F1, selective coverage, exact
observe-gate counts and rates, look-ahead rejection, unsafe-execution attempts,
monotonic p50/p95 latency, input tokens, output tokens, and exact nano-USD cost.
`falseObserveRisk` is false accepted observes divided by accepted observes; it
is `null`, not zero, when no observe was accepted. Per-role atomic accuracy,
macro-F1, categorical Brier score, and top-label ECE are reported for the route,
anomaly, evidence-quality, untrusted-influence, claim, and citation families
that exist in the held-out cases.

There is deliberately no final-route Brier score or ECE. A route-question
distribution is scored only against the matching atomic gold label for
`finance-route`, and the row declares
`routeQuestionMetricTarget: atomic_gold_finance_route`. Deterministic and
host-plus-Jev rows have no single role-owned route-question distribution, so
that target and both route-question metrics remain `null`. A composite route
never inherits a component's distribution. Token and price availability are
tracked independently: known usage is retained even when no reviewed price is
available, and every unknown remains `null`, never zero.

Market returns and P&L are intentionally excluded. This evaluates a read-only
control plane, not a trading strategy.

End-to-end duration includes the client, scheduler, network, gateway, and
provider. A public latency report must therefore retain a same-host network
floor measurement and report it beside, not subtracted from, the raw duration.
The floor is context rather than a model-latency estimate; geography, warm-up,
request size, concurrency, and gateway route must remain visible.

## Retained dataset contract

A dataset directory contains `dataset-manifest.json`, `cases.jsonl`, and the
visual SVGs referenced beneath `assets/`. The schemas require a SHA-256
case-set digest, source and licence metadata,
redistribution status, a forward-chaining time split, fixed evaluation times,
and group isolation across calibration and test. Each regular case also carries
exact atomic gold labels for the four fixed finance questions and for every
source-bound claim or citation question created for that case. Dynamic labels
retain the candidate id and evidence hash; the question id must use the pack's
`finance-text-claim:`, `finance-text-claim-cited:`, or
`finance-text-citation:` prefix. The final gold route must agree with those
atomic labels. Each test track must contain ordinary cases and deliberate
post-cutoff probes.

Visual cases carry a unique SVG path, the complete canonical compiler input,
code-verified axis/source bindings, and bounded untrusted annotations. Loading a
dataset reruns the compiler, bounded-reads the SVG, requires exact byte and hash
agreement, and rejects missing, extra, reused, or internally consistent forged
artifacts. Mutation ids, expected routes, gold routes, and the digest sealing
that small target domain remain evaluator-side: the trusted adapter checks the
binding and removes all target-bearing fields, the pack rejects their
reintroduction, and a driver regression asserts that the exact provider request
contains none of them. Text cases carry only source-bound, bounded untrusted
excerpts: one to eight ordered candidate ids and per-excerpt SHA-256 bindings
must match the retained strings exactly. The adapter rejects stale, future,
post-cutoff, reordered, inserted, or hash-mismatched evidence before any driver
is called. Non-redistributable or sensitive source material must remain outside
the repository; publish only evidence whose licence permits it.

## Running it

`run.mts` is a programmatic API. Supply four code-reviewed drivers, complete
per-component runtime provenance, the observe-gate empirical risk limit and
minimum calibration-group count, and the canonical runtime-evidence documents
whose hashes that provenance claims. Then call `loadFinanceDataset`,
`runFinanceBenchmark`, and `writeFinanceArtifacts`. There is deliberately no
CLI option that imports an arbitrary provider module.

The runner executes every calibration case first for all four architectures,
retains those traces with `observeGateStatus: CALIBRATION`, and fits one policy
for each of the twelve track/architecture cells. Calibration traces have no
policy digest and are never passed through the policy they are used to create.
The frozen policy artifacts bind the dataset digest, pack and question-set
identity, cell, provider/model/version/response identities, and probability
semantics; their digest is then attached to test traces. An unavailable policy
is retained with an explicit reason and cannot silently become a calibrated
policy.

Only test traces contribute to held-out classification, atomic, selective-risk,
coverage, rejection, and latency metrics. Calibration and test cases and traces
are counted separately. Token and cost totals intentionally include every
retained provider call from both phases, because calibration is real work and
excluding it would understate the cost of the evaluated system. Row
`sampleCount` remains the held-out test count.

For provider-backed runs, use `createTrustedFinanceDriverBundle` from
`scripts/drivers.mts`. It creates all four arms together so the standalone and
combined host/Jev paths share finite per-provider request/token budgets. Every
call uses an always-miss cache, one Fabric attempt, an abort deadline, exact
provider/model/semantics checks, and the `finance-surveillance` pack. The
combined arm evaluates host and Jev independently in parallel and keeps the
more restrictive route; it never invents a composite probability distribution.

`createTypeSafeFinanceInvoker` and
`createOpenAICompatibleFinanceInvoker` adapt already-constructed,
metadata-capable providers. They do not read credentials or construct network
clients. The compatible wrapper inspects the provider's immutable execution
policy and refuses any nonzero repair or redirect count; the TypeSafe adapter
sets zero SDK retries on every request. Supply an immutable `modelVersion`
separately from the exact `responseModel`: a gateway route such as
`typesafe-ai/jev` is not evidence of a concrete upstream version. When the two
differ, a dated, hashed, canonical-HTTPS external version attestation is
required and retained; otherwise the run fails before calling the provider.
Optional pricing uses a dated, hashed HTTPS source and integer nano-USD per
token; without it, token counts remain measured and cost remains `null`. The
derived runtime provenance snapshots that reviewed price record beside each
provider component and requires the same host/Jev record in standalone and
composite arms; deterministic code carries explicit `null` pricing.

Each predicted trace retains per-component token and nano-USD accounting. Both
the live runner and independent artifact validator recompute every component
against its retained price record and require the aggregate to equal the exact
sum, including the parallel host-plus-Jev arm.

The bundle exposes derived `architectures` and `budgetSnapshots()`. Use the
derived architecture provenance in the run metadata; do not hand-copy model
identities. Budget tokens are conservative admission reservations, not billed
usage reconciliation or a provider-side hard quota.

A completed artifact directory contains the original dataset files and visual
SVGs, `run.json`, canonical `traces.jsonl`, and an `evidence/` directory. The
run retains all twelve observe-gate policy artifacts and every calibration and
test trace; calibration rows remain excluded from held-out metrics. The latter
contains one canonical JSON document named `<sha256>.json` for each distinct
price record and external model-version attestation claimed by the runtime.
The SHA-256 is computed over the exact retained bytes. Evidence documents are
bounded, credential-free metadata only; they never contain provider secrets,
raw market state, execution instructions, or order-entry authority.

Writes stage every file, including visual artifacts and evidence, in a unique adjacent directory
and rename that directory atomically. The output parent is a trusted,
single-writer boundary: do not run the writer where another same-privilege
process can rename or replace entries in that parent. Portable Node APIs do not
provide directory-relative open and rename operations that can defend against
that actor. A failed write deliberately leaves its random `.tmp-*` directory in
place; inspect and remove it from the trusted parent instead of relying on
path-based recursive cleanup. The independent validator requires the
exact top-level, visual-asset, and evidence filename sets; rejects links, unknown fields,
oversized documents, and noncanonical JSON; hashes the raw evidence bytes; and
matches every pricing and model-identity field back to runtime provenance. It
also recomputes the trace digest, coverage, case bindings, costs, and aggregate
rows:

```text
pnpm benchmark:check
pnpm exec tsx benchmarks/finance/scripts/validate.mts --artifacts-dir PATH
```

The validator rejects fabricated values in `NOT_RUN` evidence, missing
architecture/case pairs, trace tampering, split leakage, mismatched look-ahead
outcomes, incomplete provenance, and non-zero unsafe-execution attempts. It
also rejects malformed, credential-bearing, cross-arm-inconsistent, missing,
extra, tampered, or semantically mismatched runtime evidence.

The separate [offline dataset-builder verifier](builders/README.md) checks
hash-locked sources, rights records, deterministic build inputs, issuer or
scenario-family split isolation, a 30-day embargo, and modality-bound
look-ahead probes before a generated dataset reaches this runner.

## Trust boundary and claim limits

The runner is a trusted in-process measurement harness, not a code sandbox.
Drivers receive only the advisory state, architecture, track, question-set
hash, deadline signal, and no dataset identifier or gold label. The timeout bounds how long the runner
waits and asks a cooperative driver to abort; JavaScript cannot terminate a
driver that ignores the signal. Therefore run drivers only in a credentialless,
read-only worker or container with provider-only egress, no order-entry SDK,
and an independently instrumented execution sink. The retained unsafe-attempt
field is output-contract telemetry, not proof that arbitrary driver code caused
no external side effect.

The validator proves artifact closure and self-consistency. It refits every
cell policy from calibration traces, verifies each held-out gate decision and
support score, and rejects any route-question distribution that drifts from
its role-owned atomic ledger. A content hash does
not prove that a price page, model-version attestation, publisher, source data,
or label is truthful. Public performance evidence also needs an externally
pinned dataset digest, reviewable generation recipe, and a signed CI/run
attestation whose trust chain is independent of the artifact publisher.
Provenance URLs must be canonical, credential-free HTTPS URLs.

## First public datasets

Prefer SEC EDGAR submissions and filing archives for text triage and the SEC
Financial Statement Data Sets for source-bound chart generation.
ABIDES can provide reproducible synthetic market-regime and anomaly scenarios.
PlotQA may test a chart extractor upstream, but it is not a finance label set
and cannot establish no-look-ahead behavior. Every source still needs a
case-specific licence and redistribution review. SEC structured datasets are
derived conveniences; the filed documents remain authoritative.

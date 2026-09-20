# Jev finance and visual landscape — 2026-09-20

This dated scan is discovery input, not security review, endorsement, or
performance evidence. Community claims remain unverified until reproduced with
retained artifacts.

Evidence class: discovery only. Benchmark evidence remains
[NOT RUN](../../benchmarks/finance/README.md); sample/case denominator: none;
model version discussed: `jev-1.13.0`; hardware and region: not applicable.
The principal limitation is that no community result below was reproduced.

## What is appearing

The community [Awesome Jev list](https://github.com/valentynkit/awesome-jev-typesafe)
now groups projects for finance, browser control, visual inference, agent
routing, semantic databases, guardrails, calibration, and evaluation. Finance
examples include:

- [jev-trader](https://github.com/jarrodwatts/jev-trader), a live/dry-run
  market-making demonstration with a decision on each block;
- [trade-jev](https://github.com/justinhe16/trade-jev), a backtest with retained
  answers, replayable policies, synthetic sample data, and separated licensed
  order-book data;
- [Jev-Trades](https://github.com/zadescoxp/Jev-Trades) and
  [jev-trade](https://github.com/aowang-ai/jev-trade), trading experiments that
  show interest in direct model-to-market loops.

The direct-execution pattern is intentionally not adopted here. It conflicts
with Fabric's authority boundary and exposes model error, stale state,
look-ahead, market-data licensing, position, margin, venue, and key-management
risk. The reusable ideas are the dry-run default, retained answers, replay,
explicit latency budget, synthetic fixtures, deterministic position limits,
and separated licensed data.

A second same-day search found
[jev_stock](https://github.com/sosopop/jev_stock), which sends explicit
structured market state for short-horizon direction classification, and a
[paper-trading Jev-Trades build](https://github.com/zadescoxp/Jev-Trades).
These are integration examples, not evidence of predictive edge. An
independent source review of
[jev-trader](https://jevlist.ai/projects/jev-trader) found no conventional test
suite and did not run its provider or wallet paths. Fabric therefore evaluates
surveillance routing and evidence quality rather than buy/sell accuracy, and
keeps every order-entry SDK outside the benchmark worker.

The more credible production-fintech fit is semantic exception handling. The
community [Awesome Jev finance map](https://github.com/kraayenjon/awesome-jev)
and [use-case playbook](https://github.com/Anil-matcha/awesome-jev-by-typesafe/blob/main/docs/jev-use-case-playbook.md)
converge on invoice, payment, KYC, and financial-crime triage: code calculates
amounts, dates, identifiers, tolerances, authorization, and side effects while
Jev evaluates bounded duplicate, wrong-entity, missing-approval, fraud-review,
or investigator-routing questions. That separation is incorporated as a
design constraint; the community examples and their reported numbers have not
been reproduced here.

Visual projects such as [jev-visual](https://github.com/hr98w/jev-visual) and
[OpenJev](https://github.com/razorback16/openjev) explore local or
Jev-compatible visual decision models. They are not evidence that the official
Jev API accepts images. Fabric therefore uses a separate visual extractor and
passes only bounded, source-bound structured annotations to Jev.

## Current-source limitation

The public search pass included the official
[TypeSafe AI X profile](https://x.com/typesafeai), but unauthenticated search
did not expose a reliable same-day post set. No X claim is used as design or
performance evidence. The dated GitHub catalogue and live TypeSafe
documentation were the reproducible discovery sources for this iteration.

## Same-day ecosystem update

The 20 September scan found rapid adoption but still very little retained,
finance-specific ground truth. Vercel's official launch material confirms the
fixed AI Gateway route and describes Jev as a typed probabilistic decision
model; its follow-up reports unusually fast paid-team adoption. Adoption is a
use signal, not an accuracy, calibration, latency, or safety result. See the
[Gateway announcement](https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway)
and [adoption report](https://vercel.com/blog/ai-gateway-jev-model-launch).

The independent [Made with Jev index](https://madewithjev.com/) exposed 186
build entries and 101 linked X posts during this scan. Its strongest recurring
patterns were bounded browser action spaces, many questions over one subject,
and a smaller cluster of live trading demos. The index republishes author
claims; counts establish ecosystem activity only, and its quoted speed, cost,
or success figures are not benchmark evidence.

A later 20 September search found a second independent directory claiming 410
entries and 10,093 stars. The disagreement between rapidly refreshed indexes is
itself useful evidence: ecosystem counts are volatile discovery metadata, not a
stable adoption metric. Unauthenticated X search still did not yield a
complete, timestamp-verifiable same-day corpus, so Fabric does not convert
social reach into product or performance claims.

Two independent repositories added useful measurement patterns:

- [jev-measured](https://github.com/WallerChen/jev-measured) retains raw
  responses, provider-reported token use and cost, and a separate network-floor
  measurement. It explicitly does not claim accuracy because it has no labels.
- [jev-evaluation](https://github.com/willkelly/jev-evaluation) publishes a
  preregistered adversarial plan, machine-generated reports, independent
  rescoring, and citation-to-measurement checks. Its reported results include
  strong batching benefits and failures on out-of-distribution formal tasks and
  authority-style prompt injection. These are community results, not Fabric
  results, and have not been reproduced here.

Fabric adopts the reproducibility ideas, not the headline numbers: retain raw
attempt evidence, distinguish model time from network floor, preregister labels
and splits, independently rescore, and bind every written measurement to a
retained artifact. It also keeps trusted finance features separate from
untrusted document/chart text so claimed authority cannot silently become a
permission or execution signal.

The same evaluation reports that replacing source code with a derived syntax or
control-flow representation hurt its particular reachability task. That does
not establish the best representation for finance, where exact arithmetic,
licensing, privacy, and Jev's documented numeric limitations change the trade.
The finance benchmark should therefore preregister a synthetic-only ablation:
bounded original evidence plus code-checked constraints versus semantic
buckets alone. Production remains bucket-first until that ablation is retained;
document and chart excerpts may accompany buckets only through the existing
untrusted, source-bound evidence channel.

The strongest newly retained browser report is Browser Use's
[matched Jev Ultrafast comparison](https://github.com/browser-use/jev-ultrafast/blob/main/docs/performance.md).
It reports three alternating pairs on one Google Flights task: 9.450 seconds
versus 7.092 seconds median, 22 versus 17 TypeSafe requests, and 1,092 versus
101 browser-protocol calls. The authors explicitly note the sample is only
three pairs (two-sided sign-test p = 0.25), so Fabric treats it as a design
study, not a general speed result. The reusable mechanisms are one code-owned
DOM snapshot, indexed real elements rather than model-generated selectors,
target/context freshness guards before mutation, event-based UI settling, an
LLM only for genuinely generative text, and independent result verification.
Those mechanisms reinforce Fabric's existing browser boundary and suggest a
future preregistered ablation; they do not become finance benchmark evidence.

For finance visualization the corresponding pattern is extractor first,
decision second: deterministic chart code owns pixels, axes, series identity,
units, timestamps, and numerical transformations; a vision/OCR component emits
source-bound annotations; Jev chooses among bounded evidence-quality or review
routes; host code independently checks freshness and allowed consequences.
This avoids pretending that the text/JSON Jev endpoint is a vision model and
keeps visual ambiguity from becoming a buy/sell instruction.

Official documentation checked on 20 September lists `jev-latest` as a moving
alias for `jev-1.13.0`, exposes input/output usage in the JavaScript SDK, and
documents text or JSON state rather than image input. Reproducible benchmark
runs therefore pin the concrete model, disable SDK/Fabric retries, retain both
token counts, price from an explicit dated table, and put OCR/vision upstream
of Jev. See [models](https://docs.typesafe.ai/models),
[JavaScript SDK](https://docs.typesafe.ai/sdks/javascript), and
[System One API](https://docs.typesafe.ai/api-reference/system-one).
Gateway comparisons must also retain the transport route separately. If a
gateway exposes only `typesafe-ai/jev` and not the concrete upstream version,
the artifact is route-bound and cannot claim immutable model reproduction.

## Ideas incorporated

- One batched request with atomic, independent questions.
- One subject per request; batching never mixes instruments or cases.
- Full distributions retained; confidence is not treated as correctness.
- Code-derived semantic buckets instead of raw numerical reasoning.
- Replayable, forward-time evaluation rather than P&L-only storytelling.
- Separate network-floor, provider, and end-to-end latency measurements.
- Independent rescoring and measurement-linked written claims.
- Host-plus-Jev and solo baselines in the same benchmark matrix.
- An explicit visual-extractor boundary with axes and source binding.
- A permanent execution air gap: surveillance can only observe, investigate,
  or escalate.

## Retained benchmark source plan

The preferred benchmark is not a scrape of social-media trading claims. It is
an auditable combination of public filings, reproducible simulation, and
repository-rendered charts:

1. Use the SEC's [EDGAR submissions and bulk archives](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
   for timestamped financial-text routing. Derive narrow labels from filing
   form and 8-K item metadata in code, remove that metadata from model input,
   group by accession and CIK, and split by filing time. These labels measure
   routing—not investment risk or sentiment. The SEC's
   [reuse FAQ](https://www.sec.gov/about/webmaster-frequently-asked-questions)
   permits copying and distributing public EDGAR filing content.
2. Render finance-specific charts from the SEC's
   [Financial Statement Data Sets](https://www.sec.gov/data-research/sec-markets-data/financial-statement-data-sets).
   Retain the filing accession, source table, chart recipe, filing cutoff, and
   hashes. Deterministic legend, axis, source-date, and series mutations create
   exact visual-quality labels without asking a model to invent ground truth.
   Treat the structured dataset as a convenience: the filed document remains
   authoritative.
3. Generate market-surveillance ground truth with seeded
   [ABIDES](https://github.com/abides-sim/abides) scenarios under its BSD-3
   license. Report these only as synthetic anomalies. Use
   [SEC MIDAS market-structure data](https://www.sec.gov/data-research/market-structure-data)
   as real-distribution background and out-of-distribution testing; MIDAS does
   not provide manipulation labels.

[PlotQA](https://github.com/NiteshMethani/PlotQA) can test the upstream chart
extractor, but it is not finance-specific and has no forward-time finance split.
[FinQA](https://github.com/czyssrs/FinQA) can supplement numerical reasoning
tests after regrouping by issuer and report year, but it is not a triage label
set. Neither may be used to claim finance no-lookahead performance by itself.

FINRA short-sale and fixed-income feeds are fetch-only optional sources because
their terms restrict use or redistribution. SEC fails-to-deliver data is also
excluded as an abuse label: the SEC cautions that a fail does not by itself show
abusive or naked short selling. Dataset manifests must therefore retain the
source URL, license statement, redistribution flag, exact case-set hash, and
forward-time split before a completed run can be published.

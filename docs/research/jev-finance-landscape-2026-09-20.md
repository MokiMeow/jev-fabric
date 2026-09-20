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

The live official documentation scan on 20 September also confirmed a precise
implementation pattern: Noul is a single yes/no probability question;
independent Nouls may share one request and are evaluated in parallel; and the
financial-crime use-case map places ambiguous transaction narratives, KYC
documents, alert histories, entity matching, and alert prioritization behind
investigator routing. Fabric implements the narrow, read-only portion of that
pattern in `fintech-exception`: six independent indicators over a redacted case
note, followed by deterministic fail-closed route composition. It deliberately
does not adopt model-driven payment approval, identity decisions, compliance
disposition, or execution. Sources:
[Noul](https://docs.typesafe.ai/primitives/noul),
[Noul consistency](https://docs.typesafe.ai/cookbooks/consistency_noul_cookbook),
and [use-case map](https://docs.typesafe.ai/concepts/use-case-map).

Two newer stock examples make the boundary more concrete. The
[Jevinik/jevocks project](https://github.com/unicodeveloper/jevocks) uses a
retrieval provider for market, news, analyst, and macro evidence, a generative
model for the written investment thesis, and Jev for a bounded decision through
Vercel AI Gateway. The architecture is useful; its thirty-day price target is
not a validated result. The updated
[jev_stock experiment](https://github.com/sosopop/jev_stock) is more explicit:
Python owns retrieval, aligned trading dates, features, leakage checks, labels,
and scoring while Jev supplies an `up` / `flat` / `down` classification. Its
reported 54/120 result is a small retrospective community run, can be affected
by information learned by the later model, and is not evidence of predictive
edge. Fabric adopts the separation of responsibilities and prospective,
checkpointed evaluation pattern, not the forecasting claim or trade route.

A same-day application scan also found
[World Monitor's Jev expansion issue](https://github.com/koala73/worldmonitor/issues/8336),
which starts with an opt-in headline classifier and ranks additional bounded
intelligence judgments against existing code symbols. That is stronger product
evidence than a free-form demo because it identifies the current deterministic
decision point and places Jev behind a feature flag; it is still not accuracy or
latency evidence. Fabric adopts the migration pattern—shadow an existing narrow
decision, retain its old path as the comparator, and expand only after labeled
evaluation—not its domain conclusions.

Visual projects such as [jev-visual](https://github.com/hr98w/jev-visual) and
[OpenJev](https://github.com/razorback16/openjev) explore local or
Jev-compatible visual decision models. They are not evidence that the official
Jev API accepts images. Fabric therefore uses a separate visual extractor and
passes only bounded, source-bound structured annotations to Jev.

The official TypeSafe model page confirms that Jev 1.13.0 accepts text and not
image, audio, or video input. Current community implementations follow that
boundary: [TypeSafe Playground](https://github.com/TypeSafeAI/typesafe-playground)
uses OCR and reviewed descriptions, while
[Vibe Check](https://github.com/RafalWilinski/vibecheck) uses a separate vision
model to describe media before sending text to Jev. These examples establish an
integration pattern, not extractor accuracy, latency, cost, or a Jev advantage.
Fabric's text-only bridge strengthens the pattern by binding every annotation
and fixed finding to its capture/profile and explicitly removing image,
credential, URL, and execution channels.

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

The independent [Made with Jev index](https://madewithjev.com/) exposed 239
build entries and 130 linked X posts during the latest scan. Its strongest recurring
patterns were bounded browser action spaces, many questions over one subject,
and a smaller cluster of live trading demos. The index republishes author
claims; counts establish ecosystem activity only, and its quoted speed, cost,
or success figures are not benchmark evidence.

The same index linked same-day distribution announcements for OpenRouter and
Cloudflare AI Gateway. They broaden transport availability but do not make a
moving model alias reproducible, preserve identical probability semantics, or
establish equivalent latency and cost. Fabric therefore treats transport,
provider route, concrete upstream model identity, and price evidence as
separate retained fields instead of assuming gateway interchangeability.

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
- [Jev-is-odd](https://github.com/robipop22/Jev-is-odd) separates client
  round-trip time, provider-reported usage, retries, and package-consumer tests.
  Its 20-case result is intentionally tiny and task-specific; the reusable part
  is the measurement disclosure, not the correctness headline.

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

The same-day [JevBench v1.2.5](https://github.com/fstandhartinger/jevbench)
release adds a useful independent evidence pattern: frozen public and held-out
decisions, paraphrase pairs, majority-class baselines, native-versus-verbalized
probability labels, and separate intelligence, calibration, raw latency, and
cost axes. Its v1.2.3 correction is especially relevant: several systems had
decisions double-counted or metered malformed responses omitted from cost.
Fabric adopts the accounting lesson, not the composite ranking or headline
scores—every request, including malformed paid output, must be counted exactly
once and a service that routes to Jev must not be treated as a second model.
It also adds a reusable paired categorical robustness metric. Fintech evidence
now compares each held-out Noul signal under batched and serial delivery using
label agreement, total-variation distribution shift, joint correctness,
regressions, recoveries, and valid-pair coverage. Agreement without independent
gold remains stability evidence only; empty or missing pairs cannot become a
zero-error accuracy claim.

The official model page also fixes a 32k budget for `state` plus the longest
question and the jaggedness guide warns that irrelevant state reduces accuracy.
The provider-facing visual bridge therefore caps its complete annotation JSON
at 8,192 UTF-8 bytes, rejects duplicates and non-NFC text, and retains the byte
count. This is a resource ceiling rather than a token estimate; live runs must
still retain provider-reported usage.

## Official finance-adjacent recipes checked the same day

TypeSafe's current
[confidence classification cookbook](https://docs.typesafe.ai/cookbooks/classification_using_confidence)
classifies 60 selected SEC annual reports into SIC groups and falls back to a
broader division below a confidence cutoff. The reusable mechanism is a
code-owned taxonomy with a coarser safe fallback. Its published `0.9` cutoff
and percentages came from `jev-1.12` on a small, filtered sample with
self-reported labels; they are not a production threshold for `jev-1.13`, a
correctness probability, or Fabric benchmark evidence. Fabric will calibrate
each primitive, dataset, model, and route separately and may send uncertain
finance cases to a person instead of forcing a broad label.

The official
[pre-parsed extraction cookbook](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook)
matches Fabric's intended document path: a regex, parser, roster, or generative
extractor proposes literal spans; Jev selects among those candidates; code
copies the selected span verbatim and parses money, dates, identifiers, and
signs. Candidate count, normalization, locale, and arithmetic therefore remain
testable code. Jev never invents an account number or monetary amount.

The official
[citation-check cookbook](https://docs.typesafe.ai/cookbooks/citation_check)
adds a second useful stage for filings, news, and case notes. Code first proves
that a quoted span occurs in the bound source; one focused Choice then labels
the claim/span relationship as support, contradiction, or no support. Fabric's
finance path adopts that decomposition with exact claim, excerpt, document,
section, and byte-span bindings. A selected support label remains advisory
evidence: it cannot authenticate the upstream document, establish materiality,
or authorize an action. The cookbook's example confidence gate was measured on
another model version and task, so it is not copied as a finance threshold.

The current
[SDE cascade cookbook](https://docs.typesafe.ai/cookbooks/sde_cascade) and
[composite-scoring pattern](https://docs.typesafe.ai/patterns/composite-scoring)
also clarify how a later calibrated finance cascade should compose evidence.
Independent field checks may share one compact state and run together, but a
serious failed check must route by an explicit any/maximum rule rather than be
averaged away. Weighted dimensions are appropriate only for compensating,
held-out-validated preferences. Fabric does not yet ship a finance threshold
lock because its committed benchmark remains `NOT RUN`.

The official
[Jev 1.13 jaggedness note](https://docs.typesafe.ai/model-jaggedness/jev-1.13)
also rules out several unsafe finance shortcuts. It directs arithmetic,
counting, date comparison, and structural invariants to code; recommends
filtering irrelevant state; warns that state is not automatically treated as
hostile; and reserves generation for a generative model. These are now treated
as implementation constraints, not merely prompting advice.

That audit exposed one concrete contract defect in Fabric's financial-text
question: `none` was defined as a clear absence of every supported claim, while
the criteria explicitly said it was not for uncertainty between two listed
claims. With no ambiguity option, a literal model could be forced into false
specificity. Finance pack `0.2.0` therefore adds `unclear`, maps it only to
`investigate`, and requires new calibration and question-set evidence. This is
a schema-level abstention path, not a prompt asking the model to estimate its
own correctness. A follow-up adversarial review found that documentation alone
was insufficient: a driver could pair that selection with `observe`, and a
caller could supply a stale but well-formed question hash. Fabric now derives
the contract hash from the actual question shapes, checks the pack version
before execution, and independently refuses any route less restrictive than
the retained atomic selections.

Community work on [jev-align](https://github.com/sutro-sh/jev-align) suggests a
useful future evaluation loop: retain disagreements and ambiguous examples,
label them, and test revised instructions on a frozen holdout. Fabric will not
allow an optimizer to rewrite authority, no-trade policy, evidence validation,
or the final holdout. That turns error discovery into reviewable data without
turning recursive improvement into unbounded self-modification.

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

### Retained-corpus hardening plan

The next public corpus should be small enough to review and strict enough to
rebuild. Mutable discovery endpoints are never source locks: a selected object
becomes eligible only after the builder records its exact byte length, SHA-256,
canonical URL, retrieval time, source/publication cutoff, rights evidence, and
derivation policy.

For filing-text and claim/citation cases, start with 30–50 SEC-authored or EDGAR
documents and 3–6 adjudicated claims per document. Retain the literal source
span, byte offsets, normalized-span hash, bounded surrounding section,
document-body hash, accession or canonical page URL, CIK/entity group,
publication cutoff, separate operational-route gold, and one citation gold
label: `supports`, `contradicts`, or `says_nothing`. Two reviewers plus an
adjudicator should label non-exact semantic cases. Amendments stay with their
original filing, issuers/matters do not cross splits, and split windows have at
least a 30-day embargo. A reasonable preregistered first partition is training
through 2024-06-30, validation from 2024-08-01 through 2025-06-30, and test
from 2025-08-01 through the content-lock date. Later-evidence and missing-quote
probes remain explicit failure cases. The SEC's
[developer guidance](https://www.sec.gov/about/developer-resources) and
[website reuse policy](https://www.sec.gov/about/privacy-information) support
this route; attribution must not use SEC seals or imply endorsement.

For charts, select bounded rows from the SEC
[Financial Statement Data Sets](https://www.sec.gov/data-research/sec-markets-data/financial-statement-data-sets)
and retain only those public-source rows, the derivation recipe, and generated
SVGs. Quarterly ZIP URLs can be replaced, so the source ZIP must be hashed and
size-locked before offline generation. Resolve units, periods, duplicates, and
amendments in code; every point binds to an accession and accepted date. A
useful first frozen slice is 60 issuer-disjoint base charts per split, at most
two series and 4–12 points each, expanded through the five existing deterministic
render/mutation variants. All variants of a base chart remain in one split.
The [Data.gov record](https://catalog.data.gov/dataset/financial-statement-data-sets)
currently labels the dataset for public access, but the retained manifest must
still preserve a dated rights snapshot rather than rely on this sentence.

For synthetic surveillance, pin the archived
[ABIDES-JPMC revision](https://github.com/jpmorganchase/abides-jpmc-public/tree/f9cbe51342b7dedd9587e4e069040d68a5c6477f)
and preserve its
[BSD-3-Clause notice](https://github.com/jpmorganchase/abides-jpmc-public/blob/f9cbe51342b7dedd9587e4e069040d68a5c6477f/LICENSE).
Build in a network-disabled, locked environment, run every seed twice, and
retain aggregates rather than the simulator checkout or full market log.
Labels describe seeded synthetic patterns, never illegal intent. Split whole
parameter-template families—not merely random seeds—so calibration and test do
not share a scenario generator. A first slice can cover four declared labels,
three template families per label, and ten unique seeds per family, with fixed
pre/event/post windows and code-owned aggregates.

Optional corpora stay outside the core claim. The
[FinQA pinned revision](https://github.com/czyssrs/FinQA/tree/0f16e2867befa6840783e58be38c9efb9229d742)
is useful for supporting-fact and leakage regressions, but its repository
license does not by itself settle redistribution of every underlying report;
use fetch-at-build IDs/hashes until review. The
[PlotQA pinned revision](https://github.com/NiteshMethani/PlotQA/tree/e0f5c34acbe92753f70798aafda99184e3e0cd8c)
is a CC-BY-4.0 visual-parser stress set, not finance or no-look-ahead evidence.
ChartQA is not a core retained source because the rights of all crawled chart
assets are not established by the repository license alone.

The same-day community scan reinforced two negative controls. The positive
filtered result in
[trade-jev](https://github.com/justinhe16/trade-jev) was selected from many
settings on the same short window, so it is an overfitting lesson rather than
alpha evidence. The very small
[jev-tick-lab](https://github.com/shunta-furukawa/jev-tick-lab) suggests an
append-only forward ledger but publishes no usable result. Fabric adopts the
replay and forward-only mechanics, not either project's performance claim.

## Pinned-source second pass

A second source audit inspected finance projects at fixed commits and treated
their code as design evidence, not proof of returns or forecasting accuracy.
The strongest live-system separation found was
[`prism-liquidity-agent@22c67bd`](https://github.com/irfndi/prism-liquidity-agent/tree/22c67bdbe30bab608226832256a5013ad826b707):
capital-protecting exits execute before advisory calls, Jev observations are
shadow-only, transport failure becomes unknown, and the sole sizing influence
is restricted to paper mode. Fabric adopts the separation principle, not that
project's performance comments or its `fail-open` terminology.

The most useful evaluation idea came from
[`jev-alpha-bench@ce40f7a`](https://github.com/Gaurav-Gosain/jev-alpha-bench/tree/ce40f7a1c4148c26af99268122be3643bb277440):
compare correctly identified, identity-blind, wrong-identity, shuffled, and
temporal-placebo arms. A future Fabric case should hold evidence constant while
removing or deliberately misbinding instrument identity. The trusted host must
reject the wrong-subject arm before the provider or constrain it to
`investigate`/`escalate`; scoring must record binding rejection, provider-call
count, route disagreement, and the unsafe-action sink, never P&L.

The audit also reinforced recurring anti-patterns: typed model output wired to
broker authority; malformed, missing, or low-confidence results that broaden
permission; moving model aliases; historical prompts evaluated by a current
model; and credentials that silently switch a simulator into a live path. None
belongs in Fabric. A public third-party repository also exposed an apparent
TypeSafe credential; its value was not copied or used. This is additional
evidence for secret scanning and server-side credential isolation, not a test
fixture.

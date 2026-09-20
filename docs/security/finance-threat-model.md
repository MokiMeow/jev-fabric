# Finance integration threat model

This model covers the finance evidence adapter, `finance-surveillance` pack,
`finance-research-router` pack, hierarchical-confidence evaluator, and their
use through the existing Fabric runtime. Scenarios are hypotheses for review,
not confirmed vulnerabilities. The integration is an advisory surveillance,
research-routing, and evaluation component, not a trading system.

This iteration received independent correctness and security reviews. Their
accessor-execution, direct-pack binding, stale replay, bidirectional-text, and
visual-label binding findings were reproduced, fixed, and covered by
regression tests before publication.

## Overview

| Component | Responsibility | Source evidence |
| --- | --- | --- |
| Trusted finance host | Calculate exact features, authenticate and locate source excerpts, verify time cutoffs, and supply ordered candidate ids, excerpt hashes, and optional proposed-claim bindings. | `packages/adapters/src/finance.ts` |
| Finance evidence adapter | Reject stale, future, look-ahead, post-cutoff, unbound, hash-mismatched, or malformed evidence; emit no execution interface. | `packages/adapters/src/finance.ts` |
| Finance surveillance pack | Ask bounded route, anomaly, evidence-quality, influence, per-candidate claim, and claim-to-excerpt citation questions; upgrade unsafe or malformed results to review. | `packs/finance-surveillance/pack.ts` |
| Finance research router | Batch prohibited-intent, influence, fixed-tool, allowlisted-symbol, and semantic-window questions; emit only a host-revalidated read-only proposal. | `packs/finance-research-router/pack.ts` |
| Hierarchical-confidence evaluator | Fit a leaf-reporting threshold on one group partition, audit it on another, and measure deterministic parent fallback on a third without making provider calls. | `packages/evals/src/hierarchical-confidence.ts` |
| Fabric runtime | Apply state limits, candidate coverage, provider capability checks, deterministic policy, budgets, deadlines, and redacted receipts. | `packages/core/src/runtime.ts:81-83`, `packages/core/src/runtime.ts:235-237`, `packages/core/src/runtime.ts:282-317` |
| Authorized host queue | Consume only `observe`, `investigate`, or `escalate` as case-routing advice. | `packs/finance-surveillance/pack.ts:12-34` |
| Trading and order systems | Separate trust zone; no adapter, candidate, or pack output reaches it. | `packages/adapters/src/finance.ts:113`, `packs/finance-surveillance/pack.ts:109-114` |

```mermaid
flowchart LR
  A[Licensed source] --> T[Trusted calculations and cutoff]
  B[Chart or financial document] --> V[Versioned extractor]
  V --> U[Untrusted bounded annotations or excerpts]
  T --> E[Finance evidence adapter]
  U --> E
  E --> J[Jev advisory questions]
  J --> P[Fabric policy and receipt]
  P --> Q[Read-only case queue or human]
  O[Order and execution systems]:::isolated
  Q -. no authority path .-> O
  classDef isolated fill:#fee,stroke:#c33
```

| Deployment or workflow | Resource or capability | Configuration and precedence | Safe effective value or location | Readers, writers, or recipients | Enforcing control | Evidence or unknowns |
| --- | --- | --- | --- | --- | --- | --- |
| Offline example | Synthetic evidence | Source and hashes are fixed in the example. | In-memory synthetic projection. | Example runtime only. | No network; scripted provider. | `examples/finance-surveillance/index.ts` |
| Offline confidence evaluation | Labeled observations and policy configuration | Caller supplies the external dataset and question hashes; evaluator derives exact partition hashes and rejects split leakage. | In-memory evaluation evidence only. | Evaluation process and retained report consumer. | Three group-disjoint splits, concrete model identity, native semantics, Wilson risk bound, fail-closed parent fallback, policy and evaluation digests. | `packages/evals/src/hierarchical-confidence.ts`; `examples/hierarchical-confidence/index.ts` |
| Server-side advisory | Provider credential | Administrator environment and provider configuration take precedence over request state. | Server-side secret reference; never projected. | Provider adapter only. | Decision-state secret rejection and fixed provider configuration. | `packages/core/src/context.ts:122-145`; deployment secret store remains operator-owned. |
| Visual advisory | Image and extracted annotations | Trusted host selects the canonical renderer/version and binds image/source hashes, mutation, and route. Benchmark cases additionally retain unique SVG bytes and canonical compiler input. | Image and raw image hash stay outside live Fabric; bounded annotations enter as untrusted data. Mutation ids, expected routes, target-bearing seals, and gold labels stay evaluator-side and are stripped before provider projection. Benchmark SVGs remain in the evidence artifact. | Extractor, adapter, provider, benchmark verifier. | Artifact tuple hash, compiler-owned route, exact rerendered SVG-byte comparison, one-to-one asset paths, version-frozen chronology and nonlinear-scale mutations, axes literal, target-label exclusion, hostile-data snapshot, bidi/C1 rejection, and influence question. | `packages/adapters/src/finance.ts`; `packs/finance-surveillance/pack.ts`; `benchmarks/finance/scripts/drivers.test.mts`; `benchmarks/finance/builders/visual/render.mts`; `benchmarks/finance/builders/lib/verify.mts` |
| Text advisory | Extracted claim candidates | Trusted host fixes candidate ids, order, per-excerpt SHA-256 hashes, and, for every claim, its claim hash plus source-span metadata. | At most eight source-bound excerpt/claim pairs marked `untrusted_data_only`. | Extractor, adapter, provider. | Exact count/order/hash checks, strict plain-data sanitization, fixed claim taxonomy, focused citation relation question, influence question. | `packages/adapters/src/finance.ts`; `packs/finance-surveillance/pack.ts` |
| Surveillance route | Case-routing capability | Pack-owned candidate list wins over state text. | `observe`, `investigate`, `escalate`. | Fabric policy and authorized queue. | Exact candidate comparison and no `allow` result. | `packs/finance-surveillance/pack.ts:12-34`, `packs/finance-surveillance/pack.ts:238-256` |
| Research-tool proposal | Read-only descriptive analytics | Host allowlist and pack-owned catalogue take precedence over request text. | One fixed tool id plus bounded symbols/window, or `investigate`. | Trusted read-only analytics host only. | Hash-bound redacted request, exact current catalogue, sorted symbol allowlist, safety Nouls, no executor, and mandatory host revalidation. | `packs/finance-research-router/pack.ts`; `docs/integrations/finance-research-routing.md` |
| External execution | Orders, broker keys, venue sessions | Not configurable in this integration. | Absent. | None. | `execution: NOT_SUPPORTED`; no executor API. | `packages/adapters/src/finance.ts:113`; a consuming application must preserve this separation. |

## Threat model, trust boundaries, and assumptions

Protected assets are market-data integrity and licensing, temporal integrity,
customer and account privacy, feature-definition integrity, provider
credentials, case-routing correctness, audit receipts, supervisory authority,
and the isolation of order/execution systems.

Trust boundaries are:

- Source to trusted host: feeds and documents may be stale, licensed, corrupt,
  or adversarial. The host must authenticate sources and calculate exact values.
- Extractor to adapter: annotations and excerpts are untrusted even when the
  extractor is approved. Text is accepted only when every bounded plain string
  matches the trusted candidate id, position, and excerpt hash.
- Adapter to Jev: only source-bound semantic buckets, bounded annotations, and
  candidate-grounded excerpts cross. Raw prices, account data, order fields,
  images, and credentials do not.
- Jev to Fabric: answers are typed advisory evidence. A malformed or uncertain
  result escalates rather than authorizes (`packs/finance-surveillance/pack.ts:168-205`).
- Research request to Jev: request text remains untrusted; the host owns a
  closed symbol allowlist and the pack owns a closed read-only tool catalogue.
  Prohibited advice investigates, influence or malformed coverage escalates,
  and the output never invokes a tool.
- Labeled observations to evaluator: labels, group identities, confidence, the
  hierarchy, and external dataset/question hashes are caller-controlled until
  a trusted evaluation pipeline verifies them. The evaluator checks exact
  shapes, group-disjoint splits, concrete model identity, native semantics, and
  derives exact partition hashes; it does not authenticate the publisher.
- Fabric to host: receipts are redacted evidence, not authorization
  (`packages/core/src/receipt.ts:21-59`).
- Host to trading systems: outside this integration. No identity, entitlement,
  approval, order, or venue capability may be inferred from an advisory route.

Realistic attackers can control public narrative text, chart labels, document
contents, malformed JSON-like values, candidate-shaped state, timing of stale
inputs, and repeated requests within exposed application limits. They do not
start with administrator configuration, provider credentials, trusted source
keys, the approved visual extractor, broker credentials, or supervisory
authority. A compromised trusted host or operator is a deployment prerequisite,
not an unprivileged remote attacker capability.

Security objectives are to reject stale and look-ahead evidence before a model
call, preserve exact candidate coverage and ordering, prevent semantic output
from granting authority, keep secrets and raw regulated data out of state and
receipts, escalate malformed or influenced answers, bound spend and latency,
and maintain a permanent execution air gap.

Assumptions and open questions:

- The consuming host authenticates market data, owns data licences, maps opaque
  references, and enforces retention and privacy policy.
- Benchmark publication uses a trusted, single-writer output parent. The
  portable Node writer detects identity changes but does not claim resistance
  to a same-privilege process racing path replacement. Failed staging
  directories are retained for operator inspection instead of recursively
  deleted through a mutable path.
- Retained-public datasets carry a dataset-to-build-manifest hash edge, and the
  loader verifies the complete retained cases, provenance, policy, source-lock,
  and visual-asset closure before a driver runs. These unkeyed hashes detect
  drift and substitution inside the closure; they do not authenticate a
  publisher. The separate pre-publication verifier must still replay locked raw
  source bytes from a trusted cache.
- The visual extractor and axes verification are independently tested; Fabric
  verifies their declared binding, not their semantic correctness.
- Retained benchmark visuals are stronger than live extractor claims: the
  offline builder and runner rerun the deterministic compiler and compare the
  exact SVG bytes. This proves internal artifact consistency, not that an
  upstream issuer statement is truthful.
- Visual mutation ids, compiler-owned expected routes, gold routes, and their
  enumerable artifact seal are evaluator metadata. The adapter validates the
  seal and drops all four; the pack rejects their reintroduction, and a
  driver-level regression captures the exact provider request to enforce this
  boundary.
- The application maps advisory results only to read-only telemetry or an
  authorized human case queue. That host mapping is not implemented here.
- The research router's consuming host provides a genuinely read-only analytics
  executor and revalidates the tool, symbols, entitlements, data rights,
  freshness, and resource limits. Fabric intentionally does not implement that
  executor.
- Domain calibration, drift monitoring, and representative held-out evaluation
  are not yet established; the benchmark remains `NOT RUN`.
- The hierarchical evaluator is reusable evaluation machinery, not evidence
  that a production finance threshold exists. Its synthetic example proves the
  contract and fail-closed behavior only. Internally derived SHA-256 hashes
  detect observation substitution inside a retained evidence closure but are
  unkeyed and do not authenticate who produced the labels or configuration.
- Candidate claim confidence has no public threshold. Non-native confidence is
  ignored; native calibrated confidence is retained as unthresholded evidence,
  while non-`none` claims route to investigation and malformed answers escalate.
- Citation hashes and optional byte spans prove only internal binding to values
  supplied by the trusted host. The host must authenticate the document and
  locate the exact excerpt first; the adapter does not receive source bytes and
  cannot prove that a span or section hash corresponds to an authentic source.
- Jurisdiction-specific legal, suitability, best-interest, credit, AML, KYC,
  sanctions, recordkeeping, and supervisory requirements require qualified
  domain review.

## Attack surface, mitigations, and attacker stories

| Priority | Scenario and capability gain | Prerequisites | Impact | Existing controls | Mitigation | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Critical hypothesis | An advisory answer reaches an order API, gaining financial execution. | Consuming host adds an unauthorized bridge to a trading system. | Market, financial, regulatory, and credential impact. | No executor; literal `NOT_SUPPORTED`; finite non-trading candidates; pack never returns `allow`. | Keep network/process isolation, separate identities and services, and a code-reviewed positive queue mapping. | `packages/adapters/src/finance.ts:113`; `packs/finance-surveillance/pack.ts:12-34`, `packs/finance-surveillance/pack.ts:190-207` |
| Critical hypothesis | A nominally read-only research proposal is mapped to a broker, shell, URL fetcher, or mutation-capable tool. | Consuming host violates the fixed positive mapping or supplies an overprivileged credential. | Trading, exfiltration, arbitrary execution, or data-rights impact. | Pack-owned finite tool catalogue; no URL/command field; literal no-execution metadata; prohibited-intent and influence checks; mandatory host revalidation. | Isolate the analytics service, use read-only identities and fixed tool handlers, and reject every undeclared argument at the executor boundary. | `packs/finance-research-router/pack.ts`; `docs/integrations/finance-research-routing.md` |
| High hypothesis | An unlisted, stale, duplicated, or substituted symbol becomes an analytics argument. | Attacker controls request text or caller state. | Wrong-instrument research presented as if correctly bound. | Sorted unique host allowlist, fixed special outcomes, exact state snapshot and hash, stale-state rejection, two-symbol distinctness, and review on missing coverage. | Bind the executor lookup to the same allowlist revision and record the resolved dataset identity in host audit evidence. | `packs/finance-research-router/pack.ts` |
| High hypothesis | Future or stale data influences a current case, creating look-ahead or replay bias. | Attacker or bad pipeline controls timestamps or delayed data. | False surveillance conclusions and invalid evaluation. | Code orders window, cutoff, observation, and clock; signal timestamps cannot cross cutoff; state carries a bound expiry; runtime supplies trusted evaluation time and the pack rejects stale state before cache/provider access. | Authenticate source timestamps, use monotonic ingestion telemetry, and retain cutoff/source digests. | `packages/adapters/src/finance.ts`; `packages/core/src/context.ts`; `packs/finance-surveillance/pack.ts` |
| High hypothesis | An instrument reference or signal-to-time association is substituted after a case is retained. | Attacker or faulty pipeline can rewrite trusted projection fields without rebuilding their binding. | A semantically plausible model answer is attributed to the wrong instrument or time state. | A domain-separated projection binding is recomputed before provider use; the retained benchmark derives wrong-instrument and timestamp-rotation probes and requires both to fail before any driver call. | Authenticate publisher identity separately, retain signed ingestion provenance, and keep counterfactual traces outside model-accuracy metrics. | `packages/adapters/src/finance.ts`; `benchmarks/finance/scripts/run.mts`; `benchmarks/finance/scripts/validate.mts` |
| High hypothesis | Chart text injects instructions or forged authority. | Attacker controls labels, OCR text, or a document image. | Route manipulation or false dismissal. | Plain bounded annotations, C0/C1/bidi/isolate rejection, untrusted tag, independently bound annotation hash, separate influence question, and escalation on influence. | Keep extractor adversarial tests and exclude rich markup, URIs, and hidden metadata. | `packages/adapters/src/finance.ts`; `packs/finance-surveillance/pack.ts` |
| High hypothesis | A benchmark target leaks into provider-visible chart state. | Dataset or runner copies mutation ids, expected routes, gold labels, or a small-domain target digest into advisory input; a deterministic image hash can also identify a public mutation by enumeration. | Invalid accuracy claims because the answer is encoded in the request or recovered by enumeration. | Trusted adapter validates the evaluator tuple, then strips labels, the target-bearing digest, and the raw image hash; the pack rejects those fields; the driver test inspects the exact provider request. | Keep all target metadata, artifact hashes, and seals in the evaluator process and rerun the capture test whenever the visual contract changes. | `packages/adapters/src/finance.ts`; `packs/finance-surveillance/pack.ts`; `benchmarks/finance/scripts/drivers.test.mts` |
| High hypothesis | A document extractor swaps, inserts, or reorders excerpts after trusted selection. | Attacker controls extractor output after candidate bindings are created. | A claim label is attached to the wrong source text. | Candidate ids are trusted; arrays are dense and bounded; count, order, and every excerpt SHA-256 must match exactly. | Create bindings only after source authentication and retain the document/source binding hash. | `packages/adapters/src/finance.ts` |
| High hypothesis | A proposed financial claim is paired with the wrong quote or a quote that contradicts it. | Extractor or upstream generator controls claim text or citation pairing. | Misleading claim enters analyst workflow with apparent source support. | Claim hashes are all-or-none and order-bound with excerpt hashes and mandatory source spans; one exact-path Choice checks support, contradiction, or insufficient context; contradiction and malformed coverage escalate. | Authenticate the document, locate the quote in host code before binding, retain the source span, and evaluate performance on representative finance citations. | `packages/adapters/src/finance.ts`; `packs/finance-surveillance/pack.ts` |
| High hypothesis | State forges a permissive candidate or replaces descriptions. | Caller controls decision state. | New semantic route with unintended authority. | Pack compares the entire ordered candidate catalogue exactly and returns unavailable on mismatch. | Keep candidates pack-owned; never accept remote pack definitions for finance. | `packs/finance-surveillance/pack.ts:77-80`, `packs/finance-surveillance/pack.ts:238-256` |
| Medium hypothesis | Model error or uncalibrated confidence silently becomes a precise financial claim. | Provider returns a wrong, incomplete, tied, weak, or non-native-confidence selection. | Misleading evidence specificity or a missed case. | Claim options and parent mapping are code-owned; non-native confidence is ignored; no calibrated tier is claimed; non-`none` claims investigate and malformed sets escalate. Provider failure and outage escalate. | Establish versioned thresholds only from representative held-out finance evidence and monitor selective risk and drift. | `packs/finance-surveillance/pack.ts` |
| Medium hypothesis | Poisoned labels, group leakage, or observation substitution admits an unsafe hierarchical threshold. | Attacker or faulty pipeline controls evaluation rows, grouping, model identity, taxonomy, or retained evidence. | Misleadingly specific document labels or invalid evaluation claims. | Exact plain-data validation; unique rows; group-disjoint fit, audit, and test splits; minimum independent-group coverage; one-sided Wilson risk bound; concrete model and native-semantics checks; exact partition, policy, and evaluation hashes; failed fit or audit forces parent-only output. The result grants no financial authority. | Authenticate the dataset publisher separately, pre-register grouping and acceptance criteria, retain signed provenance, review label quality, and monitor post-deployment drift. | `packages/evals/src/hierarchical-confidence.ts`; `packages/evals/test/hierarchical-confidence.test.ts` |
| Medium hypothesis | Licensed, personal, or account data leaks to a provider or receipt. | Host includes raw values despite the contract or weakens state controls. | Privacy, contractual, or regulatory impact. | Adapter schema contains refs, hashes, buckets, and bounded annotations; strict objects reject extra order fields; runtime rejects recognizable secrets; receipts reject sensitive keys. | Add deployment DLP, field allowlists, regional controls, retention rules, and provider agreements. | `packages/adapters/src/finance.ts:104-169`; `packages/core/src/context.ts:122-180`; `packages/core/src/receipt.ts:21-59` |
| Medium hypothesis | Backtest tuning overfits or uses future information while appearing accurate. | Developer repeatedly tunes on the test interval or omits dataset/version metadata. | Misleading public or internal performance claim. | Benchmark requires forward time split, retained metadata for completed results, null metrics for `NOT_RUN`, and zero execution attempts. | Pre-register splits and acceptance criteria; add untouched final holdout and regime slices. | `benchmarks/finance/scripts/validate.mjs` |
| Low hypothesis | Repeated calls exhaust provider or budget capacity. | Public application lacks rate isolation or operator budgets. | Cost and availability degradation. | Runtime scheduler, request/token budgets, bounded retries, max questions, and deadlines. | Add tenant quotas, circuit breakers, observability, and provider-specific rate limits. | `packages/core/src/runtime.ts:235-237`, `packages/core/src/runtime.ts:282-317` |

## Severity calibration (Critical, High, Medium, Low)

- **Critical:** a reachable path gives an untrusted caller real order entry,
  broker credentials, withdrawal, settlement, or protected-account authority.
  No such path exists in this integration; adding one changes the product and
  requires a new threat model.
- **High:** untrusted evidence can bypass the execution air gap, defeat a hard
  temporal or candidate boundary, or expose highly sensitive financial data at
  scale. A documented but unreachable trading API is not high without a path
  from attacker-controlled input.
- **Medium:** model error, prompt influence, data leakage, overfitting, or
  resource exhaustion can materially misroute advisory cases but cannot place
  trades or grant authority because independent controls remain effective.
- **Low:** bounded self-only telemetry errors, diagnostic detail, or local
  denial of an advisory result with no cross-user, financial, privacy, or
  authority impact.

Confidence in a scenario describes evidence quality, not severity. Missing
deployment evidence stays an open prerequisite; it must not be converted into a
finding or an assumption that a control exists.

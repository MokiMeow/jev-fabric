# Finance integration threat model

This model covers the finance evidence adapter, `finance-surveillance` pack,
and their use through the existing Fabric runtime. Scenarios are hypotheses for
review, not confirmed vulnerabilities. The integration is an advisory
surveillance component, not a trading system.

The architecture pass for this iteration was performed sequentially by the
implementing agent; it was not an independent security review.

## Overview

| Component | Responsibility | Source evidence |
| --- | --- | --- |
| Trusted finance host | Calculate exact features, bind licensed sources, verify time cutoffs and visual extractor identity. | `packages/adapters/src/finance.ts:200` |
| Finance evidence adapter | Reject stale, future, look-ahead, post-cutoff, unbound, or malformed evidence; emit no execution interface. | `packages/adapters/src/finance.ts:113`, `packages/adapters/src/finance.ts:200-261` |
| Finance surveillance pack | Ask bounded route, anomaly, evidence-quality, and influence questions; upgrade unsafe or malformed results to review. | `packs/finance-surveillance/pack.ts:46-205` |
| Fabric runtime | Apply state limits, candidate coverage, provider capability checks, deterministic policy, budgets, deadlines, and redacted receipts. | `packages/core/src/runtime.ts:81-83`, `packages/core/src/runtime.ts:235-237`, `packages/core/src/runtime.ts:282-317` |
| Authorized host queue | Consume only `observe`, `investigate`, or `escalate` as case-routing advice. | `packs/finance-surveillance/pack.ts:12-34` |
| Trading and order systems | Separate trust zone; no adapter, candidate, or pack output reaches it. | `packages/adapters/src/finance.ts:113`, `packs/finance-surveillance/pack.ts:109-114` |

```mermaid
flowchart LR
  A[Licensed source] --> T[Trusted calculations and cutoff]
  B[Chart or document image] --> V[Versioned visual extractor]
  V --> U[Untrusted bounded annotations]
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
| Server-side advisory | Provider credential | Administrator environment and provider configuration take precedence over request state. | Server-side secret reference; never projected. | Provider adapter only. | Decision-state secret rejection and fixed provider configuration. | `packages/core/src/context.ts:122-145`; deployment secret store remains operator-owned. |
| Visual advisory | Image and extracted annotations | Trusted host selects extractor/version and binds image/source hashes. | Image stays outside Fabric; bounded annotations enter as untrusted data. | Extractor, adapter, provider. | Axes literal, source hash, hostile-array sanitizer, influence question. | `packages/adapters/src/finance.ts:58-95`, `packages/adapters/src/finance.ts:264-323` |
| Surveillance route | Case-routing capability | Pack-owned candidate list wins over state text. | `observe`, `investigate`, `escalate`. | Fabric policy and authorized queue. | Exact candidate comparison and no `allow` result. | `packs/finance-surveillance/pack.ts:12-34`, `packs/finance-surveillance/pack.ts:238-256` |
| External execution | Orders, broker keys, venue sessions | Not configurable in this integration. | Absent. | None. | `execution: NOT_SUPPORTED`; no executor API. | `packages/adapters/src/finance.ts:113`; a consuming application must preserve this separation. |

## Threat model, trust boundaries, and assumptions

Protected assets are market-data integrity and licensing, temporal integrity,
customer and account privacy, feature-definition integrity, provider
credentials, case-routing correctness, audit receipts, supervisory authority,
and the isolation of order/execution systems.

Trust boundaries are:

- Source to trusted host: feeds and documents may be stale, licensed, corrupt,
  or adversarial. The host must authenticate sources and calculate exact values.
- Visual extractor to adapter: annotations are untrusted even when the
  extractor is approved. The adapter accepts bounded plain strings and hashes
  the exact annotation set (`packages/adapters/src/finance.ts:264-323`).
- Adapter to Jev: only source-bound semantic buckets and bounded annotations
  cross. Raw prices, account data, order fields, images, and credentials do not.
- Jev to Fabric: answers are typed advisory evidence. A malformed or uncertain
  result escalates rather than authorizes (`packs/finance-surveillance/pack.ts:168-205`).
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
- The visual extractor and axes verification are independently tested; Fabric
  verifies their declared binding, not their semantic correctness.
- The application maps advisory results only to read-only telemetry or an
  authorized human case queue. That host mapping is not implemented here.
- Domain calibration, drift monitoring, and representative held-out evaluation
  are not yet established; the benchmark remains `NOT RUN`.
- Jurisdiction-specific legal, suitability, best-interest, credit, AML, KYC,
  sanctions, recordkeeping, and supervisory requirements require qualified
  domain review.

## Attack surface, mitigations, and attacker stories

| Priority | Scenario and capability gain | Prerequisites | Impact | Existing controls | Mitigation | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Critical hypothesis | An advisory answer reaches an order API, gaining financial execution. | Consuming host adds an unauthorized bridge to a trading system. | Market, financial, regulatory, and credential impact. | No executor; literal `NOT_SUPPORTED`; finite non-trading candidates; pack never returns `allow`. | Keep network/process isolation, separate identities and services, and a code-reviewed positive queue mapping. | `packages/adapters/src/finance.ts:113`; `packs/finance-surveillance/pack.ts:12-34`, `packs/finance-surveillance/pack.ts:190-207` |
| High hypothesis | Future or stale data influences a current case, creating look-ahead or replay bias. | Attacker or bad pipeline controls timestamps or delayed data. | False surveillance conclusions and invalid evaluation. | Code orders window, cutoff, observation, and clock; signal timestamps cannot cross cutoff; max age enforced. | Authenticate source timestamps, use monotonic ingestion telemetry, and retain cutoff/source digests. | `packages/adapters/src/finance.ts:201-231` |
| High hypothesis | Chart text injects instructions or forged authority. | Attacker controls labels, OCR text, or a document image. | Route manipulation or false dismissal. | Plain bounded annotations, untrusted tag, independent influence question, influence forces escalation. | Add extractor adversarial tests and exclude rich markup, URIs, and hidden metadata. | `packages/adapters/src/finance.ts:264-323`; `packs/finance-surveillance/pack.ts:142-149`, `packs/finance-surveillance/pack.ts:174-181` |
| High hypothesis | State forges a permissive candidate or replaces descriptions. | Caller controls decision state. | New semantic route with unintended authority. | Pack compares the entire ordered candidate catalogue exactly and returns unavailable on mismatch. | Keep candidates pack-owned; never accept remote pack definitions for finance. | `packs/finance-surveillance/pack.ts:77-80`, `packs/finance-surveillance/pack.ts:238-256` |
| Medium hypothesis | Model error or flat probabilities silently becomes a routine observation. | Provider returns wrong, incomplete, tied, or weak selection. | Missed case or delayed review. | Every answer needs full option coverage and selected probability floor; malformed sets escalate. Provider failure and outage escalate. | Calibrate floors per held-out regime and track selective risk and drift. | `packs/finance-surveillance/pack.ts:61`, `packs/finance-surveillance/pack.ts:168-205`, `packs/finance-surveillance/pack.ts:208-236` |
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

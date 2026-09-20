# Tool-environment evidence plan

Evidence: `NOT RUN` (evidence class, 2026-09-20). Source metadata policy
baseline: 2026-09-19; no environment version, hardware, machine, or region is
retained for the unrun matrix.

This is a measurement plan, not a performance claim. Jev Fabric does not yet
contain a retained browser, WebMCP, Blender, Unreal Engine, Unity, Godot, or
FreeCAD benchmark result. In particular, no conclusion about browser speed,
tool-call speed, accuracy, cost, or a Jev advantage over a host planner follows
from the scaffold.

The corresponding offline corpus and validator live in
[`benchmarks/tool-environments`](../../benchmarks/tool-environments/README.md).
They define the evidence needed before a claim can be published.

One [single-run WebMCP transport smoke observation](../../benchmarks/tool-environments/observations/webmcp-transport-smoke-2026-09-20.md)
is retained separately. It establishes only that a read-only WebMCP path was
reachable once; it is not a comparison or a Jev/browser performance result.

## What Jev is suited to in tool environments

Jev is a bounded, typed decision component. In these environments it can help
rank or gate a small, host-provided set of actions when the hard work is
semantic selection: which already-approved tool applies, whether a candidate is
too risky for the current state, or whether a host should abstain and ask for
review. It is not a replacement for the host tool, its security model, a
browser driver, a visual perception system, geometry kernels, compilers, or
render engines.

The safe composition is:

```text
trusted host projection -> bounded candidate list -> planner proposal
  -> optional Jev typed advisory evidence -> trusted policy/freshness gate
  -> host invocation -> verification + redacted receipt
```

The host, not Jev, must own identity, capability authorization, credentials,
freshness checks, action tickets, and the irreversible execution boundary.
Jev output must never be interpreted as executable code or authorization.

## Architecture comparison

| Architecture | Use it when | What it measures | Important limitation |
| --- | --- | --- | --- |
| Direct deterministic | The trusted host already knows the exact bounded action. | Host discovery, invocation, verification, and replay overhead. | It does not test semantic selection. |
| Host planner only | A host planner must select among bounded actions. | Planner selection, policy rejection, and host completion. | Planner output remains untrusted. |
| Host planner + Jev gate | Selection needs a typed advisory score/choice/abstention before execution. | The same host work plus Jev evaluation and its effect on decision quality. | Jev adds a phase; it cannot be assumed faster or cheaper. |

All variants must receive the same trusted projection, candidate ordering,
action budget, stale-state cases, and replay fixtures. Do not compare a direct
read operation to a planner-led mutation, or compare a warmed browser process
to a cold desktop application.

## Environment fit

| Environment | High-value bounded decision | Keep outside Jev |
| --- | --- | --- |
| WebMCP declarative | Select an exposed low-risk form operation or abstain. | Browser permission, origin policy, form submission, and validation. |
| WebMCP imperative | Choose among explicit host-provided tools and flag a consequential action for review. | Tool implementation, capability exposure, and cross-origin control. |
| DOM/CDP browser automation | Route among validated selectors/actions and reject stale DOM state. | CDP transport, selector execution, download handling, and credentials. |
| Visual browser fallback | Decide whether to request visual fallback or a human review after structured routes fail. | Screenshot interpretation and pointer/keyboard execution. |
| Blender | Select a reversible, ticketed editor operation from a curated list. | `bpy`/operator execution, scene mutation, saving, rendering, and asset paths. |
| Unreal Engine | Triage a bounded editor/asset operation or test failure. | Editor scripting, build/cook/package, source control, and deployment. |
| Unity | Prioritize a bounded scene/editor/test action. | Editor APIs, compilation, asset import, build, and publish. |
| Godot | Select a bounded debug or editor action. | Engine APIs, project mutation, export, and credentials. |
| FreeCAD | Route a read-only inspection or reversible model-view action. | CAD geometry, document mutation, export, and file handling. |

For every consequential operation—sending, purchasing, publishing, deleting,
exporting, committing, building for release, or changing protected assets—the
benchmark must include a rejected candidate. A positive score must not bypass
the host's confirmation or authorization rule.

## Visual-observation boundary

The generic visual-observation envelope is conformance-only, not a vision or
performance feature. It source-binds a chart, browser viewport, or DCC viewport
artifact hash and bounded extractor metadata to an exact trusted environment
projection; any annotation remains `untrusted_data_only`. It deliberately does
not load image bytes or provide browser, renderer, OCR, pointer, keyboard, or
desktop control.

Before a visual fallback can contribute to a retained run, test capture-binding
rejection for changed state/capability/frame-derived context/artifact/extractor,
stale capture rejection, and hostile annotation rejection. Measure the external
extractor and host action phases separately. No retained result currently
measures visual extraction accuracy, browser speed, or a Jev advantage.

The optional fixed visual extractor-profile attachment is also conformance-only.
It verifies that a bounded finding ID belongs to a trusted extractor/profile
vocabulary and is hash-bound to an existing visual observation. Strict profile
mode additionally binds the profile digest into the capture tuple and trusted
capture equality. It does not measure whether the finding is visually correct,
complete, calibrated, or useful. Before reporting visual quality, retain a
replayable corpus with independently reviewed expected finding IDs, artifact
digests, extractor/profile versions, abstentions, stale and profile-swap
attacks, and per-class error denominators. Do not retain image bytes,
proprietary scene contents, or browser user data in this repository.

The text-only visual bridge is likewise conformance-only. It proves that a
provider-facing state contains bounded extractor text and code-reviewed finding
dispositions, not pixels, image URLs, credentials, coordinates, selectors, or
an execution channel. Measure bridge validation in the projection/policy phase
and measure image capture, OCR, or vision extraction as a separate phase. A
passing bridge is not evidence of visual correctness, multimodal Jev support,
extractor accuracy, browser performance, or a Jev latency/cost advantage.
The bridge's 8,192-byte annotation-JSON ceiling is a conformance and resource
bound, not a measured token count. Retained live evidence must record the
provider-reported input tokens and cost rather than converting bytes into a
claimed token total.

## WebMCP maturity and security

WebMCP is relevant because it can expose structured web tools to an agent,
avoiding brittle interpretation of arbitrary page markup. It is not a general
guarantee of faster browser automation. The [WebMCP Community Group draft
repository](https://github.com/webmachinelearning/webmcp) is not a W3C
Standard; Chrome's origin-trial material describes the API as an experimental
Chrome capability. Treat it as optional and feature-detect it; retain a
structured DOM/CDP path and a human-safe fallback.

The host integration should follow Chrome's tool-safety guidance: scope
cross-origin exposure, declare read-only and consequential hints truthfully,
keep tool and parameter descriptions concise, and assume prompt injection
remains possible. The benchmark should separately record tool discovery and
invocation so a faster discovery path cannot hide a slower or less safe action
path.

An independent community implementation, [`jev-browser` at commit
`8d90c51b`](https://github.com/jkudish/jev-browser/commit/8d90c51bedbe7cd07596bfaa532ded019a31d2a8),
provides useful design evidence: it batches a bounded action Choice with goal
and stuck Nouls, keeps stop gates in code, distinguishes proposed from executed
actions, and retains provider usage. Its repository-level speed and cost
figures are community reports, not Jev Fabric measurements, and are not copied
into this benchmark. The design reinforces the need to count provider requests
instead of treating several questions in one Jev request as several calls.

## Required retained measurements

One result row exists for each environment/architecture pair. Record only
monotonic host timings; do not derive timing from model timestamps or wall-clock
time.

| Field | Definition |
| --- | --- |
| `host_discovery` | Tool enumeration or validated host-state projection. |
| `visual_extraction` | External OCR/vision/extractor processing; absent when no visual fallback is used. |
| `host_planning` | Host planner proposal time; absent for direct deterministic. |
| `jev_evaluation` | Jev request/response time; absent without the Jev gate. |
| `policy_gate` | Candidate coverage, policy, ticket, and freshness validation. |
| `host_invocation` | Browser/editor/CAD API call through checked completion. |
| `verification` | Post-action invariant check and redacted receipt creation. |
| `replay_check` | Same-projection replay comparison; no live re-execution required. |

For each populated phase, retain the per-trial monotonic duration. Artifact
schema version 2 recomputes p50, p95, and p99 with deterministic linear
interpolation at `(n - 1) * p`; supplied aggregates are not trusted. Also record
the cold/warm process condition, concurrency, host/browser/engine version,
OS/CPU/GPU, test fixture digest, provider/model/prompt/policy versions, and
network region when a live provider is used. Percentiles are not additive;
compute any end-to-end distribution from per-attempt traces.

Report these outcome metrics with denominators:

- Success rate: trials that proposed the expected candidate and then either
  executed it for an allow case or rejected it for a deny case, divided by all
  retained trials. Pre-decision and provider failures remain in the denominator.
- Safe-outcome rate: trials in which no unsafe host action occurred, divided by
  all retained trials. A pre-invocation failure is safe but unsuccessful; an
  unexpected execution, or any execution for a deny case, is unsafe. This is
  derived from the manifest policy and retained execution, not a trace boolean.
- Replay-pass rate: retained same-projection decision replays that match the
  recorded decision divided by all trials; every version-2 task declares the
  replay contract. The original decision digest is recomputed from the trace,
  then compared with the separately retained replay digest.
- Stale-rejection rate: intentionally stale projections rejected before host
  invocation divided by all trials; every version-2 task includes a stale
  subcase. A distinct stale-state digest, proposal, execution, invocation count,
  decision, and domain-bound evidence digest are retained; rejection is derived
  only when no action was executed or invoked.
- Tokens and cost: each provider request retains purpose, provider, resolved
  model, usage, integer nano-USD cost, cost basis, request-contract digest,
  redacted usage-evidence digest, and credential-free HTTPS pricing provenance.
  Version 2 reconciles per-request fields to each trace and then recomputes the
  aggregate. `reviewed_rate_estimate` remains an estimate; do not label it an
  invoice. A run without the required provenance cannot be published as a
  completed comparison.

The domain-separated binding digests detect edits and cross-trial substitution
inside the retained artifact set. They do not authenticate who created the
artifact, whether the provider emitted the usage record, or whether an external
price source is true. Strong public cost claims require the redacted source
evidence and independent provenance review in addition to passing this
validator.

Version 2 requires a unique trial ID in each environment/architecture cell and
the exact same trial-ID set in all three architecture arms. It recomputes a
two-sided 95% Wilson interval over those paired trials for every binary rate.
That interval quantifies repeat-trial uncertainty for the declared task only;
it is not evidence of generalization to other tasks. A future multi-task corpus
must use a new artifact version with group-aware resampling rather than pooling
dependent trials. Do not publish an interval from zero samples, and never treat
Jev Choice/Score confidence or a Noul probability as observed correctness.

## Run discipline

Start with deterministic, offline fixtures. A live Jev run needs an explicit
`--live` switch, an allowlisted provider, explicit credentials, an action
budget, a token/cost budget, and an invocation time limit. Use redacted,
hash-based receipts; do not retain browser cookies, user data, proprietary
scene contents, raw credentials, or sensitive prompts.

Do not mix machines, engine versions, display backends, browser channels,
network regions, candidate sets, or safety policies inside a claimed comparison.
If any of those change, publish a new run rather than overwriting a prior
result.

Completed aggregate rows are accepted only when they exactly equal the rows
independently recomputed from retained traces. The validator also rejects
duplicate trial IDs, unpaired architecture arms, candidates outside the
manifest, a successful run that did not execute the expected safe candidate,
unbound replay/stale checks, inconsistent provider accounting, model aliases
for Jev calls, credentialed pricing URLs, and provider-call provenance drift.

## Current conclusion

The intended high-leverage use is a semantic gate in front of a bounded,
already-authorized host toolset—not a replacement for browser automation or
desktop-engine execution. Whether that trade-off improves task success or
safety enough to justify its additional latency and provider cost remains
`NOT RUN` for every environment in this repository.

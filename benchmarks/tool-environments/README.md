# Tool-environment benchmark scaffold

This directory is an offline benchmark contract for bounded tool selection in
browser and desktop-host environments. It compares three execution boundaries:

- `direct_deterministic`: a trusted host calls the already-selected bounded
  tool. No model or planner selects an action.
- `host_planner_only`: a host planner proposes a bounded action and policy
  validates it.
- `host_planner_jev_gate`: a host planner proposes a bounded action; Jev
  supplies advisory typed evidence; the trusted host policy still decides
  whether to invoke the action.

It intentionally contains no measurements. The supplied fixture is
`NOT_RUN`, so every performance, quality, cost, and confidence value is null.
That distinction is essential: adding Jev adds an evaluation phase, and it is
not valid to claim a latency, cost, accuracy, or browser-reliability benefit
until a target host run produces retained evidence.

## What is covered

The task fixture covers `webmcp_declarative`, `webmcp_imperative`,
`browser_dom_cdp`, `browser_visual_fallback`, `blender`, `unreal_engine`,
`unity`, `godot`, and `freecad`. Each environment has one bounded,
replayable scenario and all three architectures in the same candidate order.
The fixture is a contract, not a claim that a given host integration exists or
is production-ready.

## Run the offline validation and report

```sh
node benchmarks/tool-environments/scripts/validate-and-report.mjs
```

To validate and render retained evidence without modifying the checked-in
fixture, provide a directory containing `task-manifest.json`, `result.json`,
and one JSON file per execution in `traces/`:

```sh
node benchmarks/tool-environments/scripts/validate-and-report.mjs --artifacts-dir ./retained-run
```

The script performs no network activity and prints a Markdown report. It
rejects a `NOT_RUN` record that contains a fabricated timing, success rate,
token count, cost, or confidence interval. A real runner should write new
artifacts outside this fixture, retain redacted traces and hashes, then update
the evidence document with the machine, versions, host setup, sample counts,
and limitations.

This is a release gate in the root `verify` command. It validates each artifact
against the checked-in Draft 2020-12 JSON Schema, then checks cross-artifact
identity, matrix completeness, rate bounds, ordered timing percentiles,
confidence-interval ordering, and populated traces for completed evidence.
For completed evidence it also requires exactly `sampleCount` unique traces for
every environment/architecture cell, identical paired trial IDs across all
three architectures, and renders the actual retained state and rates instead
of the placeholder report.

Artifact schema version 2 records the bounded candidate proposed and executed,
per-trace provider request/token/cost accounting, policy and request-contract
digests, resolved models, redacted usage evidence, pricing provenance, replay
and stale-state evidence, and a unique trial ID. Safety, replay, and stale
outcomes are derived from those fields rather than accepted as booleans. The
validator independently reconstructs every completed result row from the
traces: outcome rates, per-phase p50/p95/p99 timings, total tokens,
ledger-reconciled nano-USD cost, and two-sided 95% Wilson intervals. A
syntactically valid but altered aggregate is rejected. Timing quantiles use
deterministic linear interpolation at `(n - 1) * p`; the intervals describe
repeated trials of the declared task, not accuracy on an undeclared task
population.

The domain-separated hashes detect artifact drift and cross-trial substitution;
they do not authenticate the publisher, provider, invoice, or external pricing
page. A public cost claim still needs the retained redacted source evidence and
an independently reviewable provenance chain.

An attempted trial that fails before proposal or provider evaluation is still
a `COMPLETED` trace with outcome `failure`, zero or partial accounting, and a
failed success-rate observation. This keeps failures in the denominator. A
fatal run that cannot produce the full paired matrix is not a publishable
result artifact. Each trace also records whether the host invocation was
attempted, so a deny-case invocation cannot appear safe merely because no
completed action ID was retained.

The loader accepts at most 100 paired samples per cell, 2,700 trace files, and
64 KiB per trace; schemas, manifests, and results have separate byte limits.
It reads through verified file handles, rejects symlinks and unsupported trace
directory entries, and never loads an unbounded trace set in parallel.

## Local live runner

`scripts/live-runner.mjs` is the only supported path for creating a retained
v2 artifact from a local tool run. It never treats a screenshot, a manually
written verification record, or a provider response as execution proof. For
every completed trace it requires a real, explicitly configured adapter
process, hashes its executable identity, version output, exact bounded command
contract, stdout, stderr, fixture, and binds those redacted hashes to the
trace. The validator rejects a completed trace with only replay/stale checks.

It is intentionally opt-in and finite:

```sh
node benchmarks/tool-environments/scripts/live-runner.mjs --live \
  --manifest ./live/task-manifest.json --config ./live/local-adapters.json \
  --artifacts-dir ./live/retained-run --samples 3 \
  --max-provider-calls 2 --max-input-tokens 12000 --max-output-tokens 4000 \
  --deadline-ms 30000
```

The manifest must already be a non-`NOT_RUN` corpus. The runner preserves its
explicit evidence state; it does not promote the checked-in scaffold or turn a
partial `LOCAL_EXPLORATORY` matrix into public retained evidence. The artifact
directory must not already exist, which avoids silently mixing prior results
with a new run. Network calls occur only in the separately configured bounded
provider callback processes.

`local-adapters.json` has this bounded shape (all executable paths are absolute
and are checked as regular files):

```json
{
  "schemaVersion": "jev.tool-environment.live-config/v1",
  "adapters": {
    "playwright_chrome_webmcp_declarative": { "command": "C:/tools/webmcp-adapter.exe", "args": [] },
    "playwright_chrome_webmcp_imperative": { "command": "C:/tools/webmcp-adapter.exe", "args": [] },
    "playwright_chrome_dom_cdp": { "command": "C:/tools/browser-adapter.exe", "args": [] },
    "playwright_chrome_visual_fallback": { "command": "C:/tools/browser-adapter.exe", "args": [] },
    "blender_cli": { "command": "E:/Blender/blender.exe", "args": ["--background"] },
    "godot_cli": { "command": "E:/Godot/Godot.exe", "args": ["--headless"] },
    "freecad_cli": { "command": "E:/FreeCAD/bin/FreeCADCmd.exe", "args": [] }
  },
  "hostPlanner": { "command": "C:/tools/host-planner.exe", "args": [] },
  "jevEvaluator": { "command": "C:/tools/jev-evaluator.exe", "args": [] }
}
```

Adapters receive one JSON request on standard input and must return exactly one
`jev.tool-environment.adapter-result/v1` JSON value on standard output. It
must echo `taskId`, `environment`, `architecture`, `trialId`,
`trustedStateDigest`, and `fixtureDigest`, declare
`executionKind: "actual_adapter_execution"`, retain an adapter-generated
`executionId`, phase timings, the proposal and policy-authorized invocation,
and a `success`, `failure`, or `rejected` outcome. The runner never retains
that raw response. The host-planner and Jev-evaluator commands are separate
typed callback boundaries; they must each return a bounded candidate plus the
redacted provider accounting fields required by `trace.schema.jsonc`. Their
candidate is revalidated against the manifest before the adapter gets an
allow decision.

The four Playwright/Chrome adapters correspond to declarative WebMCP,
imperative WebMCP, DOM/CDP, and visual fallback. Blender, Godot, and FreeCAD
are supported through their own explicit local adapter. Unity and Unreal are
deliberately *not* simulated: a corpus including either fails before any
output directory is created until a real adapter is implemented. This means a
complete 27-cell retained artifact cannot be honestly minted from the supplied
nine-environment scaffold today.

For a local experimental run, `scripts/create-local-live-inputs.mjs` derives a
seven-environment manifest and an explicit adapter configuration from the
checked-in scaffold. It binds installed Chrome, Blender, Godot, and FreeCAD
paths, uses a loopback Ollama planner, and uses native Jev only at the evaluator
boundary. The helper requires `--live-inputs`; it does not execute anything or
make provider calls. The first-party experimental adapter performs real,
reversible fixture actions and returns typed evidence to the runner:

```sh
node benchmarks/tool-environments/scripts/create-local-live-inputs.mjs \
  --live-inputs --output ./.artifacts/tool-live-inputs-v1 \
  --chrome C:/path/to/chrome.exe --blender E:/path/to/blender.exe \
  --godot E:/path/to/godot.exe --freecad E:/path/to/FreeCADCmd.exe
```

This path can produce 21 measured cells (seven environments by three
architectures). The six Unity and Unreal cells remain explicitly blocked until
real installed-engine adapters can prove an action; they are never backfilled
with simulated results.

## Artifact contract

All `*.jsonc` artifacts are strict JSON encoded with a JSONC extension so the
repository's historical-artifact validator does not mistake an unrun fixture
for published benchmark evidence.

| Artifact | Purpose |
| --- | --- |
| `schema/task-manifest.schema.jsonc` | Input corpus, environment matrix, bounded candidates, and safety/replay expectations. |
| `schema/trace.schema.jsonc` | One redacted execution trace with a paired trial ID, bounded proposal/execution, derived safety/replay/stale checks, phase-level monotonic timings, and provenance-bound provider accounting. |
| `schema/result.schema.jsonc` | Aggregate result contract, including p50/p95/p99, outcome rates, tokens/cost, and confidence intervals. |
| `fixtures/task-manifest.not-run.jsonc` | Nine-environment, three-architecture corpus. |
| `fixtures/trace.not-run.jsonc` | A non-executed trace envelope. |
| `fixtures/result.not-run.jsonc` | Null-only aggregate result. |

The complete operating rationale, WebMCP maturity note, and measurement rules
are in [`docs/evidence/tool-environments.md`](../../docs/evidence/tool-environments.md).

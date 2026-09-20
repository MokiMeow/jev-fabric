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
every environment/architecture cell and renders the actual retained state and
rates instead of the placeholder report.

## Artifact contract

All `*.jsonc` artifacts are strict JSON encoded with a JSONC extension so the
repository's historical-artifact validator does not mistake an unrun fixture
for published benchmark evidence.

| Artifact | Purpose |
| --- | --- |
| `schema/task-manifest.schema.jsonc` | Input corpus, environment matrix, bounded candidates, and safety/replay expectations. |
| `schema/trace.schema.jsonc` | One redacted execution trace with phase-level monotonic timing observations. |
| `schema/result.schema.jsonc` | Aggregate result contract, including p50/p95/p99, outcome rates, tokens/cost, and confidence intervals. |
| `fixtures/task-manifest.not-run.jsonc` | Nine-environment, three-architecture corpus. |
| `fixtures/trace.not-run.jsonc` | A non-executed trace envelope. |
| `fixtures/result.not-run.jsonc` | Null-only aggregate result. |

The complete operating rationale, WebMCP maturity note, and measurement rules
are in [`docs/evidence/tool-environments.md`](../../docs/evidence/tool-environments.md).

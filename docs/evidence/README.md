# Evidence and claims
Every public claim should name its evidence class and link to a committed artifact.

| Evidence class | Meaning | What it cannot establish |
| --- | --- | --- |
| `unit` | deterministic local test | provider quality or deployment performance |
| `integration` | local component boundary test | external host behavior without a host run |
| `local_exploratory` | retained local experiment | held-out or general performance |
| `NOT RUN` | no committed evidence | any positive result |

The committed [historical manifest](../../benchmarks/historical/v0/manifest.json) is `local_exploratory`; date: 2026-09-19; model field: `jev-1.13.0`; cases: 0; machine and region: redacted/not retained. It explicitly says the prior ECE used TypeSafe confidence rather than `max(distribution)` and is invalid; no corrected ECE is reported. Do not treat confidence as correctness probability.

The [tool-environment benchmark scaffold](../../benchmarks/tool-environments/README.md) and its [measurement rules](tool-environments.md) cover browser/WebMCP, Blender, Unreal, Unity, Godot, and FreeCAD. Its committed aggregate fixture is `NOT_RUN`; null values are intentional, and the validator rejects fabricated metrics in an unrun result.

The [finance benchmark contract](../../benchmarks/finance/README.md) covers
market surveillance, structured visual evidence, and financial-text triage
across deterministic, host-model, Jev-only, and combined architectures. It is
also `NOT RUN`; no accuracy, calibration, latency, cost, or market-performance
claim is established.

The dated [finance and visual ecosystem scan](../research/jev-finance-landscape-2026-09-20.md)
records the discovery sources and implementation ideas used for this iteration.
It separates official documentation from community reports and does not promote
third-party speed, cost, accuracy, or trading claims into Fabric evidence.

## Vendor context, not product promises

TypeSafe’s official [models page](https://docs.typesafe.ai/models), accessed 2026-09-20, lists dynamic model and pricing/rate information. It is a provider scenario input, not a claim of cheaper, faster, or more accurate operation here. For integration shape, consult the dated official model/tool documentation of [OpenAI](https://platform.openai.com/docs/models), [Anthropic](https://docs.anthropic.com/en/docs/about-claude/models), [Google](https://ai.google.dev/gemini-api/docs/models), [Kimi](https://platform.moonshot.ai/docs/guide/use-kimi-k2), and [Qwen](https://www.alibabacloud.com/help/en/model-studio/models). No cross-model benchmark is committed.

Use [replay](../reference/cli.md) with a retained manifest for a reproducible offline integrity check. Add target-domain cases, versions, hardware/region when relevant, and limitations before publishing a comparison.

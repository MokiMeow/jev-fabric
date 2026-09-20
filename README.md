# Jev Fabric

Jev Fabric is a typed decision control plane for bounded semantic choices. It lets an application send a small, explicit question and candidate set to a decision provider, then applies deterministic policy before a host performs anything. The host model keeps open-ended reasoning; policy and the host keep authority.

It is useful when a workflow needs a repeatable selection, screen, rank, verification, risk signal, progress classification, or completion check. It is not an autonomous executor, permission system, browser controller, or replacement for domain validation.

> Alpha status: the repository is public source code, not a claim that every deployment is ready for every risk level. Start with offline examples and own evaluations.

## Five-minute offline quickstart

Choose either the checkout route or the clean packed-artifact route. Both are
copy/paste-tested offline paths; neither makes a provider request or needs a
credential.

```sh
npm install --offline --ignore-scripts
npx --no-install jev-fabric doctor --json
npx --no-install jev-fabric evaluate --json
```

See [Quickstart](docs/quickstart/offline.md) for both routes and [Examples](examples/README.md) for executable, offline decisions and boundary demonstrations.

Native TypeSafe live use is deliberately opt-in and local-stdio only. An operator
must directly supply `--live`, the pinned native provider/model, a credential
environment name, fixed tenant/action, call/token/dollar/deadline bounds, and a
conservative input-price ceiling. See [the live operator guide](docs/providers/typesafe-native.md). Never place a key in source, a config file, a receipt, generated host artifact, or client-side code.

Server applications can also use the pinned [Vercel AI Gateway route](docs/providers/vercel-ai-gateway.md) through the same strict TypeSafe response mapping. The current free promotion ends September 25, 2026; pricing is external, mutable state and is never embedded in Fabric policy. The Gateway factory accepts an explicit server-side credential and fixes the endpoint, provider ID, and `typesafe-ai/jev` model. It is not exposed as a browser or general CLI escape hatch.

## Choose a path

| Need | Start here | What happens |
| --- | --- | --- |
| Embed a bounded decision | [Code recipe](docs/recipes/local-coding.md) | Host supplies projected state and candidates; runtime returns an advisory receipt. |
| Use a terminal | [CLI reference](docs/reference/cli.md) | Offline doctor, evaluate, benchmark, replay, and bounded serve configuration. |
| Connect an agent | [MCP reference](docs/reference/mcp.md) | Five read-only advisory tools; no tool executes or authorizes. |
| Configure an agent host | [Adapters](docs/adapters/hosts.md) | Generated layouts for Codex, Claude Code, Gemini CLI, Qwen Code, and Kimi Code. |
| Assist an instrumented website | [WebMCP recipe](docs/recipes/webmcp-browser.md) | Bind origin, frame, tool, schema, policy epoch, and page state; the host still executes. |
| Route work in Blender, Unreal, Unity, Godot, or CAD | [Tool environments](docs/integrations/tool-environments.md) | Select only from adapter-declared native actions; revalidate and execute in the trusted plugin. |
| Triage finance or market evidence | [Finance and fintech](docs/integrations/finance.md) | Route synthetic or licensed, time-bound evidence to observe, investigate, or escalate; no trading. |

## Decision boundary

```text
host → deterministic preflight → projected state + candidates → cache → provider
     → response validation → deterministic policy → receipt/ticket → host executor
```

The provider can propose a bounded semantic result. It cannot mint identity, grant a permission, bypass a static denial, execute a command, or make a browser action. A receipt is redacted provenance, not authorization. [Architecture](ARCHITECTURE.md) explains each boundary.

## Pick the right component

| Component | Best for | Must not decide |
| --- | --- | --- |
| Deterministic code | exact rules, calculations, identifiers, limits, and authorization checks | ambiguous language meaning |
| Host reasoning model | open-ended planning, explanation, and synthesis | direct permission or unattended execution |
| Jev Fabric decision provider | typed, bounded semantic selection among declared choices | identity, policy, authority, or actions |

This is an integration-shape comparison, not a speed, cost, or quality ranking. Combine the components only across their stated trust boundaries.

## Built-in packs

| Pack | Decision boundary | Default failure behavior |
| --- | --- | --- |
| `route` | choose a declared destination or no match | abstain |
| `screen` | bounded accept/reject/abstain triage | abstain |
| `rank` | choose the best supplied candidate | abstain |
| `verify` | assess a bounded assertion against supplied evidence | abstain |
| `risk` | surface risk, authorization need, and untrusted influence | escalate |
| `progress` | classify bounded workflow state | abstain |
| `completion` | assess observed completion evidence | abstain |
| `finance-surveillance` | route bounded market evidence without execution | escalate |

Read [pack selection](docs/packs/selection.md) before using a pack. Candidate coverage, freshness, and policy are application responsibilities.

## Evidence snapshot

The only committed historical provider record is [historical-v0](benchmarks/historical/v0/manifest.json): evidence class `local_exploratory`, imported 2026-09-19, zero retained cases, redacted environment, and no held-out claim. Its old ECE calculation was invalid because it used TypeSafe confidence rather than maximum distribution probability; no corrected ECE is available. The [tool-environment](benchmarks/tool-environments/README.md) and [finance](benchmarks/finance/README.md) benchmark contracts are explicitly `NOT_RUN` and prevent null fixtures from becoming performance claims. See [Evidence](docs/evidence/README.md).

## When not to use Jev Fabric

Do not use it for direct financial decisions, identity or access grants, execution of model-selected commands, high-impact classifications without a suitable human and domain-control process, or tasks that deterministic code can answer exactly. A general reasoning model or a human may be a better next step when the task is open-ended rather than a bounded decision.

## Compatibility and project links

Host compatibility is explicitly scoped in [COMPATIBILITY.md](COMPATIBILITY.md); all host live results are `NOT RUN` unless an artifact says otherwise. This repository is not affiliated with or endorsed by TypeSafe AI. “TypeSafe” and “Jev” are used only to describe interoperable products; no logo or endorsement is implied.

Read [Security](docs/security/README.md), [release operations](docs/release.md), [Support](SUPPORT.md), [license](LICENSE), [roadmap](ROADMAP.md), and [AI source map](AGENTS.md).

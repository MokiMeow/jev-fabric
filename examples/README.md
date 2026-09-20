# Offline examples
Each example imports public packages, uses `ScriptedProvider`, validates a redacted receipt, and proves one fail-closed path without a network call. Run from a built checkout with `pnpm exec tsx examples/<name>/index.ts`.

| Example | Pack | Success | Negative path |
| --- | --- | --- | --- |
| [route-skills](route-skills/README.md) | route | selects a declared lane | empty set abstains |
| [gate-tool-action](gate-tool-action/README.md) | risk | supplies advisory risk signals | static deny remains deny |
| [rerank-evidence](rerank-evidence/README.md) | rank | selects a retrieved source | empty set abstains |
| [ci-triage](ci-triage/README.md) | screen | triages bounded output | empty set abstains |
| [support-triage](support-triage/README.md) | route | selects a queue | empty set abstains |
| [browser-action](browser-action/README.md) | route | advises a next step | no browser action occurs |
| [completion-check](completion-check/README.md) | completion | checks observed evidence | unobserved claim denies |
| [evaluate-pack](evaluate-pack/README.md) | progress | evaluates a pack | empty set abstains |
| [tool-environment-advice](tool-environment-advice/README.md) | route | chooses a declared environment action | empty set abstains |
| [finance-surveillance](finance-surveillance/README.md) | finance-surveillance | records an advisory observation | invalid execution boundary denies |
| [webmcp-action](webmcp-action/README.md) | boundary | binds trusted origin/tool/schema fingerprints | rejects cross-origin metadata |
| [provider-gateway-typesafe-fake](provider-gateway-typesafe-fake/README.md) | provider | composes the pinned Vercel Gateway Jev route | injected I/O keeps the example offline |

Decision examples output a redacted receipt and negative receipt. Boundary and provider-composition examples remain offline. They are integration-shape evidence, not live-provider, browser-performance, or model-quality results.

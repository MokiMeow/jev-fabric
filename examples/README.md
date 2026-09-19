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

Output includes a redacted receipt and negative receipt. It is demo data, not a live-provider result.

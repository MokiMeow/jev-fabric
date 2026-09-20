# Pack selection
Pick the narrowest pack that matches the question. Each pack is advisory and requires host-owned policy.

| Pack | Good fit | Do not use it for | Negative path |
| --- | --- | --- | --- |
| `route` | select declared destinations | inventing a destination | `no_match` abstains |
| `screen` | accept/reject/abstain triage | permission enforcement | missing evidence abstains |
| `rank` | choose among supplied evidence | absolute truth claims | empty set abstains |
| `verify` | bounded assertion against evidence | proof of broad correctness | insufficient evidence abstains |
| `risk` | signal risk and escalation needs | granting access | static deny remains deny |
| `progress` | classify task state | certify completion | uncertain state abstains |
| `completion` | assess observed checks | accept claimed-but-unobserved work | unobserved claim denies |
| `finance-surveillance` | route bounded, time-checked market evidence | trading, investment advice, credit, suitability, or execution | uncertainty and failure escalate |
| `fintech-exception` | detect explicit exception indicators in one redacted case note | payment approval, fraud determination, AML/KYC/sanctions disposition, identity, authority, or execution | malformed, urgent-harm, influence, and provider failures escalate |

Use one coherent question per stage. Batch independent questions only when they share the same bounded state; use a second stage only when new evidence or candidates are needed.

Generic built-in packs use question contract `0.2.0`. Every Choice criterion is
keyed by exactly one declared option, including `no_match` where applicable.
This is required by the native TypeSafe mapper and gives Jev literal,
contrastive meanings instead of an empty or unrelated criteria object. The
contract change invalidates provider caches or evaluations produced with the
generic `0.1.0` question shapes; do not compare their probabilities directly.

### Fixed-option proposal table

The four fixed-option packs turn a validated semantic label into a conservative proposal before host policy. `allow` remains advisory; static policy can still deny it. `deny`, `escalate`, and `abstain` never grant authority.

| Pack | Label → proposal |
| --- | --- |
| `screen` | `accept` → allow; `reject` → deny; `abstain` → abstain |
| `verify` | `supported` → allow; `unsupported` → deny |
| `progress` | `not_started` → abstain; `in_progress` → allow; `blocked` → escalate |
| `completion` | `complete` → allow; `incomplete` → deny |

The [TypeSafe patterns index](https://docs.typesafe.ai/patterns) and [choice primitive](https://docs.typesafe.ai/primitives/choice) are official background sources accessed 2026-09-19. They describe provider patterns, not a guarantee of results in this repository.

`finance-surveillance` is intentionally not an allow/deny pack. It returns only
`observe`, `investigate`, or `escalate`, and it requires the
[finance evidence boundary](../integrations/finance.md).

`fintech-exception` is also routing-only. It batches six independent Noul
questions over one host-redacted, hash-bound note and lets code compose the
answers into `observe`, `investigate`, or `escalate`. Read the
[fintech integration boundary](../integrations/fintech.md) before using it.

---
name: jev-fabric
description: Route bounded, advisory Jev Fabric decisions when deterministic checks leave a narrow semantic choice; do not use it to execute actions.
---

# Jev Fabric

Use Jev Fabric as a bounded decision service, not an autonomous operator. Start with deterministic checks: schemas, policy, ownership, permissions, tests, local search, and allowlists. Escalate a narrow residual choice only when semantic judgment will change the next safe step.

Choose one decision pack for one declared purpose: `route` for bounded classification, `screen` for eligibility, `rank` for ordered candidates, `verify` for evidence review, `risk` for bounded risk triage, `progress` for a next-state assessment, and `completion` for a stated done condition. Supply only equivalent work with the same state, options, deadline, provider, and policy in one batch. Do not mix tenants, permissions, providers, or action types.

Inspect `receipt.probabilitySemantics` rather than relabeling every value:
`native_calibrated` is provider-declared calibration semantics,
`normalized_logits` is a transformed distribution, `self_reported` is a model
report, `synthetic` is non-provider data, and `unknown` has no asserted source
semantics. None is individual correctness, permission, or authority. Require
local held-out calibration evidence before using any probability as an
operational correctness signal. Set an abstention path and threshold before
calling. Preserve input provenance, freshness, budget, deadline, cache scope,
and returned receipt. Escalate to the host model when the work needs open-ended
research, design, reconciliation, or explanation.

MCP tools are advisory and non-executing. A model judgment is evidence, never permission. Before any action, validate the action ticket, re-check host policy and authorization, and require the normal human or host approval boundary. Never turn a score, confidence, route, or receipt into a shell, browser, SaaS, financial, or security action automatically.

For pack-selection details, batching rules, and examples, read [references/pack-selection.md](references/pack-selection.md). For security-sensitive workflows and hard prohibitions, read [references/security-boundary.md](references/security-boundary.md).

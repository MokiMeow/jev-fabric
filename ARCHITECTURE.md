# Architecture
Jev Fabric separates semantic judgment from authority. A provider returns typed answers to a bounded question; deterministic code validates, policies, records, and—only in the host—may execute a separately authorized action.

## Data flow

| Stage | Input | Output | Authority |
| --- | --- | --- | --- |
| Host | user request and trusted context | a requested bounded workflow | host owns identity and action scope |
| Deterministic preflight | action and static rules | deny, abstain, or continue | static denial wins |
| Context and candidates | host-owned projection | bounded state and choices | host controls coverage and freshness |
| Cache | hashes only | prior validated response or miss | tenant-scoped, never raw state |
| Provider | state and questions | typed semantic answer | advisory only |
| Validation and policy | answer plus trusted policy | outcome and reason codes | policy cannot be weakened by model output |
| Receipt or ticket | redacted metadata | provenance; optionally a separate ticket | ticket verification is host-controlled |
| Host executor | policy result plus its own authorization | optional action | never the provider |

The architecture intentionally leaves a gap between “suggested” and “done.” Close it only with trusted application checks.

## Invariants

- A model answer never grants authority or weakens a static denial.
- State, credentials, bearer values, and ticket material are not persisted in ordinary receipts.
- External packs are declarative data; they cannot carry executable code.
- Provider endpoints and live budgets are administrator-controlled.
- Cancellation, deadlines, queues, retries, cache size, and receipt storage are bounded.

See [security boundaries](docs/security/boundaries.md) and [the protocol reference](docs/reference/api.md).

# Troubleshooting
| Symptom | Likely cause | Safe response |
| --- | --- | --- |
| `HTTP_TOKEN_REQUIRED` | token environment name/value absent | set a server-side token variable; do not place its value in config |
| `PUBLIC_BIND_UNSUPPORTED` | attempted public HTTP binding | use loopback with a trusted proxy/auth design outside this alpha |
| provider call not made | deterministic bypass, empty/stale candidates, or static policy | inspect redacted reason codes and candidate coverage |
| `PACK_NOT_FOUND` | wrong pack id | use the seven built-in identifiers exactly |
| receipt lookup missing | TTL/capacity expired | retain provenance in the application’s approved store, not raw state |
| result is uncertain | candidate/evidence ambiguity | abstain or escalate; do not lower policy threshold blindly |

If a command fails, collect redacted output, package versions, and the minimal bounded state shape. Never include a credential, ticket, bearer value, or private data in a report.

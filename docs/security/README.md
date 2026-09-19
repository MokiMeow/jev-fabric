# Security

Jev Fabric limits semantic decision inputs and outputs but does not make an application safe by itself. The application owns identity, permissions, data classification, action execution, deployment, and incident response.

## Threat model

| Threat | Boundary | Residual risk |
| --- | --- | --- |
| Prompt injection in state | state is data; fixed question/candidate schemas | semantic manipulation remains possible; validate outcomes |
| Unauthorized action | provider output is advisory; policy and host authorize | host integration can still be incorrect |
| Secret disclosure | receipts are redacted; config stores environment names | operators can still expose secrets outside the library |
| SSRF / provider egress | administrator-controlled endpoint policy | trusted endpoint can still be compromised |
| Ticket replay | signed, scoped, expiring one-use tickets | replay store availability is an operator concern |
| MCP misuse | five read-only advisory tools, bounded input/output | an external host may misuse advice |
| Provider outage | bounded retry/deadline and fail-closed pack behavior | availability depends on dependencies |

Read [security boundaries](boundaries.md), [MCP limits](../reference/mcp.md), and [support guidance](../../SUPPORT.md). Do not include a key or raw incident data in a public issue.

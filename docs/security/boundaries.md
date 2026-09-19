# Security boundaries
## Secrets and egress

Credentials belong in server-side environment variables. The CLI configuration accepts environment-variable names, not secret values. Provider base URLs, models, headers, and live budgets are administrator configuration, never request fields. Use an allowlisted HTTPS endpoint; do not let user state select a URL.

## Tickets, receipts, and replay

Receipts are redacted evidence and cannot authorize. If an application uses action tickets, it must verify audience, principal, tenant, action, expiry, policy epoch, signature, and one-use replay status immediately before an action. Do not expose ticket material in logs or user-visible output.

## Outages and uncertainty

Set bounded deadlines, queues, budgets, retries, and failure outcomes. For sensitive work, choose abstain/escalate/deny before integrating a provider. Do not turn fallback behavior into an implicit allow.

## Remaining risks

Typed schemas do not prove a semantic answer is true. Candidate omissions, stale evidence, bad policies, unsafe host executors, compromised dependencies, and bad operator configuration remain risks. Evaluate target workflows with representative data and independent review.

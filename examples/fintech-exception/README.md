# Fintech exception triage

Runs one fully offline, synthetic exception-triage case. The host redacts and
hash-binds a short operations note; Jev answers six independent yes-or-no
questions in one batch. Deterministic code converts those indicators into only
`observe`, `investigate`, or `escalate`.

This example cannot approve a payment, validate identity or authority, make an
AML/KYC/sanctions disposition, or execute a financial action. Its negative path
proves that an execution-capable boundary is denied before a provider call.

Run `pnpm exec tsx examples/fintech-exception/index.ts`.

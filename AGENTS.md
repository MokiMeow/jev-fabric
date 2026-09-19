# Jev Fabric agent guide
Read this file before changing a decision boundary.

## Commands

Use the pinned workspace package manager. Typical checks are `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm pack:test`, and `pnpm verify`. Documentation and examples add `pnpm docs:check` and `pnpm examples:check`. Default behavior is offline; do not introduce a network call into tests.

## Invariants

- Treat provider output as advisory typed data, never authorization or executable instruction.
- Keep trusted identity, policy, credential, ticket, and raw-state boundaries separate.
- Preserve candidate order and validate candidate coverage, freshness, limits, and response schemas.
- Do not call a live provider without explicit `--live`, an allowlisted provider, credentials, and all budgets.
- Keep receipts redacted and hash-based. Never log secret values.

## Source map

| Concern | Source of truth |
| --- | --- |
| Protocol schemas | `packages/protocol/src/` |
| Runtime, policy, receipts, tickets | `packages/core/src/` |
| Built-in packs and fixtures | `packs/` |
| Provider adapters | `packages/provider-*/src/` |
| Evaluation evidence | `packages/evals/`, `benchmarks/` |
| CLI and MCP bounds | `packages/cli/src/`, `packages/mcp/src/` |
| Host adapters and universal skill | `packages/adapters/`, `integrations/`, `skills/jev-fabric/` |
| Public operating guidance | `docs/`, `examples/` |

Extend by defining a bounded pack, adding normal and fail-closed fixtures, using a trusted host projection, and adding evidence before making a capability claim. See [pack selection](docs/packs/selection.md) and [security boundary](docs/security/boundaries.md).

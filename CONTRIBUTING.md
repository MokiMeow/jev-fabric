# Contributing to Jev Fabric

Thanks for improving Jev Fabric. This project treats provider output as advisory data,
not authority to act. Contributions must preserve bounded packs, trusted host identity,
redacted receipts, offline defaults, and explicit live-provider gates.

## Before opening a pull request

1. Read `AGENTS.md`, `ARCHITECTURE.md`, and the applicable package tests.
2. Keep a change narrow, add normal and fail-closed tests, and avoid secrets, personal
   data, machine paths, or network-dependent tests.
3. Run `pnpm verify`, `pnpm docs:check`, `pnpm examples:check`, `pnpm security:check`,
   `pnpm adapters:check`, and `pnpm conformance`.
4. Add a Changeset for every change under `packages/` or `packs/` that will be
   published. CI runs `pnpm changeset:check`; docs/test-only work is exempt. The
   narrowly constrained `changeset-release/<name>` branch convention is reserved for
   maintainer-reviewed version-preparation pull requests.

Use issues for reproducible bugs and scoped feature proposals. Maintainers may ask for a
smaller change, additional evidence, or a bounded-pack design before review. By
contributing, you agree to follow the Code of Conduct.

`tsdown` can emit TypeScript 7's upstream experimental-API notice while generating
declarations. It is recorded rather than suppressed; every verification command must
still exit successfully and all repository lint/security warnings are treated as defects.

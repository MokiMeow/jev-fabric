# Finance surveillance

Runs a fully offline, synthetic market-surveillance route. Exact calculations,
timestamp ordering, and freshness are checked in code. A structured chart
extractor supplies bounded annotations; no image is sent to Jev. The positive
path can only record an observation, while an invalid execution boundary is
denied before a provider call.

Run `pnpm exec tsx examples/finance-surveillance/index.ts`.

# Jev finance and visual landscape — 2026-09-20

This dated scan is discovery input, not security review, endorsement, or
performance evidence. Community claims remain unverified until reproduced with
retained artifacts.

## What is appearing

The community [Awesome Jev list](https://github.com/valentynkit/awesome-jev-typesafe)
now groups projects for finance, browser control, visual inference, agent
routing, semantic databases, guardrails, calibration, and evaluation. Finance
examples include:

- [jev-trader](https://github.com/jarrodwatts/jev-trader), a live/dry-run
  market-making demonstration with a decision on each block;
- [trade-jev](https://github.com/justinhe16/trade-jev), a backtest with retained
  answers, replayable policies, synthetic sample data, and separated licensed
  order-book data;
- [Jev-Trades](https://github.com/zadescoxp/Jev-Trades) and
  [jev-trade](https://github.com/aowang-ai/jev-trade), trading experiments that
  show interest in direct model-to-market loops.

The direct-execution pattern is intentionally not adopted here. It conflicts
with Fabric's authority boundary and exposes model error, stale state,
look-ahead, market-data licensing, position, margin, venue, and key-management
risk. The reusable ideas are the dry-run default, retained answers, replay,
explicit latency budget, synthetic fixtures, deterministic position limits,
and separated licensed data.

Visual projects such as [jev-visual](https://github.com/hr98w/jev-visual) and
[OpenJev](https://github.com/razorback16/openjev) explore local or
Jev-compatible visual decision models. They are not evidence that the official
Jev API accepts images. Fabric therefore uses a separate visual extractor and
passes only bounded, source-bound structured annotations to Jev.

## Current-source limitation

The public search pass included the official
[TypeSafe AI X profile](https://x.com/typesafeai), but unauthenticated search
did not expose a reliable same-day post set. No X claim is used as design or
performance evidence. The dated GitHub catalogue and live TypeSafe
documentation were the reproducible discovery sources for this iteration.

## Ideas incorporated

- One batched request with atomic, independent questions.
- Full distributions retained; confidence is not treated as correctness.
- Code-derived semantic buckets instead of raw numerical reasoning.
- Replayable, forward-time evaluation rather than P&L-only storytelling.
- Host-plus-Jev and solo baselines in the same benchmark matrix.
- An explicit visual-extractor boundary with axes and source binding.
- A permanent execution air gap: surveillance can only observe, investigate,
  or escalate.

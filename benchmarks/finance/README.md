# Finance benchmark contract

Evidence: `NOT RUN`. The committed fixture defines twelve comparison cells
across market surveillance, structured visual evidence, and financial-text
triage. It does not establish accuracy, latency, calibration, cost, or trading
performance.

Any completed run must retain licensed dataset metadata, use a forward-chaining
time split, report classification and selective-risk metrics, compute
calibration from the returned option probabilities rather than TypeSafe's
confidence field, bind model/question/policy/feature/hardware/region provenance,
retain one hashed trace per matrix cell and sample, and record an unsafe
execution-attempt rate of zero. Market
returns and P&L are intentionally not acceptance metrics for this advisory
control plane.

Run `node benchmarks/finance/scripts/validate.mjs` to validate the unrun
fixture. The validator rejects fabricated values in `NOT_RUN` evidence.

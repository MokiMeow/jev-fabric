# Hierarchical confidence

Runs the public evaluator entirely offline over synthetic, group-disjoint
finance-document observations. The first policy fits a leaf threshold on one
partition, passes an independent risk audit, and applies it only to the test
partition. The second requires more audited groups than the data supports, so
every test result falls back to its deterministic parent label.

Run `pnpm exec tsx examples/hierarchical-confidence/index.ts` from a built
checkout. The output includes reconstructible policy bindings, exact partition
hashes, a domain-separated policy hash, and a separate evaluation hash over the
test evidence and results. It is evaluator-contract evidence, not live Jev
accuracy, calibration, financial advice, or authority to act.

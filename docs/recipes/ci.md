# CI triage
Use `screen` or `verify` to classify a bounded artifact after deterministic checks collect it. A failed provider, stale evidence, or uncertain result should preserve the existing CI safety state and send the case to review; it must not mark a build passing. See [ci-triage](../../examples/ci-triage/README.md).

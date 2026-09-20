# Fintech exception-routing benchmark

Evidence: **`NOT_RUN`**. The committed artifact contains no accuracy, latency,
token, or cost measurements. Passing the tests proves the evaluator contract;
it does not prove Jev model quality.

This benchmark is the evidence gate for the critical
`fintech-exception@0.1.0` pack. It compares the same frozen cases across three
arms:

| Arm | Contract |
| --- | --- |
| `no_jev` | A pinned deterministic baseline with zero provider calls. |
| `jev_batched` | All six independent Noul questions in one provider call, plus any retained retries. |
| `jev_serial` | The same six questions and concrete Jev version sent separately, plus any retained retries. |

The comparison is intentionally narrow. It measures bounded exception routing,
not fraud detection, identity, KYC, AML, sanctions disposition, payment
approval, financial advice, or execution.

## What is measured

The primary metric is route accuracy on the held-out test split. Calibration
cases never contribute to that accuracy. The verifier independently recomputes:

- held-out route accuracy and invalid-response rate;
- urgent-consumer-harm and untrusted-influence false-negative rates;
- required-escalation recall;
- selective `observe` coverage and risk;
- per-question calibration-split Brier score, clipped NLL, and ten-bin Noul
  reliability;
- provider calls, input/output tokens, and exact nano-USD cost;
- end-to-end and provider p50/p95/p99 latency;
- batched/serial request, latency, cost, and held-out answer agreement; and
- the held-out accuracy delta against the deterministic no-Jev baseline.

`jevAddsMeasuredAccuracyValue` means only that the batched arm beat the pinned
baseline on the retained held-out sample. It is not causal evidence, a confidence
bound, or a general claim about Jev. A public comparison needs multiple runs,
uncertainty intervals, representative data, and independent review.

## Evidence invariants

The executable contract in `scripts/evidence.mts` rejects an artifact unless:

- the task was preregistered and the dataset frozen before the run;
- calibration and test groups are disjoint;
- every case has exactly one no-Jev, batched, and serial trace;
- the batched and serial arms use the same concrete Jev version, transport,
  pack, and question-set hash;
- every valid Jev trace contains exactly the six current Noul answers and each
  boolean agrees with `probabilityYes >= 0.5`;
- routes and route scores are reproducible from those answers;
- invalid Jev output fails closed to `escalate` without invented probabilities;
- cost is exactly reproducible from retained integer nano-USD pricing;
- gold labels, regulated data, raw notes, authority, and execution capability
  never appear in retained provider state;
- unsafe execution attempts remain zero; and
- every published aggregate exactly matches the retained case-level traces.

Hostile-artifact handling is bounded as well: the CLI accepts at most 64 MiB,
dataset and trace counts have explicit ceilings, token and nano-USD integers
have semantic and schema limits, metric comparison is iterative and bounded,
case/arm pairing is linear-time, and source URLs cannot embed credentials.

The artifact retains labels, digests, and redacted accounting only. Public
evidence requires redistribution rights and explicitly declares that it
contains no personal or regulated data. Raw financial cases remain outside the
repository and must pass a trusted DLP/redaction boundary before provider use.

The public envelope is defined twice on purpose:

- `schema/run.schema.jsonc` provides a strict Draft 2020-12 format for external
  producers; and
- `scripts/evidence.mts` enforces cross-record relationships, replays the
  baseline, and recomputes metrics that JSON Schema cannot prove.

Both validators must pass. Schema validity alone is not benchmark validity.

## Validate evidence

Validate the honest placeholder:

```sh
tsx benchmarks/fintech/scripts/validate.mts
```

Validate a completed retained artifact without modifying the repository:

```sh
tsx benchmarks/fintech/scripts/validate.mts --input ./retained/run.json
```

The command accepts one bounded, regular, non-symlink JSON file and prints a
Markdown report. It performs no network calls and never reads credentials. The
root `benchmark:check` and `verify` commands run its adversarial tests and
validate the committed `NOT_RUN` artifact.

## Running a real comparison

This directory currently provides the measurement contract and offline
verifier, not a credential-reading live runner. A runner must be supplied as a
reviewed, credentialless worker that:

1. freezes a rights-reviewed, group-disjoint dataset before execution;
2. keeps labels and dataset identity outside provider-visible state;
3. uses the exact `fintech-exception` projection and question contract;
4. records every attempt, retry, token, duration, concrete response model, and
   reviewed price—not merely successful calls;
5. runs all three arms on every case under the same host/network conditions;
6. emits the strict artifact shape accepted here; and
7. has no payment, account, order-entry, identity, or compliance-action tool.

Use a newly issued secret from an environment variable or managed secret store.
Never place a credential in the artifact, command line, repository, trace, or
provider-visible state.

## Why the no-Jev arm is mandatory

Current public evidence is task-dependent. TypeSafe documents Jev `1.13.0` as
text-only, currently priced at `$42/B` input tokens with output free, and shows
a parallel-question example that was materially faster and cheaper than serial
requests. Those are provider facts and one cookbook result, not a universal
benchmark. Independent public experiments report both strong efficiency and
cases where a no-Jev retrieval baseline matched the Jev frontier or another
model had higher task accuracy. This benchmark therefore refuses to attribute
value without a held-out no-Jev ablation.

Primary references:

- [TypeSafe model and pricing documentation](https://docs.typesafe.ai/models)
- [Noul primitive](https://docs.typesafe.ai/primitives/noul)
- [Parallel questions cookbook](https://docs.typesafe.ai/cookbooks/parallel_questions)
- [TypeSafe use-case map](https://docs.typesafe.ai/concepts/use-case-map)
- [Community structured-output benchmark](https://github.com/iammrduncan/typesafe-ai-benchmark)
- [Community phishing comparison](https://github.com/anisselbd/jev-phishing-bench)
- [Community routing ablation](https://github.com/TokenTrim/jev-routing-experiment)
- [JevBench](https://github.com/fstandhartinger/jevbench)

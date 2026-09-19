# Concepts

## A bounded semantic decision

A bounded decision has an explicit question, constrained options or criteria, projected state, and a defined failure outcome. For example: choose one support queue from two declared queues, or abstain. It is not “decide anything about this customer.”

| Keep in deterministic code | Ask a provider | Keep in trusted host policy |
| --- | --- | --- |
| identities, arithmetic, exact rules, candidate enumeration | relevance, semantic route, bounded verification, relative rank | permissions, risk threshold, escalation, execution |

## State and candidates

Project only data relevant to the question. Candidate lists must be complete enough for the desired choice, current enough for the workflow, and small enough for declared limits. The runtime preserves candidate order. Missing coverage should lead to a deterministic unavailable/abstain path, not an invented choice.

## Answers and uncertainty

Choice selects a declared option and returns a distribution. Score represents a defined ordered scale. Noul represents a yes/no condition. A provider confidence value is not a probability that the workflow is correct, and it is never authority. Calibrate thresholds against your own consequences and held-out data.

TypeSafe’s public concepts describe System One decisions and primitive semantics; consult [System One](https://docs.typesafe.ai/concepts/system-one) and [confidence guidance](https://docs.typesafe.ai/confidence) (official sources accessed 2026-09-19) before changing a native integration.

## Receipts, tickets, and outcomes

A receipt contains redacted hashes, provider/model metadata, outcome, reason codes, and accounting metadata. It does not contain raw state or a permission grant. An optional action ticket is a separate host-checked, short-lived artifact; it is not emitted as ordinary receipt data.

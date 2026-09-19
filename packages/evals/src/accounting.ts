import {
  summarizeAccounting,
  type AccountingTrace,
} from "@mokimeow/jev-fabric-core";
export interface ReceiptAttemptCost {
  /** Index in AccountingTrace.transportAttempts; stable for this trace. */
  readonly attemptIndex: number;
  readonly amountMicros?: string;
}
export interface EvaluationAccounting {
  readonly logicalRequestCount: number;
  readonly transportAttemptCount: number;
  readonly providerLatencyMs: number;
  readonly endToEndLatencyMs: number;
  readonly criticalPathWallTimeMs: number;
  readonly costMicros: string | null;
  readonly reason?: "unmetered_attempt";
}
export function summarizeEvaluationAccounting(
  trace: AccountingTrace,
  costs: readonly ReceiptAttemptCost[],
): EvaluationAccounting {
  const summary = summarizeAccounting(trace);
  const byAttempt = new Map<number, ReceiptAttemptCost>();
  for (const cost of costs) {
    if (
      !Number.isInteger(cost.attemptIndex) ||
      cost.attemptIndex < 0 ||
      byAttempt.has(cost.attemptIndex)
    )
      throw new TypeError("attemptIndex must be a unique non-negative integer");
    byAttempt.set(cost.attemptIndex, cost);
  }
  let total = 0n;
  for (const [attemptIndex] of trace.transportAttempts.entries()) {
    const cost = byAttempt.get(attemptIndex);
    if (!cost?.amountMicros)
      return { ...summary, costMicros: null, reason: "unmetered_attempt" };
    if (!/^(0|[1-9]\d*)$/.test(cost.amountMicros))
      throw new TypeError("amountMicros must be an integer decimal string");
    total += BigInt(cost.amountMicros);
  }
  return { ...summary, costMicros: total.toString() };
}

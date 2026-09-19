export interface LogicalRequestAccounting {
  readonly id: string;
  readonly startedAt: number;
  readonly endedAt: number;
}
export interface TransportAttemptAccounting {
  readonly logicalRequestId: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly providerStartedAt: number;
  readonly providerEndedAt: number;
  readonly outcome: "succeeded" | "failed" | "cancelled";
}
export interface AccountingSpan {
  readonly id: string;
  readonly parentId?: string;
  readonly startedAt: number;
  readonly endedAt: number;
}
export interface AccountingTrace {
  readonly logicalRequests: readonly LogicalRequestAccounting[];
  readonly transportAttempts: readonly TransportAttemptAccounting[];
  readonly spans: readonly AccountingSpan[];
}
export interface AccountingSummary {
  readonly logicalRequestCount: number;
  readonly transportAttemptCount: number;
  readonly providerLatencyMs: number;
  readonly endToEndLatencyMs: number;
  readonly criticalPathWallTimeMs: number;
}

/** Summarizes spans without double-counting overlapping child work as wall time. */
export function summarizeAccounting(trace: AccountingTrace): AccountingSummary {
  const duration = (start: number, end: number) => Math.max(0, end - start);
  const roots = trace.spans.filter((span) => span.parentId === undefined);
  const criticalPathWallTimeMs =
    roots.length === 0
      ? 0
      : Math.max(
          ...roots.map((span) => duration(span.startedAt, span.endedAt)),
        );
  return {
    logicalRequestCount: trace.logicalRequests.length,
    transportAttemptCount: trace.transportAttempts.length,
    providerLatencyMs: trace.transportAttempts.reduce(
      (sum, attempt) =>
        sum + duration(attempt.providerStartedAt, attempt.providerEndedAt),
      0,
    ),
    endToEndLatencyMs: trace.logicalRequests.reduce(
      (sum, request) => sum + duration(request.startedAt, request.endedAt),
      0,
    ),
    criticalPathWallTimeMs,
  };
}

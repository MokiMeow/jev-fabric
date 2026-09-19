import { expect, it } from "vitest";
import { summarizeEvaluationAccounting } from "../src/index.js";
it("keeps unknown failed-attempt cost explicit", () => {
  const result = summarizeEvaluationAccounting(
    {
      logicalRequests: [{ id: "r", startedAt: 0, endedAt: 10 }],
      transportAttempts: [
        {
          logicalRequestId: "r",
          startedAt: 0,
          endedAt: 10,
          providerStartedAt: 1,
          providerEndedAt: 9,
          outcome: "failed",
        },
      ],
      spans: [],
    },
    [{ attemptIndex: 0 }],
  );
  expect(result.costMicros).toBeNull();
  expect(result.reason).toBe("unmetered_attempt");
  expect(result.logicalRequestCount).toBe(1);
  expect(result.transportAttemptCount).toBe(1);
});
it("joins failed and retried attempt cost by stable attempt index", () => {
  const trace = {
    logicalRequests: [{ id: "r", startedAt: 0, endedAt: 10 }],
    transportAttempts: [
      {
        logicalRequestId: "r",
        startedAt: 0,
        endedAt: 5,
        providerStartedAt: 0,
        providerEndedAt: 5,
        outcome: "failed" as const,
      },
      {
        logicalRequestId: "r",
        startedAt: 5,
        endedAt: 10,
        providerStartedAt: 5,
        providerEndedAt: 10,
        outcome: "succeeded" as const,
      },
    ],
    spans: [],
  };
  expect(
    summarizeEvaluationAccounting(trace, [
      { attemptIndex: 0, amountMicros: "5" },
      { attemptIndex: 1, amountMicros: "10" },
    ]).costMicros,
  ).toBe("15");
});

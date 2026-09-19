import { describe, expect, it } from "vitest";
import { summarizeAccounting } from "../src/index.js";

describe("attempt accounting", () => {
  it("keeps logical requests, transport attempts, and overlapping wall time distinct", () => {
    const summary = summarizeAccounting({
      logicalRequests: [{ id: "request", startedAt: 0, endedAt: 100 }],
      transportAttempts: [
        {
          logicalRequestId: "request",
          startedAt: 10,
          endedAt: 70,
          providerStartedAt: 20,
          providerEndedAt: 60,
          outcome: "failed",
        },
        {
          logicalRequestId: "request",
          startedAt: 30,
          endedAt: 90,
          providerStartedAt: 35,
          providerEndedAt: 80,
          outcome: "succeeded",
        },
      ],
      spans: [
        { id: "root", startedAt: 0, endedAt: 100 },
        { id: "left", parentId: "root", startedAt: 10, endedAt: 70 },
        { id: "right", parentId: "root", startedAt: 30, endedAt: 90 },
      ],
    });
    expect(summary.logicalRequestCount).toBe(1);
    expect(summary.transportAttemptCount).toBe(2);
    expect(summary.providerLatencyMs).toBe(85);
    expect(summary.endToEndLatencyMs).toBe(100);
    expect(summary.criticalPathWallTimeMs).toBe(100);
  });

  it("sums logical request wall time without counting retries as requests", () => {
    const summary = summarizeAccounting({
      logicalRequests: [
        { id: "one", startedAt: 0, endedAt: 100 },
        { id: "two", startedAt: 10, endedAt: 50 },
      ],
      transportAttempts: [
        {
          logicalRequestId: "one",
          startedAt: 0,
          endedAt: 60,
          providerStartedAt: 0,
          providerEndedAt: 50,
          outcome: "failed",
        },
        {
          logicalRequestId: "one",
          startedAt: 60,
          endedAt: 100,
          providerStartedAt: 65,
          providerEndedAt: 95,
          outcome: "succeeded",
        },
      ],
      spans: [],
    });
    expect(summary.endToEndLatencyMs).toBe(140);
    expect(summary.providerLatencyMs).toBe(80);
  });
});

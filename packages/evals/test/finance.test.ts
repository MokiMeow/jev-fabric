import { describe, expect, it } from "vitest";
import {
  aggregateFinanceBenchmarkTraces,
  financeArchitectures,
  financeTracks,
  type FinanceBenchmarkTrace,
  type FinanceMeasuredPredictedTrace,
  type FinancePredictedTrace,
  type FinanceRejectedLookaheadTrace,
  type FinanceUncalibratedPredictedTrace,
} from "../src/index.js";

type PredictedOverrides =
  | Partial<FinanceMeasuredPredictedTrace>
  | Partial<FinanceUncalibratedPredictedTrace>;

function predictedTrace(
  overrides: PredictedOverrides = {},
): FinancePredictedTrace {
  return {
    caseId: "case-regular",
    groupId: "group-1",
    track: "market_surveillance",
    architecture: "jev_advisory",
    goldRoute: "observe",
    status: "predicted",
    predictedRoute: "observe",
    routeQuestionProbabilities: {
      observe: 0.8,
      investigate: 0.1,
      escalate: 0.1,
    },
    calibrationStatus: "measured",
    abstained: false,
    lookaheadProbe: false,
    lookaheadRejected: false,
    unsafeExecutionAttempt: false,
    durationMs: 10,
    inputTokens: 100,
    costMicros: "10000",
    ...overrides,
  } as FinancePredictedTrace;
}

function rejectedTrace(
  overrides: Partial<FinanceRejectedLookaheadTrace> = {},
): FinanceRejectedLookaheadTrace {
  return {
    caseId: "case-probe-rejected",
    groupId: "group-probe",
    track: "market_surveillance",
    architecture: "jev_advisory",
    goldRoute: "escalate",
    status: "rejected_lookahead",
    lookaheadProbe: true,
    lookaheadRejected: true,
    unsafeExecutionAttempt: false,
    durationMs: 5,
    inputTokens: 0,
    costMicros: "0",
    ...overrides,
  };
}

function regularFor(
  track: FinanceBenchmarkTrace["track"],
  architecture: FinanceBenchmarkTrace["architecture"],
): FinancePredictedTrace {
  if (architecture === "deterministic_only")
    return predictedTrace({
      track,
      architecture,
      routeQuestionProbabilities: null,
      calibrationStatus: "unavailable",
      calibrationReason: "deterministic_only",
      inputTokens: 0,
      costMicros: "0",
    });
  if (architecture === "host_plus_jev")
    return predictedTrace({
      track,
      architecture,
      routeQuestionProbabilities: null,
      calibrationStatus: "unavailable",
      calibrationReason: "composite_no_distribution",
    });
  return predictedTrace({ track, architecture });
}

function completeMatrix<T extends FinanceBenchmarkTrace>(
  targetRows: readonly T[] = [],
): FinanceBenchmarkTrace[] {
  return financeTracks.flatMap((track) =>
    financeArchitectures.flatMap<FinanceBenchmarkTrace>((architecture) => {
      if (
        track === "market_surveillance" &&
        architecture === "jev_advisory" &&
        targetRows.length > 0
      )
        return [...targetRows];
      return [
        regularFor(track, architecture),
        rejectedTrace({ track, architecture }),
      ];
    }),
  );
}

function targetCell(rows: readonly FinanceBenchmarkTrace[]) {
  return aggregateFinanceBenchmarkTraces(rows).find(
    (row) =>
      row.track === "market_surveillance" &&
      row.architecture === "jev_advisory",
  );
}

describe("aggregateFinanceBenchmarkTraces", () => {
  it("separates regular route metrics from lookahead-probe accounting", () => {
    const rows = completeMatrix([
      predictedTrace({ caseId: "a", groupId: "session-a" }),
      predictedTrace({
        caseId: "b",
        groupId: "session-b",
        goldRoute: "investigate",
        predictedRoute: "escalate",
        routeQuestionProbabilities: {
          observe: 0.1,
          investigate: 0.2,
          escalate: 0.7,
        },
        durationMs: 20,
        inputTokens: 200,
        costMicros: "20000",
      }),
      predictedTrace({
        caseId: "c",
        groupId: "session-c",
        goldRoute: "escalate",
        predictedRoute: "investigate",
        routeQuestionProbabilities: {
          observe: 0.2,
          investigate: 0.6,
          escalate: 0.2,
        },
        abstained: true,
        durationMs: 30,
        inputTokens: 300,
        costMicros: "30000",
      }),
      rejectedTrace({ caseId: "d", durationMs: 40 }),
    ]);

    const result = aggregateFinanceBenchmarkTraces(rows);
    expect(result).toHaveLength(12);
    const cell = targetCell(rows);
    expect(cell).toMatchObject({
      sampleCount: 4,
      calibrationStatus: "measured",
      calibrationReason: null,
      accountingStatus: "MEASURED",
      accountingReason: null,
    });
    expect(cell?.metrics.accuracy).toBeCloseTo(0.5);
    expect(cell?.metrics.macroF1).toBeCloseTo(1 / 3);
    expect(cell?.metrics.routeQuestionBrier).toBeCloseTo(
      (0.06 + 1.14 + 1.04) / 3,
    );
    expect(cell?.metrics.routeQuestionEce).toBeCloseTo(0.5);
    expect(cell?.metrics.coverage).toBeCloseTo(2 / 3);
    expect(cell?.metrics.unsafeExecutionAttemptRate).toBe(0);
    expect(cell?.metrics.lookaheadRejectionRate).toBe(1);
    expect(cell?.metrics.p50Ms).toBe(30);
    expect(cell?.metrics.p95Ms).toBe(40);
    expect(cell?.metrics.inputTokens).toBe(600);
    expect(cell?.metrics.estimatedCostUsd).toBeCloseTo(0.06);
  });

  it("allows a composed route to differ from the route-question argmax", () => {
    const cell = targetCell(
      completeMatrix([
        predictedTrace({
          predictedRoute: "escalate",
          goldRoute: "escalate",
          routeQuestionProbabilities: {
            observe: 0.9,
            investigate: 0.05,
            escalate: 0.05,
          },
        }),
        rejectedTrace(),
      ]),
    );
    expect(cell?.metrics.accuracy).toBe(1);
    expect(cell?.metrics.routeQuestionBrier).toBeCloseTo(1.715);
  });

  it("reports unavailable calibration without fabricating zero metrics", () => {
    const cell = aggregateFinanceBenchmarkTraces(completeMatrix()).find(
      (row) =>
        row.track === "market_surveillance" &&
        row.architecture === "host_plus_jev",
    );
    expect(cell).toMatchObject({
      calibrationStatus: "unavailable",
      calibrationReason: "no_measured_route_question_distributions",
      metrics: {
        routeQuestionBrier: null,
        routeQuestionEce: null,
      },
    });
  });

  it("returns null selective accuracy when every regular case abstains", () => {
    const cell = targetCell(
      completeMatrix([
        predictedTrace({ abstained: true, predictedRoute: "escalate" }),
        rejectedTrace(),
      ]),
    );
    expect(cell?.metrics).toMatchObject({
      accuracy: null,
      coverage: 0,
      macroF1: 0,
    });
  });

  it("propagates unknown accounting for the entire cell", () => {
    const cell = targetCell(
      completeMatrix([
        predictedTrace({ inputTokens: null, costMicros: null }),
        rejectedTrace(),
      ]),
    );
    expect(cell).toMatchObject({
      accountingStatus: "UNMETERED",
      accountingReason: "unmetered_attempt",
      metrics: { inputTokens: null, estimatedCostUsd: null },
    });
  });

  it("rejects duplicate case ids within a cell and a partial matrix", () => {
    expect(() =>
      aggregateFinanceBenchmarkTraces(
        completeMatrix([predictedTrace(), predictedTrace(), rejectedTrace()]),
      ),
    ).toThrow(/duplicate finance case id/);
    expect(() =>
      aggregateFinanceBenchmarkTraces([predictedTrace(), rejectedTrace()]),
    ).toThrow(/missing finance benchmark cell/);
  });

  it.each([
    ["durationMs", Number.NaN],
    ["durationMs", -1],
    ["inputTokens", Number.POSITIVE_INFINITY],
    ["inputTokens", -1],
  ] as const)("rejects invalid %s values", (field, value) => {
    expect(() =>
      aggregateFinanceBenchmarkTraces(
        completeMatrix([predictedTrace({ [field]: value }), rejectedTrace()]),
      ),
    ).toThrow(/finite and non-negative|non-negative safe integer/);
  });

  it("rejects malformed costs, probability keys, and probability sums", () => {
    expect(() =>
      aggregateFinanceBenchmarkTraces(
        completeMatrix([
          predictedTrace({ costMicros: "1.5" }),
          rejectedTrace(),
        ]),
      ),
    ).toThrow(/non-negative integer string/);
    expect(() =>
      aggregateFinanceBenchmarkTraces(
        completeMatrix([
          predictedTrace({
            routeQuestionProbabilities: {
              observe: 0.8,
              investigate: 0.1,
              escalate: 0.05,
              extra: 0.05,
            } as FinanceMeasuredPredictedTrace["routeQuestionProbabilities"],
          }),
          rejectedTrace(),
        ]),
      ),
    ).toThrow(/exactly its documented fields/);
    expect(() =>
      aggregateFinanceBenchmarkTraces(
        completeMatrix([
          predictedTrace({
            routeQuestionProbabilities: {
              observe: 0.8,
              investigate: 0.1,
              escalate: 0.05,
            },
          }),
          rejectedTrace(),
        ]),
      ),
    ).toThrow(/sum to 1/);
    expect(() =>
      aggregateFinanceBenchmarkTraces(
        completeMatrix([
          predictedTrace({
            routeQuestionProbabilities: {
              observe: Number.NaN,
              investigate: 0.5,
              escalate: 0.5,
            },
          }),
          rejectedTrace(),
        ]),
      ),
    ).toThrow(/finite in \[0, 1\]/);
  });

  it("requires regular and lookahead cases in every cell", () => {
    expect(() =>
      aggregateFinanceBenchmarkTraces(completeMatrix([predictedTrace()])),
    ).toThrow(/no lookahead probes/);
    expect(() =>
      aggregateFinanceBenchmarkTraces(completeMatrix([rejectedTrace()])),
    ).toThrow(/no regular predicted cases/);
  });

  it("rejects unsafe attempts and fabricated lookahead predictions", () => {
    expect(() =>
      aggregateFinanceBenchmarkTraces(
        completeMatrix([
          predictedTrace({ unsafeExecutionAttempt: true }),
          rejectedTrace(),
        ]),
      ),
    ).toThrow(/attempted unsafe execution/);
    expect(() =>
      aggregateFinanceBenchmarkTraces(
        completeMatrix([
          predictedTrace(),
          predictedTrace({
            caseId: "predicted-probe",
            lookaheadProbe: true,
          }),
          rejectedTrace(),
        ]),
      ),
    ).toThrow(/cannot represent a lookahead probe/);
    expect(() =>
      aggregateFinanceBenchmarkTraces(
        completeMatrix([
          predictedTrace(),
          {
            ...rejectedTrace(),
            predictedRoute: "escalate",
            routeQuestionProbabilities: {
              observe: 0,
              investigate: 0,
              escalate: 1,
            },
            abstained: false,
          } as unknown as FinanceBenchmarkTrace,
        ]),
      ),
    ).toThrow(/cannot contain prediction fields/);
  });

  it("enforces the trace-status discriminants", () => {
    expect(() =>
      aggregateFinanceBenchmarkTraces(
        completeMatrix([
          {
            ...predictedTrace(),
            lookaheadRejected: true,
          } as unknown as FinanceBenchmarkTrace,
          rejectedTrace(),
        ]),
      ),
    ).toThrow(/cannot reject lookahead/);
    expect(() =>
      aggregateFinanceBenchmarkTraces(
        completeMatrix([
          predictedTrace(),
          {
            ...rejectedTrace(),
            lookaheadProbe: false,
          } as unknown as FinanceBenchmarkTrace,
        ]),
      ),
    ).toThrow(/requires a rejected lookahead probe/);
  });

  it("accepts provenance fields but rejects accessor-backed metric fields", () => {
    expect(() =>
      aggregateFinanceBenchmarkTraces(
        completeMatrix([
          { ...predictedTrace(), traceId: "trace-1" },
          rejectedTrace(),
        ]),
      ),
    ).not.toThrow();

    const accessorTrace = predictedTrace();
    Object.defineProperty(accessorTrace, "caseId", {
      enumerable: true,
      get: () => "case-regular",
    });
    expect(() =>
      aggregateFinanceBenchmarkTraces(
        completeMatrix([accessorTrace, rejectedTrace()]),
      ),
    ).toThrow(/fields must be data properties/);
  });
});

import { describe, expect, it } from "vitest";
import { evaluateCases, renderReport } from "../src/index.js";
it("reports deterministic cluster intervals and escaped metadata", () => {
  const rows = [
    { id: "a", groupId: "one", goldLabel: "yes", outcome: "correct" as const },
    { id: "b", groupId: "two", goldLabel: "no", outcome: "abstained" as const },
  ];
  const result = evaluateCases(rows, { seed: 7, replicates: 10 });
  expect(result.intervals.accuracy.method).toBe("cluster_percentile");
  expect(result.prevalence).toEqual({ no: 0.5, yes: 0.5 });
  const report = renderReport({
    title: "# bad",
    evidence: "unit",
    metrics: { "a|b": null },
    runId: "r",
    environmentId: "e",
    versions: { model: "v1" },
    denominators: { cases: 2 },
    independentGroups: result.independentGroups,
    prevalence: result.prevalence,
    invalidResponses: result.invalidResponses,
    abstentions: result.abstentions,
    intervals: result.intervals,
    limitations: ["<unsafe>"],
  });
  expect(report).toContain("\\# bad");
  expect(report).toContain("## Versions");
  expect(report).toContain("NA / NOT RUN");
});
describe("evaluateCases bootstrap boundaries", () => {
  it("is reproducible for one group and reports empty denominators", () => {
    const one = [{ id: "x", groupId: "same", outcome: "correct" as const }];
    expect(evaluateCases(one, { seed: 9, replicates: 4 })).toEqual(
      evaluateCases(one, { seed: 9, replicates: 4 }),
    );
    const empty = evaluateCases([], { seed: 9, replicates: 4 });
    expect(empty.intervals.accuracy.reason).toBe("zero_coverage");
    expect(empty.accuracy.value).toBeNull();
    expect(() => evaluateCases(one, { seed: 0, replicates: 4 })).toThrow(
      /seed/,
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  assertGroupedSplit,
  clusterBootstrap,
  fitThreshold,
  type ThresholdCase,
} from "../src/index.js";

describe("calibration-only selection", () => {
  it("does not fit from test data and rejects cross-split groups", () => {
    const group = { family: "f", session: "s", repository: "r", source: "src" };
    const rows: readonly ThresholdCase[] = [
      {
        id: "c",
        group,
        split: "calibration",
        score: 0.8,
        correct: true,
      },
      {
        id: "t",
        group: { ...group, session: "other" },
        split: "test",
        score: 0.99,
        correct: false,
      },
    ];
    expect(fitThreshold(rows, 0).threshold).toBe(0.8);
    const calibration: ThresholdCase = {
      id: "c",
      group,
      split: "calibration",
      score: 0.8,
      correct: true,
    };
    expect(() =>
      assertGroupedSplit([
        { ...calibration, id: "d", split: "development" },
        calibration,
      ]),
    ).toThrow(/group crosses/);
  });
  it("cluster-resamples groups deterministically", () => {
    const rows = [
      { group: "a", value: 0 },
      { group: "a", value: 0 },
      { group: "b", value: 1 },
    ];
    const metric = (sample: readonly (typeof rows)[number][]) =>
      sample.reduce((total, row) => total + row.value, 0) / sample.length;
    expect(
      clusterBootstrap(rows, (row) => row.group, metric, {
        seed: 7,
        replicates: 20,
      }),
    ).toEqual(
      clusterBootstrap(rows, (row) => row.group, metric, {
        seed: 7,
        replicates: 20,
      }),
    );
  });
});

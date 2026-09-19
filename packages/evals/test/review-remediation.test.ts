import { describe, expect, it } from "vitest";
import {
  assertArtifactManifest,
  clusterBootstrap,
  fitThreshold,
  quantile,
  type ThresholdCase,
} from "../src/index.js";

describe("review remediation", () => {
  it("returns the minimum at quantile zero", () => {
    expect(quantile([1, 2, 3], 0)).toBe(1);
  });

  it("rejects a zero bootstrap seed", () => {
    expect(() =>
      clusterBootstrap(
        [{ group: "a", value: 1 }],
        (row) => row.group,
        () => 1,
        {
          seed: 0,
          replicates: 2,
        },
      ),
    ).toThrow(/seed/);
  });

  it("rejects group leakage before threshold fitting", () => {
    const rows: readonly ThresholdCase[] = [
      {
        id: "calibration",
        group: { family: "f", session: "s", repository: "r", source: "x" },
        split: "calibration",
        score: 0.9,
        correct: true,
      },
      {
        id: "test",
        group: { family: "f", session: "s", repository: "r", source: "x" },
        split: "test",
        score: 0.1,
        correct: false,
      },
    ];
    expect(() => fitThreshold(rows, 0)).toThrow(/crosses/);
  });

  it("rejects a manifest without complete artifact descriptors", () => {
    expect(() => assertArtifactManifest({ schemaVersion: "1" })).toThrow();
  });
});

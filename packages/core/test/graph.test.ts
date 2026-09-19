import { describe, expect, it } from "vitest";
import { DecisionGraph, DecisionPlanner, GraphError } from "../src/index.js";

const node = (
  id: string,
  dependencies: readonly string[] = [],
  overrides = {},
) => ({
  id,
  dependencies,
  providerId: "provider",
  model: "model",
  state: { goal: "x" },
  options: ["a", "b"],
  ...overrides,
});

describe("decision graph planning", () => {
  it("rejects cycles and missing dependencies", () => {
    expect(
      () => new DecisionGraph([node("a", ["b"]), node("b", ["a"])]),
    ).toThrow(GraphError);
    expect(() => new DecisionGraph([node("a", ["missing"])])).toThrow(
      GraphError,
    );
  });

  it("batches only independent nodes with exactly equivalent provider, state, and options", () => {
    const graph = new DecisionGraph([
      node("a"),
      node("b"),
      node("c", [], { options: ["b", "a"] }),
      node("d", ["a"]),
    ]);
    const plan = new DecisionPlanner().plan(graph);
    expect(
      plan.stages.map((stage) => stage.batches.map((batch) => batch.nodeIds)),
    ).toEqual([[["a", "b"], ["c"]], [["d"]]]);
  });

  it("is unaffected when callers mutate their nodes after construction", () => {
    const input = [node("a"), node("b", ["a"])];
    const graph = new DecisionGraph(input);
    const first = input.at(0);
    const second = input.at(1);
    if (!first || !second) throw new Error("expected graph input");
    (second.dependencies as string[]).push("b");
    (first.state as { goal: string }).goal = "changed";
    expect(
      new DecisionPlanner()
        .plan(graph)
        .stages.map((stage) => stage.batches.map((batch) => batch.nodeIds)),
    ).toEqual([[["a"]], [["b"]]]);
  });
});

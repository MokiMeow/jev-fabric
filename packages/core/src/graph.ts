import type { JsonValue } from "@mokimeow/jev-fabric-protocol";
import { canonicalize } from "./canonical.js";
import { GraphError } from "./errors.js";

export interface DecisionGraphNode {
  readonly id: string;
  readonly dependencies: readonly string[];
  readonly providerId: string;
  readonly model: string;
  readonly state: JsonValue;
  /** Provider-relevant options; their ordered JSON representation is significant. */
  readonly options: JsonValue;
}

export interface DecisionPlanBatch {
  readonly nodeIds: readonly string[];
  readonly providerId: string;
  readonly model: string;
  readonly state: JsonValue;
  readonly options: JsonValue;
}
export interface DecisionPlanStage {
  readonly batches: readonly DecisionPlanBatch[];
}
export interface DecisionPlan {
  readonly stages: readonly DecisionPlanStage[];
}

/** Validated immutable DAG of decision work. */
export class DecisionGraph {
  readonly nodes: readonly DecisionGraphNode[];
  readonly #byId: ReadonlyMap<string, DecisionGraphNode>;
  constructor(nodes: readonly DecisionGraphNode[]) {
    const byId = new Map<string, DecisionGraphNode>();
    for (const node of nodes) {
      if (!node.id || byId.has(node.id))
        throw new GraphError("node ids must be unique and non-empty");
      if (new Set(node.dependencies).size !== node.dependencies.length)
        throw new GraphError("node dependencies must be unique");
      const snapshot = freezeNode(node);
      byId.set(snapshot.id, snapshot);
    }
    for (const node of byId.values())
      for (const dependency of node.dependencies)
        if (!byId.has(dependency))
          throw new GraphError("node dependency is missing");
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visiting.has(id))
        throw new GraphError("decision graph contains a cycle");
      if (visited.has(id)) return;
      visiting.add(id);
      const current = byId.get(id);
      if (!current) throw new GraphError("node dependency is missing");
      for (const dependency of current.dependencies) visit(dependency);
      visiting.delete(id);
      visited.add(id);
    };
    for (const node of byId.values()) visit(node.id);
    this.nodes = Object.freeze([...byId.values()]);
    this.#byId = byId;
  }
  get(id: string): DecisionGraphNode | undefined {
    return this.#byId.get(id);
  }
}

function freezeNode(node: DecisionGraphNode): DecisionGraphNode {
  if (
    !node.providerId ||
    !node.model ||
    !Array.isArray(node.dependencies) ||
    node.dependencies.some((dependency) => !dependency)
  )
    throw new GraphError("decision graph node is invalid");
  return Object.freeze({
    id: node.id,
    dependencies: Object.freeze([...node.dependencies]),
    providerId: node.providerId,
    model: node.model,
    state: immutableJson(node.state),
    options: immutableJson(node.options),
  });
}

function immutableJson<T extends JsonValue>(value: T): T {
  const snapshot = JSON.parse(canonicalize(value)) as T;
  return freezeJson(snapshot);
}

function freezeJson<T extends JsonValue>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}

/** Turns a graph into dependency stages and safe request batches. */
export class DecisionPlanner {
  plan(graph: DecisionGraph): DecisionPlan {
    const stages = new Map<number, DecisionGraphNode[]>();
    const depth = new Map<string, number>();
    const determineDepth = (node: DecisionGraphNode): number => {
      const known = depth.get(node.id);
      if (known !== undefined) return known;
      const dependencies = node.dependencies.map((id) => {
        const dependency = graph.get(id);
        if (!dependency) throw new GraphError("node dependency is missing");
        return determineDepth(dependency);
      });
      const result =
        dependencies.length === 0 ? 0 : Math.max(...dependencies) + 1;
      depth.set(node.id, result);
      return result;
    };
    for (const node of graph.nodes) {
      const level = determineDepth(node);
      const existing = stages.get(level) ?? [];
      existing.push(node);
      stages.set(level, existing);
    }
    return {
      stages: [...stages.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, nodes]) => ({ batches: group(nodes) })),
    };
  }
}

function group(nodes: readonly DecisionGraphNode[]): DecisionPlanBatch[] {
  const grouped = new Map<string, DecisionPlanBatch>();
  for (const node of nodes) {
    const identity = canonicalize({
      providerId: node.providerId,
      model: node.model,
      state: node.state,
      options: node.options,
    });
    const current = grouped.get(identity);
    if (current)
      grouped.set(identity, {
        ...current,
        nodeIds: [...current.nodeIds, node.id],
      });
    else
      grouped.set(identity, {
        nodeIds: [node.id],
        providerId: node.providerId,
        model: node.model,
        state: node.state,
        options: node.options,
      });
  }
  return [...grouped.values()];
}

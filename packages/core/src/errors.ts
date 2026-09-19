/** A public error base which never includes decision state or secrets. */
export class DecisionRuntimeError extends Error {
  override name = "DecisionRuntimeError";
}

export class CanonicalizationError extends DecisionRuntimeError {
  override name = "CanonicalizationError";
}

export class CacheError extends DecisionRuntimeError {
  override name = "CacheError";
}

export class GraphError extends DecisionRuntimeError {
  override name = "GraphError";
}

export class BudgetError extends DecisionRuntimeError {
  override name = "BudgetError";
}

export class QueueFullError extends DecisionRuntimeError {
  override name = "QueueFullError";
}

export class CircuitOpenError extends DecisionRuntimeError {
  override name = "CircuitOpenError";
}

export class DeadlineExceededError extends DecisionRuntimeError {
  override name = "DeadlineExceededError";
}

/** The trusted caller cancelled the decision before a semantic result existed. */
export class DecisionAbortedError extends DecisionRuntimeError {
  override name = "DecisionAbortedError";
}

export class RetryExhaustedError extends DecisionRuntimeError {
  override name = "RetryExhaustedError";
  constructor(readonly cause: unknown) {
    super("Decision transport retries were exhausted");
  }
}

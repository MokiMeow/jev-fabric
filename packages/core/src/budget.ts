import { BudgetError } from "./errors.js";

export interface BudgetAmount {
  readonly requests?: number;
  readonly tokens?: number;
}
export interface BudgetSnapshot {
  readonly reserved: Required<BudgetAmount>;
  readonly settled: Required<BudgetAmount>;
  readonly remaining: Required<BudgetAmount>;
}

/** A one-shot reservation. A started transport attempt must settle it; queued work releases it. */
export interface BudgetReservation {
  settle(): void;
  release(): void;
}

/** Tracks finite request/token capacity without global process state. */
export class BudgetLedger {
  readonly #limits: Required<BudgetAmount>;
  #reserved: Required<BudgetAmount> = { requests: 0, tokens: 0 };
  #settled: Required<BudgetAmount> = { requests: 0, tokens: 0 };

  constructor(limits: BudgetAmount) {
    this.#limits = normalize(limits, "budget limit");
  }

  /** Explicit trusted-host opt-in for workloads that intentionally have no practical cap. */
  static unlimited(): BudgetLedger {
    return new BudgetLedger({
      requests: Number.MAX_SAFE_INTEGER,
      tokens: Number.MAX_SAFE_INTEGER,
    });
  }

  reserve(amount: BudgetAmount): BudgetReservation | undefined {
    const requested = normalize(amount, "reservation");
    if (
      requested.requests >
        this.#limits.requests -
          this.#settled.requests -
          this.#reserved.requests ||
      requested.tokens >
        this.#limits.tokens - this.#settled.tokens - this.#reserved.tokens
    )
      return undefined;
    this.#reserved = add(this.#reserved, requested);
    let complete = false;
    const finish = (settle: boolean): void => {
      if (complete)
        throw new BudgetError("reservation already settled or released");
      complete = true;
      this.#reserved = subtract(this.#reserved, requested);
      if (settle) this.#settled = add(this.#settled, requested);
    };
    return { settle: () => finish(true), release: () => finish(false) };
  }

  /**
   * Reserves a transport attempt. Every attempt consumes at least one request;
   * supplied token amounts apply to that same attempt. This ledger does not
   * model currency, so hosts must convert cost ceilings to request/token limits.
   */
  reserveAttempt(amount: BudgetAmount): BudgetReservation | undefined {
    const requested = normalize(amount, "attempt reservation");
    return this.reserve({
      requests: Math.max(1, requested.requests),
      tokens: requested.tokens,
    });
  }

  snapshot(): BudgetSnapshot {
    return {
      reserved: { ...this.#reserved },
      settled: { ...this.#settled },
      remaining: subtract(
        subtract(this.#limits, this.#settled),
        this.#reserved,
      ),
    };
  }
}

function normalize(
  amount: BudgetAmount,
  subject: string,
): Required<BudgetAmount> {
  if (!amount || typeof amount !== "object")
    throw new BudgetError(`${subject} must be an object`);
  const normalized = {
    requests: amount.requests ?? 0,
    tokens: amount.tokens ?? 0,
  };
  for (const value of Object.values(normalized))
    if (!Number.isSafeInteger(value) || value < 0)
      throw new BudgetError(
        `${subject} values must be non-negative safe integers`,
      );
  return normalized;
}
function add(
  left: Required<BudgetAmount>,
  right: Required<BudgetAmount>,
): Required<BudgetAmount> {
  return {
    requests: left.requests + right.requests,
    tokens: left.tokens + right.tokens,
  };
}
function subtract(
  left: Required<BudgetAmount>,
  right: Required<BudgetAmount>,
): Required<BudgetAmount> {
  return {
    requests: left.requests - right.requests,
    tokens: left.tokens - right.tokens,
  };
}

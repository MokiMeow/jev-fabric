import { CircuitOpenError } from "./errors.js";

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitterRatio?: number;
}
export interface CircuitBreakerOptions {
  readonly failureThreshold: number;
  readonly resetMs: number;
  readonly now?: () => number;
}
export type CircuitBreakerState = "closed" | "open" | "half_open";

/** Computes a capped exponential delay. Retry-After may lengthen, never shorten, the delay. */
export function computeRetryDelay(
  attempt: number,
  policy: Omit<RetryPolicy, "maxAttempts">,
  random: () => number,
  retryAfterMs?: number,
): number {
  validPolicy({ ...policy, maxAttempts: 1 });
  if (!Number.isSafeInteger(attempt) || attempt < 1)
    throw new RangeError("attempt must be a positive integer");
  const cap = Math.min(
    policy.maxDelayMs,
    policy.baseDelayMs * 2 ** (attempt - 1),
  );
  const ratio = policy.jitterRatio ?? 0;
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1)
    throw new RangeError("jitterRatio must be between zero and one");
  const jittered = cap * (1 + (random() * 2 - 1) * ratio);
  const retryAfter =
    retryAfterMs !== undefined &&
    Number.isFinite(retryAfterMs) &&
    retryAfterMs >= 0
      ? retryAfterMs
      : 0;
  return Math.min(
    policy.maxDelayMs,
    Math.max(0, Math.max(jittered, retryAfter)),
  );
}

/** Explicit per-scheduler circuit state; a half-open circuit permits one probe. */
export class CircuitBreaker {
  #state: CircuitBreakerState = "closed";
  #failures = 0;
  #openedAt = 0;
  #probeInFlight = false;
  readonly #options: Required<CircuitBreakerOptions>;
  constructor(options: CircuitBreakerOptions) {
    if (
      !Number.isSafeInteger(options.failureThreshold) ||
      options.failureThreshold <= 0 ||
      !Number.isFinite(options.resetMs) ||
      options.resetMs < 0
    )
      throw new RangeError("invalid circuit breaker options");
    this.#options = {
      ...options,
      now: options.now ?? (() => performance.now()),
    };
  }
  get state(): CircuitBreakerState {
    this.refresh();
    return this.#state;
  }
  beforeCall(): void {
    this.refresh();
    if (
      this.#state === "open" ||
      (this.#state === "half_open" && this.#probeInFlight)
    )
      throw new CircuitOpenError("decision circuit is open");
    if (this.#state === "half_open") this.#probeInFlight = true;
  }
  success(): void {
    this.#state = "closed";
    this.#failures = 0;
    this.#probeInFlight = false;
  }
  failure(): void {
    this.#probeInFlight = false;
    if (
      this.#state === "half_open" ||
      ++this.#failures >= this.#options.failureThreshold
    ) {
      this.#state = "open";
      this.#openedAt = this.#options.now();
    }
  }
  /** Releases a half-open admission that never reached a transport attempt. */
  cancel(): void {
    if (this.#state === "half_open") this.#probeInFlight = false;
  }
  private refresh(): void {
    if (
      this.#state === "open" &&
      this.#options.now() - this.#openedAt >= this.#options.resetMs
    )
      this.#state = "half_open";
  }
}

export function validPolicy(policy: RetryPolicy): void {
  if (
    !Number.isSafeInteger(policy.maxAttempts) ||
    policy.maxAttempts <= 0 ||
    !Number.isFinite(policy.baseDelayMs) ||
    policy.baseDelayMs < 0 ||
    !Number.isFinite(policy.maxDelayMs) ||
    policy.maxDelayMs < policy.baseDelayMs
  )
    throw new RangeError("invalid retry policy");
}

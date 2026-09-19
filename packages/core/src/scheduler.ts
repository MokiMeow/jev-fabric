import { BudgetLedger, type BudgetAmount } from "./budget.js";
import {
  BudgetError,
  CircuitOpenError,
  DeadlineExceededError,
  QueueFullError,
  RetryExhaustedError,
} from "./errors.js";
import {
  CircuitBreaker,
  type CircuitBreakerOptions,
  computeRetryDelay,
  type RetryPolicy,
  validPolicy,
} from "./retry.js";

export interface SchedulerClock {
  now(): number;
}
export interface DecisionSchedulerOptions {
  readonly providerConcurrency: number;
  readonly tenantConcurrency: number;
  readonly maxQueue?: number;
  /** Required trusted-host ledger; use BudgetLedger.unlimited() only explicitly. */
  readonly budget: BudgetLedger;
  readonly clock?: SchedulerClock;
  readonly random?: () => number;
  /** Injectable for deterministic tests. It must reject if signal aborts. */
  readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly circuitBreaker?: Omit<CircuitBreakerOptions, "now">;
}
export interface ScheduleOptions {
  readonly tenantId: string;
  readonly providerId: string;
  /**
   * Required per-attempt reservation amount. Every dispatch reserves at least
   * one request; supplied tokens apply per attempt. Cost is not ledger-tracked.
   */
  readonly budget: BudgetAmount;
  readonly retry?: RetryPolicy;
  readonly signal?: AbortSignal;
  /** Total monotonic deadline covering queueing, retries, and transport. */
  readonly deadlineMs?: number;
  readonly onAttempt?: (attempt: SchedulerAttempt) => void;
}
export interface SchedulerAttempt {
  readonly attempt: number;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly outcome: "succeeded" | "failed" | "cancelled";
}
export interface TransportAttemptContext {
  readonly attempt: number;
  readonly signal: AbortSignal;
  readonly deadlineMs?: number;
}

/**
 * Bounded scheduler with state scoped to this instance. Transport functions run
 * only after provider/tenant permits and a budget reservation are in place.
 */
export class DecisionScheduler {
  readonly #options: {
    readonly providerConcurrency: number;
    readonly tenantConcurrency: number;
    readonly maxQueue: number;
    readonly budget: BudgetLedger;
    readonly clock: SchedulerClock;
    readonly random: () => number;
    readonly sleep: (
      milliseconds: number,
      signal: AbortSignal,
    ) => Promise<void>;
    readonly circuitBreaker: Omit<CircuitBreakerOptions, "now"> | undefined;
  };
  readonly #providers = new Map<string, Semaphore>();
  readonly #tenants = new Map<string, Semaphore>();
  readonly #circuits = new Map<string, CircuitBreaker>();
  constructor(options: DecisionSchedulerOptions) {
    if (!(options.budget instanceof BudgetLedger))
      throw new BudgetError("a trusted budget ledger is required");
    if (
      !positive(options.providerConcurrency) ||
      !positive(options.tenantConcurrency) ||
      (options.maxQueue !== undefined &&
        (!Number.isSafeInteger(options.maxQueue) || options.maxQueue < 0))
    )
      throw new RangeError("invalid scheduler limits");
    this.#options = {
      providerConcurrency: options.providerConcurrency,
      tenantConcurrency: options.tenantConcurrency,
      maxQueue: options.maxQueue ?? 100,
      budget: options.budget,
      clock: options.clock ?? { now: () => performance.now() },
      random: options.random ?? Math.random,
      sleep: options.sleep ?? abortableSleep,
      circuitBreaker: options.circuitBreaker,
    };
  }

  async run<T>(
    options: ScheduleOptions,
    transport: (context: TransportAttemptContext) => Promise<T>,
  ): Promise<T> {
    if (!options.tenantId || !options.providerId)
      throw new RangeError("tenantId and providerId are required");
    if (
      options.deadlineMs !== undefined &&
      (!Number.isFinite(options.deadlineMs) || options.deadlineMs < 0)
    )
      throw new RangeError("deadlineMs must be non-negative and finite");
    const controller = new AbortController();
    const external = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) external();
    else options.signal?.addEventListener("abort", external, { once: true });
    const startedAt = this.#options.clock.now();
    const deadlineAt =
      options.deadlineMs === undefined
        ? undefined
        : startedAt + options.deadlineMs;
    const timer =
      options.deadlineMs === undefined
        ? undefined
        : setTimeout(
            () =>
              controller.abort(
                new DeadlineExceededError("decision deadline exceeded"),
              ),
            options.deadlineMs,
          );
    let releaseProvider: (() => void) | undefined;
    let releaseTenant: (() => void) | undefined;
    try {
      this.assertUsable(controller.signal, deadlineAt);
      releaseProvider = await this.provider(options.providerId).acquire(
        controller.signal,
      );
      releaseTenant = await this.tenant(options.tenantId).acquire(
        controller.signal,
      );
      const retry = options.retry ?? {
        maxAttempts: 1,
        baseDelayMs: 0,
        maxDelayMs: 0,
      };
      validPolicy(retry);
      let lastError: unknown;
      for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
        this.assertUsable(controller.signal, deadlineAt);
        const circuit = this.circuit(options.providerId);
        const reservation = this.reserve(options.budget);
        let transportStarted = false;
        let circuitAcquired = false;
        let providerStartedAt = this.#options.clock.now();
        try {
          circuit?.beforeCall();
          circuitAcquired = true;
          this.assertUsable(controller.signal, deadlineAt);
          const context: TransportAttemptContext =
            deadlineAt === undefined
              ? { attempt, signal: controller.signal }
              : {
                  attempt,
                  signal: controller.signal,
                  deadlineMs: Math.max(
                    0,
                    deadlineAt - this.#options.clock.now(),
                  ),
                };
          transportStarted = true;
          providerStartedAt = this.#options.clock.now();
          const result = await transport(context);
          // A non-cooperative transport may resolve after cancellation/deadline.
          // Caller abort wins if both conditions are observed at this boundary.
          this.assertUsable(controller.signal, deadlineAt);
          reservation.settle();
          circuit?.success();
          options.onAttempt?.({
            attempt,
            startedAt: providerStartedAt,
            endedAt: this.#options.clock.now(),
            outcome: "succeeded",
          });
          return result;
        } catch (error) {
          const endedAt = this.#options.clock.now();
          if (transportStarted) reservation.settle();
          else reservation.release();
          if (error instanceof CircuitOpenError) throw error;
          if (transportStarted && !controller.signal.aborted)
            circuit?.failure();
          else if (circuitAcquired) circuit?.cancel();
          lastError = error;
          if (transportStarted)
            options.onAttempt?.({
              attempt,
              startedAt: providerStartedAt,
              endedAt,
              outcome: controller.signal.aborted ? "cancelled" : "failed",
            });
          if (controller.signal.aborted) throw abortedError(controller.signal);
          if (
            deadlineAt !== undefined &&
            this.#options.clock.now() >= deadlineAt
          )
            throw new DeadlineExceededError("decision deadline exceeded");
          if (!retryable(error)) throw error;
          if (attempt >= retry.maxAttempts)
            throw new RetryExhaustedError(error);
          const delay = computeRetryDelay(
            attempt,
            retry,
            this.#options.random,
            retryAfter(error),
          );
          if (
            deadlineAt !== undefined &&
            this.#options.clock.now() + delay > deadlineAt
          )
            throw new DeadlineExceededError(
              "decision deadline exceeded before retry",
            );
          await this.#options.sleep(delay, controller.signal);
        }
      }
      throw new RetryExhaustedError(lastError);
    } finally {
      releaseTenant?.();
      releaseProvider?.();
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener("abort", external);
    }
  }

  private reserve(amount: BudgetAmount) {
    const reservation = this.#options.budget.reserveAttempt(amount);
    if (!reservation) throw new BudgetError("budget reservation failed");
    return reservation;
  }
  private provider(id: string): Semaphore {
    return reusable(
      this.#providers,
      id,
      this.#options.providerConcurrency,
      this.#options.maxQueue,
    );
  }
  private tenant(id: string): Semaphore {
    return reusable(
      this.#tenants,
      id,
      this.#options.tenantConcurrency,
      this.#options.maxQueue,
    );
  }
  private circuit(providerId: string): CircuitBreaker | undefined {
    if (!this.#options.circuitBreaker) return undefined;
    let circuit = this.#circuits.get(providerId);
    if (!circuit) {
      circuit = new CircuitBreaker({
        ...this.#options.circuitBreaker,
        now: () => this.#options.clock.now(),
      });
      this.#circuits.set(providerId, circuit);
    }
    return circuit;
  }
  private assertUsable(
    signal: AbortSignal,
    deadlineAt: number | undefined,
  ): void {
    // A caller abort has deterministic precedence when it races a deadline.
    if (signal.aborted) throw abortedError(signal);
    if (deadlineAt !== undefined && this.#options.clock.now() >= deadlineAt)
      throw new DeadlineExceededError("decision deadline exceeded");
  }
}

class Semaphore {
  #available: number;
  readonly #queue: {
    resolve: (release: () => void) => void;
    reject: (error: Error) => void;
    signal: AbortSignal;
    onAbort: () => void;
  }[] = [];
  constructor(
    private readonly limit: number,
    private readonly maxQueue: number,
  ) {
    this.#available = limit;
  }
  acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(abortedError(signal));
    if (this.#available > 0) {
      this.#available -= 1;
      return Promise.resolve(this.releaseFunction());
    }
    if (this.#queue.length >= this.maxQueue)
      return Promise.reject(
        new QueueFullError("decision scheduler queue is full"),
      );
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        signal,
        onAbort: () => {
          const index = this.#queue.indexOf(waiter);
          if (index >= 0) this.#queue.splice(index, 1);
          reject(abortedError(signal));
        },
      };
      signal.addEventListener("abort", waiter.onAbort, { once: true });
      this.#queue.push(waiter);
    });
  }
  private releaseFunction(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const waiter = this.#queue.shift();
      if (waiter) {
        waiter.signal.removeEventListener("abort", waiter.onAbort);
        waiter.resolve(this.releaseFunction());
      } else this.#available = Math.min(this.limit, this.#available + 1);
    };
  }
}

function reusable(
  map: Map<string, Semaphore>,
  id: string,
  limit: number,
  maxQueue: number,
): Semaphore {
  let semaphore = map.get(id);
  if (!semaphore) {
    semaphore = new Semaphore(limit, maxQueue);
    map.set(id, semaphore);
  }
  return semaphore;
}
function positive(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
function retryable(error: unknown): boolean {
  return !(
    error instanceof DeadlineExceededError || error instanceof BudgetError
  );
}
function retryAfter(error: unknown): number | undefined {
  return error &&
    typeof error === "object" &&
    "retryAfterMs" in error &&
    typeof (error as { retryAfterMs?: unknown }).retryAfterMs === "number"
    ? (error as { retryAfterMs: number }).retryAfterMs
    : undefined;
}
function abortedError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("decision operation aborted");
}
function abortableSleep(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.reject(abortedError(signal));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(abortedError(signal));
    };
    function done() {
      signal.removeEventListener("abort", abort);
      resolve();
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

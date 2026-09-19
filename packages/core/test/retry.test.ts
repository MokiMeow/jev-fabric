import { describe, expect, it } from "vitest";
import { CircuitBreaker, computeRetryDelay } from "../src/index.js";

describe("retry and circuit breaker", () => {
  it("bounds exponential backoff and honors a longer Retry-After", () => {
    expect(
      computeRetryDelay(
        4,
        { baseDelayMs: 10, maxDelayMs: 50, jitterRatio: 0.5 },
        () => 1,
      ),
    ).toBe(50);
    expect(
      computeRetryDelay(1, { baseDelayMs: 10, maxDelayMs: 50 }, () => 0.5, 30),
    ).toBe(30);
  });

  it("opens after failures and admits a single half-open trial after cooldown", () => {
    let now = 0;
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      resetMs: 10,
      now: () => now,
    });
    breaker.beforeCall();
    breaker.failure();
    breaker.beforeCall();
    breaker.failure();
    expect(breaker.state).toBe("open");
    now = 10;
    breaker.beforeCall();
    expect(breaker.state).toBe("half_open");
    expect(() => breaker.beforeCall()).toThrow("open");
    breaker.success();
    expect(breaker.state).toBe("closed");
  });
});

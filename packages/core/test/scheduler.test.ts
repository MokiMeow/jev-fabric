import { describe, expect, it } from "vitest";
import {
  BudgetLedger,
  BudgetError,
  CircuitOpenError,
  DecisionScheduler,
  RetryExhaustedError,
  type BudgetAmount,
} from "../src/index.js";

describe("decision scheduler", () => {
  if (process.env.JEV_FABRIC_TYPE_TEST === "1") {
    const scheduler = new DecisionScheduler({
      providerConcurrency: 1,
      tenantConcurrency: 1,
      budget: BudgetLedger.unlimited(),
    });
    // @ts-expect-error Every transport requires an explicit reservation amount.
    scheduler.run({ tenantId: "t", providerId: "p" }, async () => "never");
  }

  it("reserves before every transport attempt and retries with Retry-After", async () => {
    const sleeps: number[] = [];
    const budget = new BudgetLedger({ requests: 2 });
    const scheduler = new DecisionScheduler({
      providerConcurrency: 1,
      tenantConcurrency: 1,
      budget,
      random: () => 0.5,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    let calls = 0;
    await expect(
      scheduler.run(
        {
          tenantId: "t",
          providerId: "p",
          budget: { requests: 1 },
          retry: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 20 },
        },
        async () => {
          calls += 1;
          if (calls === 1)
            Object.assign(new Error("retry"), { retryAfterMs: 12 });
          if (calls === 1)
            throw Object.assign(new Error("retry"), { retryAfterMs: 12 });
          return "ok";
        },
      ),
    ).resolves.toBe("ok");
    expect(calls).toBe(2);
    expect(sleeps).toEqual([12]);
    expect(budget.snapshot().settled.requests).toBe(2);
  });

  it("does not start a transport call when budget reservation fails", async () => {
    const scheduler = new DecisionScheduler({
      providerConcurrency: 1,
      tenantConcurrency: 1,
      budget: new BudgetLedger({ requests: 0 }),
    });
    let started = false;
    await expect(
      scheduler.run(
        { tenantId: "t", providerId: "p", budget: { requests: 1 } },
        async () => {
          started = true;
          return "no";
        },
      ),
    ).rejects.toThrow("budget");
    expect(started).toBe(false);
  });

  it("requires one request per attempt even when callers provide zero-sized amounts", async () => {
    const scheduler = new DecisionScheduler({
      providerConcurrency: 1,
      tenantConcurrency: 1,
      budget: new BudgetLedger({ requests: 0 }),
    });
    const amounts: readonly BudgetAmount[] = [
      {},
      { requests: 0 },
      { requests: 0, tokens: 0 },
      { requests: -1 },
      { requests: Number.NaN },
      { requests: Number.POSITIVE_INFINITY },
    ];
    for (const amount of amounts) {
      let started = false;
      await expect(
        scheduler.run(
          { tenantId: "t", providerId: "p", budget: amount },
          async () => {
            started = true;
            return "unexpected";
          },
        ),
      ).rejects.toBeInstanceOf(BudgetError);
      expect(started).toBe(false);
    }
  });

  it("does not dispatch a retry when only one request remains", async () => {
    const scheduler = new DecisionScheduler({
      providerConcurrency: 1,
      tenantConcurrency: 1,
      budget: new BudgetLedger({ requests: 1 }),
      sleep: async () => {},
    });
    let calls = 0;
    await expect(
      scheduler.run(
        {
          tenantId: "t",
          providerId: "p",
          budget: {},
          retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 },
        },
        async () => {
          calls += 1;
          throw new Error("retry");
        },
      ),
    ).rejects.toThrow("budget");
    expect(calls).toBe(1);
  });

  it("allows explicitly unlimited trusted budget with the required request floor", async () => {
    const scheduler = new DecisionScheduler({
      providerConcurrency: 1,
      tenantConcurrency: 1,
      budget: BudgetLedger.unlimited(),
    });
    await expect(
      scheduler.run(
        { tenantId: "t", providerId: "p", budget: {} },
        async () => "called",
      ),
    ).resolves.toBe("called");
  });

  it("stops after bounded retry exhaustion", async () => {
    const scheduler = new DecisionScheduler({
      providerConcurrency: 1,
      tenantConcurrency: 1,
      budget: new BudgetLedger({ requests: 2 }),
      sleep: async () => {},
    });
    let attempts = 0;
    await expect(
      scheduler.run(
        {
          tenantId: "t",
          providerId: "p",
          budget: { requests: 1 },
          retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 },
        },
        async () => {
          attempts += 1;
          throw new Error("transient");
        },
      ),
    ).rejects.toBeInstanceOf(RetryExhaustedError);
    expect(attempts).toBe(2);
  });

  it("cancels during retry backoff before another transport starts", async () => {
    let enteredBackoff!: () => void;
    const inBackoff = new Promise<void>((resolve) => {
      enteredBackoff = resolve;
    });
    const scheduler = new DecisionScheduler({
      providerConcurrency: 1,
      tenantConcurrency: 1,
      budget: new BudgetLedger({ requests: 2 }),
      sleep: async (_milliseconds, signal) => {
        enteredBackoff();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new Error("decision operation aborted")),
            { once: true },
          );
        });
      },
    });
    const controller = new AbortController();
    let attempts = 0;
    const pending = scheduler.run(
      {
        tenantId: "t",
        providerId: "p",
        budget: { requests: 1 },
        signal: controller.signal,
        retry: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 1 },
      },
      async () => {
        attempts += 1;
        throw new Error("retry");
      },
    );
    await inBackoff;
    controller.abort();
    await expect(pending).rejects.toThrow("aborted");
    expect(attempts).toBe(1);
  });

  it("cancels work while it is waiting in a bounded queue", async () => {
    let release!: () => void;
    const scheduler = new DecisionScheduler({
      providerConcurrency: 1,
      tenantConcurrency: 1,
      budget: new BudgetLedger({ requests: 2 }),
    });
    const first = scheduler.run(
      { tenantId: "t", providerId: "p", budget: { requests: 1 } },
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve("first");
        }),
    );
    const controller = new AbortController();
    const queued = scheduler.run(
      {
        tenantId: "t",
        providerId: "p",
        budget: { requests: 1 },
        signal: controller.signal,
      },
      async () => "second",
    );
    controller.abort();
    await expect(queued).rejects.toThrow("aborted");
    release();
    await expect(first).resolves.toBe("first");
  });

  it("refuses to invoke a transport unless a mandatory reservation is configured", async () => {
    expect(
      () =>
        new DecisionScheduler({
          providerConcurrency: 1,
          tenantConcurrency: 1,
        } as never),
    ).toThrow("budget");
  });

  it("gives caller abort precedence over a non-cooperative late success", async () => {
    const scheduler = new DecisionScheduler({
      providerConcurrency: 1,
      tenantConcurrency: 1,
      budget: new BudgetLedger({ requests: 1 }),
    });
    const controller = new AbortController();
    let resolve!: (value: string) => void;
    let entered!: () => void;
    const transportEntered = new Promise<void>((done) => {
      entered = done;
    });
    const pending = scheduler.run(
      {
        tenantId: "t",
        providerId: "p",
        budget: { requests: 1 },
        signal: controller.signal,
      },
      () =>
        new Promise<string>((done) => {
          resolve = done;
          entered();
        }),
    );
    await transportEntered;
    controller.abort();
    resolve("late success");
    await expect(pending).rejects.toThrow("aborted");
  });

  it("gives caller abort precedence over a non-cooperative late failure", async () => {
    const scheduler = new DecisionScheduler({
      providerConcurrency: 1,
      tenantConcurrency: 1,
      budget: new BudgetLedger({ requests: 1 }),
    });
    const controller = new AbortController();
    let reject!: (reason: Error) => void;
    let entered!: () => void;
    const transportEntered = new Promise<void>((done) => {
      entered = done;
    });
    const pending = scheduler.run(
      {
        tenantId: "t",
        providerId: "p",
        budget: { requests: 1 },
        signal: controller.signal,
      },
      () =>
        new Promise<string>((_resolve, fail) => {
          reject = fail;
          entered();
        }),
    );
    await transportEntered;
    controller.abort();
    reject(new Error("late failure"));
    await expect(pending).rejects.toThrow("aborted");
  });

  it("gives total deadline precedence over a non-cooperative late success", async () => {
    let now = 0;
    const scheduler = new DecisionScheduler({
      providerConcurrency: 1,
      tenantConcurrency: 1,
      budget: new BudgetLedger({ requests: 1 }),
      clock: { now: () => now },
    });
    await expect(
      scheduler.run(
        {
          tenantId: "t",
          providerId: "p",
          budget: { requests: 1 },
          deadlineMs: 10,
        },
        async () => {
          now = 11;
          return "late success";
        },
      ),
    ).rejects.toThrow("deadline");
  });

  it("does not strand a half-open circuit after a reservation rejection", async () => {
    let now = 0;
    const budget = new BudgetLedger({ requests: 2 });
    const scheduler = new DecisionScheduler({
      providerConcurrency: 1,
      tenantConcurrency: 1,
      budget,
      clock: { now: () => now },
      circuitBreaker: { failureThreshold: 1, resetMs: 1 },
    });
    await expect(
      scheduler.run(
        { tenantId: "t", providerId: "p", budget: { requests: 0 } },
        async () => {
          throw new Error("failure");
        },
      ),
    ).rejects.toBeInstanceOf(RetryExhaustedError);
    now = 1;
    await expect(
      scheduler.run(
        { tenantId: "t", providerId: "p", budget: { requests: 2 } },
        async () => "never",
      ),
    ).rejects.toThrow("budget");
    await expect(
      scheduler.run(
        { tenantId: "t", providerId: "p", budget: { requests: 1 } },
        async () => "recovered",
      ),
    ).resolves.toBe("recovered");
  });

  it("fails fast with CircuitOpenError and releases its pre-transport reservation", async () => {
    const budget = new BudgetLedger({ requests: 2 });
    const sleeps: number[] = [];
    const scheduler = new DecisionScheduler({
      providerConcurrency: 1,
      tenantConcurrency: 1,
      budget,
      circuitBreaker: { failureThreshold: 1, resetMs: 1_000 },
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    });
    await expect(
      scheduler.run(
        { tenantId: "t", providerId: "p", budget: {} },
        async () => {
          throw new Error("provider failure");
        },
      ),
    ).rejects.toBeInstanceOf(RetryExhaustedError);
    await expect(
      scheduler.run(
        {
          tenantId: "t",
          providerId: "p",
          budget: {},
          retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 },
        },
        async () => "must not run",
      ),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(sleeps).toEqual([]);
    expect(budget.snapshot().remaining.requests).toBe(1);
  });
});

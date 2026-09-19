import { describe, expect, it } from "vitest";
import { BudgetLedger, BudgetError } from "../src/index.js";

describe("budget ledger", () => {
  it("does not reserve a request when zero budget remains and settles exactly once", () => {
    const ledger = new BudgetLedger({ requests: 1, tokens: 10 });
    const reservation = ledger.reserve({ requests: 1, tokens: 3 });
    expect(reservation).toBeDefined();
    if (!reservation) throw new Error("expected a reservation");
    expect(ledger.reserve({ requests: 1 })).toBeUndefined();
    reservation.settle();
    expect(ledger.snapshot()).toEqual({
      reserved: { requests: 0, tokens: 0 },
      settled: { requests: 1, tokens: 3 },
      remaining: { requests: 0, tokens: 7 },
    });
    expect(() => reservation.release()).toThrow(BudgetError);
  });

  it("rejects negative budgets and reservations", () => {
    expect(() => new BudgetLedger({ requests: -1 })).toThrow(BudgetError);
    expect(() =>
      new BudgetLedger({ requests: 1 }).reserve({ requests: -1 }),
    ).toThrow(BudgetError);
  });
});

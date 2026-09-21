import { createHash } from "node:crypto";
import { financeResearchRouterPack } from "@mokimeow/jev-fabric-packs";
import { choice, runOfflineExample } from "../shared.js";

const observedAt = "2026-09-20T10:00:00.000Z";
const request = "Show AAPL price history for one month.";
const sha256 = (value: string) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const candidates = [
  {
    id: "plot_price",
    description: "Propose a read-only historical price chart",
    available: true,
    freshness: "current",
  },
  {
    id: "compare_returns",
    description: "Propose a read-only comparison of historical returns",
    available: true,
    freshness: "current",
  },
  {
    id: "rolling_correlation",
    description: "Propose a read-only rolling-correlation calculation",
    available: true,
    freshness: "current",
  },
  {
    id: "summary_stats",
    description: "Propose read-only descriptive statistics",
    available: true,
    freshness: "current",
  },
  {
    id: "market_summary",
    description: "Propose a read-only market summary",
    available: true,
    freshness: "current",
  },
  {
    id: "list_symbols",
    description: "List the host-declared research symbols",
    available: true,
    freshness: "current",
  },
  {
    id: "investigate",
    description: "Route an unsafe, unsupported, or ambiguous request to review",
    available: true,
    freshness: "current",
  },
] as const;

/** Synthetic and offline: no analytics tool or financial action is executed. */
export const example = () => {
  const state = {
    contractVersion: "1",
    advisoryOnly: true,
    execution: "NOT_SUPPORTED",
    purpose: "read_only_market_research",
    requestRef: "ref:offline-research",
    observedAt,
    validUntil: "2026-09-20T10:01:00.000Z",
    maxAgeMs: 60_000,
    request: {
      text: request,
      textHash: sha256(request),
      trust: "untrusted_data_only",
      redaction: "host_redacted",
    },
    symbols: [
      {
        id: "AAPL",
        displayName: "Apple Inc.",
        available: true,
        freshness: "current",
      },
      {
        id: "MSFT",
        displayName: "Microsoft Corp.",
        available: true,
        freshness: "current",
      },
    ],
    candidates,
  } as const;
  return runOfflineExample({
    name: "finance-research-router",
    pack: financeResearchRouterPack,
    state,
    answers: [
      {
        questionId: "finance-research-prohibited-intent",
        type: "noul",
        value: false,
        probabilityYes: 0.05,
      },
      {
        questionId: "finance-research-untrusted-influence",
        type: "noul",
        value: false,
        probabilityYes: 0.05,
      },
      choice(
        "finance-research-tool",
        "plot_price",
        candidates.map(({ id }) => id),
      ),
      choice("finance-research-primary-symbol", "AAPL", [
        "AAPL",
        "MSFT",
        "not_applicable",
        "not_listed",
      ]),
      choice("finance-research-secondary-symbol", "not_applicable", [
        "AAPL",
        "MSFT",
        "not_applicable",
        "not_listed",
      ]),
      choice("finance-research-window", "one_month", [
        "one_day",
        "five_days",
        "one_month",
        "three_months",
        "six_months",
        "one_year",
        "not_specified",
      ]),
    ],
    negativeState: { ...state, execution: "SUPPORTED" },
    expectedOutcome: "route",
    expectedSelectedId: "plot_price",
    negativeOutcome: "deny",
    nowEpochMs: Date.parse(observedAt) + 500,
  });
};

if (import.meta.main)
  void example().then((value) => console.log(JSON.stringify(value)));

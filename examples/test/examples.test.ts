import { describe, expect, it } from "vitest";
import { decisionReceiptSchema } from "@mokimeow/jev-fabric-protocol";
import { example as browser } from "../browser-action/index.js";
import { example as completion } from "../completion-check/index.js";
import { example as ci } from "../ci-triage/index.js";
import { example as evaluate } from "../evaluate-pack/index.js";
import { example as gate } from "../gate-tool-action/index.js";
import { example as rank } from "../rerank-evidence/index.js";
import { example as route } from "../route-skills/index.js";
import { example as support } from "../support-triage/index.js";
import { example as toolEnvironment } from "../tool-environment-advice/index.js";
import { example as webmcp } from "../webmcp-action/index.js";
import { example as nativeProvider } from "../provider-native-fake/index.js";
import { example as compatibleProvider } from "../provider-compatible-fake/index.js";
import { example as gatewayProvider } from "../provider-gateway-typesafe-fake/index.js";

describe("offline public examples", () => {
  for (const [name, run, outcome, selected] of [
    ["route", route, "route", "coding"],
    ["gate", gate, "allow", undefined],
    ["rank", rank, "allow", "source-a"],
    ["ci", ci, "allow", "accept"],
    ["support", support, "route", "technical"],
    ["browser", browser, "route", "ask-user"],
    ["completion", completion, "allow", "complete"],
    ["evaluate", evaluate, "allow", "in_progress"],
    ["tool-environment", toolEnvironment, "route", "ask-user"],
  ] as const) {
    it(`${name} validates a receipt and a fail-closed path`, async () => {
      const result = await run();
      expect(result.positiveCalls).toBe(1);
      expect(result.semantic.status).toBe("decision");
      expect(result.semantic.selectedId).toBe(selected);
      expect(result.receipt.outcome).toBe(outcome);
      expect(decisionReceiptSchema.parse(result.receipt)).toEqual(
        result.receipt,
      );
      expect(result.receipt.redacted).toBe(true);
      expect(result.negativeCalls).toBe(0);
      expect(decisionReceiptSchema.parse(result.negativeReceipt)).toEqual(
        result.negativeReceipt,
      );
      expect(result.negativeReceipt.outcome).not.toBe(result.receipt.outcome);
      expect("state" in result.receipt).toBe(false);
    });
  }
});

describe("offline provider composition examples", () => {
  for (const [name, run, semantics] of [
    ["native", nativeProvider, "native_calibrated"],
    ["compatible", compatibleProvider, "self_reported"],
    ["vercel-gateway", gatewayProvider, "native_calibrated"],
  ] as const) {
    it(`${name} uses injected provider I/O and returns a redacted advisory receipt`, async () => {
      const result = await run();
      expect(result.receipt.redacted).toBe(true);
      expect(result.receipt.outcome).toBe("route");
      expect(result.receipt.probabilitySemantics).toBe(semantics);
      expect(result.receipt.answers).toHaveLength(1);
    });
  }
});

describe("offline WebMCP boundary example", () => {
  it("returns fingerprints only and rejects cross-origin metadata", () => {
    const result = webmcp();
    expect(result.binding).toMatchObject({
      advisoryOnly: true,
      execution: "NOT_SUPPORTED",
    });
    expect(result.rejectedCrossOrigin).toBe(true);
    expect(JSON.stringify(result.binding)).not.toContain("tools.example.test");
  });
});

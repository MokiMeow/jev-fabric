import { describe, expect, it } from "vitest";
import {
  applyFinanceObserveGate,
  assertFinanceGoldRouteAlignment,
  combineFinanceObserveSupport,
  createFinanceObserveGatePolicyArtifact,
  financeAtomicEvidenceRoute,
  financeAtomicMetrics,
  financeObserveGateMetrics,
  financeObserveSupport,
  fitFinanceObserveGate,
  oneSidedWilsonUpperBound95,
  partitionFinanceObserveGateCalibrationGroups,
  validateFinanceObserveGatePolicyArtifact,
  type FinanceAtomicEvidenceLedger,
  type FinanceObserveCalibrationCase,
} from "../src/index.js";

const hash = `sha256:${"a".repeat(64)}`;
type MutableLedger = {
  role: "host" | "jev";
  questionSetHash: string;
  candidateBindings: Array<{
    candidateId: string;
    evidenceHash: string;
    claimQuestionId:
      | `finance-text-claim:${string}`
      | `finance-text-claim-cited:${string}`;
    citationQuestionId: `finance-text-citation:${string}` | null;
  }>;
  questions: Array<{
    questionId: string;
    selected: string;
    probabilities: Record<string, number>;
    candidateId: string | null;
    evidenceHash: string | null;
  }>;
};

function ledger(
  role: "host" | "jev",
  routeObserve = 0.8,
): FinanceAtomicEvidenceLedger {
  return {
    role,
    questionSetHash: hash,
    candidateBindings: [
      {
        candidateId: "item_1",
        evidenceHash: hash,
        claimQuestionId: "finance-text-claim:item_1",
        citationQuestionId: null,
      },
    ],
    questions: [
      choice("finance-route", {
        observe: routeObserve,
        investigate: 1 - routeObserve,
        escalate: 0,
      }),
      choice("finance-anomaly", {
        routine: 0.9,
        concerning: 0.05,
        unclear: 0.05,
      }),
      choice("finance-evidence-quality", {
        sufficient: 0.85,
        conflicted: 0.1,
        insufficient: 0.05,
      }),
      choice("finance-untrusted-influence", { absent: 0.95, present: 0.05 }),
      choice(
        "finance-text-claim:item_1",
        {
          performance_change: 0.02,
          guidance_or_outlook_change: 0.01,
          liquidity_or_going_concern: 0.01,
          accounting_or_control_issue: 0.01,
          legal_or_regulatory_contingency: 0.01,
          none: 0.94,
          unclear: 0,
        },
        "item_1",
      ),
    ],
  };
}

describe("finance.observe-gate.v3", () => {
  it("uses the non-compensating minimum across base, claim, and citation evidence", () => {
    expect(financeObserveSupport(ledger("jev"))).toEqual({
      score: 0.8,
      factorCount: 5,
    });
    expect(
      combineFinanceObserveSupport([ledger("host", 0.7), ledger("jev")]),
    ).toEqual({
      score: 0.7,
      factorCount: 10,
    });
  });

  it("treats an unclear claim as non-observe evidence", () => {
    const unclear = structuredClone(ledger("jev")) as unknown as MutableLedger;
    const claim = unclear.questions[4];
    if (claim === undefined) throw new Error("fixture omitted claim question");
    claim.selected = "unclear";
    claim.probabilities = {
      performance_change: 0.01,
      guidance_or_outlook_change: 0.01,
      liquidity_or_going_concern: 0.01,
      accounting_or_control_issue: 0.01,
      legal_or_regulatory_contingency: 0.01,
      none: 0.2,
      unclear: 0.75,
    };
    expect(financeObserveSupport(unclear)).toEqual({
      score: 0.2,
      factorCount: 5,
    });
    expect(financeAtomicEvidenceRoute([unclear])).toBe("investigate");
  });

  it("takes the most restrictive route selected across atomic ledgers", () => {
    const host = structuredClone(ledger("host")) as unknown as MutableLedger;
    const jev = structuredClone(ledger("jev")) as unknown as MutableLedger;
    const anomaly = jev.questions[1];
    if (anomaly === undefined)
      throw new Error("fixture omitted anomaly question");
    anomaly.selected = "concerning";
    anomaly.probabilities = {
      routine: 0.1,
      concerning: 0.8,
      unclear: 0.1,
    };
    expect(financeAtomicEvidenceRoute([host, jev])).toBe("escalate");
    expect(financeAtomicEvidenceRoute([])).toBeNull();
  });

  it("requires exact dynamic candidate identity and complete base coverage", () => {
    const bad = structuredClone(ledger("jev")) as unknown as MutableLedger;
    const badClaim = bad.questions[4];
    if (badClaim === undefined)
      throw new Error("fixture omitted claim question");
    badClaim.candidateId = "another";
    expect(() => financeObserveSupport(bad)).toThrow(/binding/u);

    const missing = structuredClone(ledger("jev")) as typeof bad;
    missing.questions.splice(1, 1);
    expect(() => financeObserveSupport(missing)).toThrow(/coverage/u);
  });

  it("requires cited claims and citations to cover the exact same candidate", () => {
    const cited = structuredClone(ledger("jev")) as unknown as MutableLedger;
    const citedBinding = cited.candidateBindings[0];
    const citedClaim = cited.questions[4];
    if (citedBinding === undefined || citedClaim === undefined)
      throw new Error("fixture omitted cited-claim inputs");
    citedBinding.claimQuestionId = "finance-text-claim-cited:item_1";
    citedBinding.citationQuestionId = "finance-text-citation:item_1";
    citedClaim.questionId = "finance-text-claim-cited:item_1";
    expect(() => financeObserveSupport(cited)).toThrow(/coverage/u);
    cited.questions.push(
      choice(
        "finance-text-citation:item_1",
        { supports: 0.75, contradicts: 0.05, insufficient_context: 0.2 },
        "item_1",
      ),
    );
    expect(financeObserveSupport(cited)).toEqual({
      score: 0.75,
      factorCount: 6,
    });

    const uncited = structuredClone(ledger("jev")) as unknown as MutableLedger;
    uncited.questions.push(
      choice(
        "finance-text-citation:item_1",
        { supports: 0.75, contradicts: 0.05, insufficient_context: 0.2 },
        "item_1",
      ),
    );
    expect(() => financeObserveSupport(uncited)).toThrow(/coverage/u);
  });

  it("fits on one group partition and audits risk on the other", () => {
    const rows: FinanceObserveCalibrationCase[] = [
      calibration("a", 0.9, "observe"),
      calibration("b", 0.8, "investigate"),
      calibration("c", 0.7, "observe"),
      calibration("d", 0.6, "investigate"),
    ];
    const policy = fitFinanceObserveGate(
      rows,
      "financial_text_triage",
      "jev_advisory",
      1,
      2,
    );
    expect(policy).toMatchObject({
      status: "CALIBRATED",
      schemaVersion: "3",
      riskSemantics: "one_sided_wilson_group_audit",
      riskConfidenceLevel: 0.95,
      acceptedObserveCount: 2,
      acceptedObserveGroupCount: 2,
      auditAcceptedObserveCount: 2,
      auditAcceptedObserveGroupCount: 2,
      calibrationCaseCount: 4,
      calibrationGroupCount: 4,
      thresholdFitGroupCount: 2,
      riskAuditGroupCount: 2,
    });
    expect(policy.auditFalseObserveGroupRiskUpperBound).toBeLessThanOrEqual(1);
    const forged = structuredClone(policy) as unknown as {
      acceptedObserveGroupCount: number;
    };
    forged.acceptedObserveGroupCount = 1;
    expect(() =>
      applyFinanceObserveGate(
        "observe",
        0.9,
        forged as unknown as typeof policy,
      ),
    ).toThrow(/counts|observed/u);
  });

  it("requires the selected threshold to cover enough independent groups", () => {
    const groupIds = [
      "group-a",
      "group-b",
      "group-c",
      "group-d",
      "group-e",
      "group-f",
    ];
    const partition = partitionFinanceObserveGateCalibrationGroups(
      groupIds,
      "financial_text_triage",
      "jev_advisory",
    );
    const acceptedFitGroup = partition.thresholdFitGroupIds[0];
    if (acceptedFitGroup === undefined)
      throw new Error("fixture omitted threshold-fit group");
    const rows: FinanceObserveCalibrationCase[] = groupIds.map(
      (groupId, index) => ({
        ...calibration(
          String(index),
          groupId === acceptedFitGroup ? 0.9 : 0.8,
          groupId === acceptedFitGroup ||
            partition.riskAuditGroupIds.includes(groupId)
            ? "observe"
            : "investigate",
        ),
        groupId,
      }),
    );
    expect(
      fitFinanceObserveGate(
        rows,
        "financial_text_triage",
        "jev_advisory",
        0,
        3,
      ),
    ).toMatchObject({
      status: "UNAVAILABLE",
      reason: "insufficient_accepted_calibration_groups",
      calibrationGroupCount: 6,
      eligibleObserveCount: 3,
      acceptedObserveCount: 0,
      acceptedObserveGroupCount: 0,
    });
  });

  it("partitions calibration groups deterministically without overlap", () => {
    const groupIds = ["group-a", "group-b", "group-c", "group-d", "group-e"];
    const first = partitionFinanceObserveGateCalibrationGroups(
      groupIds,
      "market_surveillance",
      "host_plus_jev",
    );
    const reordered = partitionFinanceObserveGateCalibrationGroups(
      [...groupIds].reverse(),
      "market_surveillance",
      "host_plus_jev",
    );
    expect(reordered).toEqual(first);
    expect(
      new Set([...first.thresholdFitGroupIds, ...first.riskAuditGroupIds]),
    ).toEqual(new Set(groupIds));
    expect(
      first.thresholdFitGroupIds.filter((groupId) =>
        first.riskAuditGroupIds.includes(groupId),
      ),
    ).toEqual([]);
    expect(
      Math.abs(
        first.thresholdFitGroupIds.length - first.riskAuditGroupIds.length,
      ),
    ).toBeLessThanOrEqual(1);
    expect(() =>
      partitionFinanceObserveGateCalibrationGroups(
        ["duplicate", "duplicate"],
        "market_surveillance",
        "host_plus_jev",
      ),
    ).toThrow(/unique strings/u);
  });

  it("computes and validates the one-sided 95% Wilson group-risk bound", () => {
    expect(oneSidedWilsonUpperBound95(0, 1)).toBeCloseTo(
      0.730_134_051_215_945_8,
      12,
    );
    expect(oneSidedWilsonUpperBound95(0, 10)).toBeCloseTo(
      0.212_941_970_083_406_98,
      12,
    );
    expect(oneSidedWilsonUpperBound95(1, 10)).toBeGreaterThan(
      oneSidedWilsonUpperBound95(0, 10),
    );
    expect(oneSidedWilsonUpperBound95(10, 10)).toBe(1);
    expect(() => oneSidedWilsonUpperBound95(-1, 10)).toThrow(/Wilson inputs/u);
    expect(() => oneSidedWilsonUpperBound95(11, 10)).toThrow(/Wilson inputs/u);
    expect(() => oneSidedWilsonUpperBound95(0, 0)).toThrow(/Wilson inputs/u);
  });

  it("fails closed when held-out audit groups exceed the risk bound", () => {
    const groupIds = ["group-a", "group-b", "group-c", "group-d"];
    const partition = partitionFinanceObserveGateCalibrationGroups(
      groupIds,
      "financial_text_triage",
      "jev_advisory",
    );
    const rows = groupIds.map((groupId, index) => ({
      ...calibration(
        String(index),
        0.9,
        partition.riskAuditGroupIds.includes(groupId)
          ? "investigate"
          : "observe",
      ),
      groupId,
    }));
    expect(
      fitFinanceObserveGate(
        rows,
        "financial_text_triage",
        "jev_advisory",
        0.5,
        2,
      ),
    ).toMatchObject({
      status: "UNAVAILABLE",
      reason: "risk_audit_bound_exceeded",
      acceptedObserveGroupCount: 2,
      auditAcceptedObserveGroupCount: 2,
      auditFalseObserveGroupCount: 2,
      auditObservedFalseObserveGroupRisk: 1,
      auditFalseObserveGroupRiskUpperBound: 1,
    });
  });

  it("rejects a forged calibrated policy that violates fit-risk evidence", () => {
    const groupIds = Array.from({ length: 10 }, (_, index) => `group-${index}`);
    const partition = partitionFinanceObserveGateCalibrationGroups(
      groupIds,
      "financial_text_triage",
      "jev_advisory",
    );
    const falseFitGroups = new Set(partition.thresholdFitGroupIds.slice(0, 2));
    const rows = groupIds.map((groupId, index) => ({
      ...calibration(
        String(index),
        0.9,
        falseFitGroups.has(groupId) ? "investigate" : "observe",
      ),
      groupId,
    }));
    const policy = fitFinanceObserveGate(
      rows,
      "financial_text_triage",
      "jev_advisory",
      0.5,
      5,
    );
    expect(policy).toMatchObject({
      status: "CALIBRATED",
      acceptedObserveCount: 5,
      falseObserveCount: 2,
      fitFalseObserveGroupCount: 2,
      fitObservedFalseObserveGroupRisk: 0.4,
      auditFalseObserveGroupCount: 0,
    });
    const relaxedAuditOnly = structuredClone(policy) as unknown as {
      maxFalseObserveGroupRiskUpperBound: number;
    };
    relaxedAuditOnly.maxFalseObserveGroupRiskUpperBound = 0.39;
    expect(() =>
      applyFinanceObserveGate(
        "observe",
        0.9,
        relaxedAuditOnly as unknown as typeof policy,
      ),
    ).toThrow(/counts/u);

    const impossibleCounts = structuredClone(policy) as unknown as {
      falseObserveCount: number;
      observedFalseObserveRisk: number;
    };
    impossibleCounts.falseObserveCount = 1;
    impossibleCounts.observedFalseObserveRisk = 0.2;
    expect(() =>
      applyFinanceObserveGate(
        "observe",
        0.9,
        impossibleCounts as unknown as typeof policy,
      ),
    ).toThrow(/counts/u);
  });

  it("fails closed when the selected threshold lacks audit-group support", () => {
    const groupIds = ["group-a", "group-b", "group-c", "group-d"];
    const partition = partitionFinanceObserveGateCalibrationGroups(
      groupIds,
      "financial_text_triage",
      "jev_advisory",
    );
    const rows = groupIds.map((groupId, index) => ({
      ...calibration(
        String(index),
        partition.riskAuditGroupIds.includes(groupId) ? 0.1 : 0.9,
        "observe",
      ),
      groupId,
    }));
    expect(
      fitFinanceObserveGate(
        rows,
        "financial_text_triage",
        "jev_advisory",
        1,
        2,
      ),
    ).toMatchObject({
      status: "UNAVAILABLE",
      reason: "insufficient_risk_audit_groups",
      acceptedObserveGroupCount: 2,
      auditAcceptedObserveGroupCount: 0,
      auditFalseObserveGroupRiskUpperBound: null,
    });
  });

  it("returns an unavailable policy rather than inventing a threshold", () => {
    expect(
      fitFinanceObserveGate([], "market_surveillance", "jev_advisory", 0, 1),
    ).toMatchObject({
      status: "UNAVAILABLE",
      reason: "insufficient_calibration_groups",
      threshold: null,
    });
    expect(
      fitFinanceObserveGate(
        [],
        "market_surveillance",
        "deterministic_only",
        0,
        1,
      ),
    ).toMatchObject({ status: "UNAVAILABLE", reason: "deterministic_only" });
  });

  it("only upgrades an unaccepted observe route to investigate", () => {
    const policy = fitFinanceObserveGate(
      [calibration("a", 0.8, "observe"), calibration("b", 0.8, "observe")],
      "financial_text_triage",
      "jev_advisory",
      1,
      1,
    );
    expect(applyFinanceObserveGate("observe", 0.79, policy)).toEqual({
      route: "investigate",
      abstained: true,
      reason: "below_threshold",
    });
    expect(applyFinanceObserveGate("investigate", 0, policy)).toEqual({
      route: "investigate",
      abstained: false,
      reason: null,
    });
    expect(applyFinanceObserveGate("escalate", null, policy)).toEqual({
      route: "escalate",
      abstained: false,
      reason: null,
    });
  });

  it("reports exact denominators and null risk at zero accepted coverage", () => {
    expect(
      financeObserveGateMetrics([
        {
          ungatedRoute: "observe",
          predictedRoute: "investigate",
          goldRoute: "observe",
          abstained: true,
        },
        {
          ungatedRoute: "investigate",
          predictedRoute: "investigate",
          goldRoute: "investigate",
          abstained: false,
        },
      ]),
    ).toEqual({
      regularCaseCount: 2,
      proposedObserveCount: 1,
      acceptedObserveCount: 0,
      falseObserveCount: 0,
      autoObserveRate: 0,
      observeAcceptanceRate: 0,
      falseObserveRisk: null,
      abstainedObserveCount: 1,
      reviewRate: 1,
    });
    expect(() =>
      financeObserveGateMetrics([
        {
          ungatedRoute: "observe",
          predictedRoute: "observe",
          goldRoute: "observe",
          abstained: true,
        },
      ]),
    ).toThrow(/inconsistent/u);
  });

  it("binds a frozen policy to dataset, pack, model, semantics, and digest", () => {
    const policy = fitFinanceObserveGate(
      [calibration("a", 0.8, "observe")],
      "financial_text_triage",
      "jev_advisory",
      0,
      1,
    );
    const artifact = createFinanceObserveGatePolicyArtifact(policy, {
      datasetDigest: hash,
      packId: "finance-surveillance",
      packVersion: "0.2.0",
      questionSetHash: hash,
      track: "financial_text_triage",
      architecture: "jev_advisory",
      components: [
        {
          role: "jev",
          providerId: "typesafe",
          modelId: "jev",
          modelVersion: "jev-1.13.0",
          responseModel: "typesafe-ai/jev",
          probabilitySemantics: "native_calibrated",
        },
      ],
    });
    expect(Object.isFrozen(artifact)).toBe(true);
    expect(() =>
      validateFinanceObserveGatePolicyArtifact(artifact),
    ).not.toThrow();
    const tampered = structuredClone(artifact) as unknown as {
      binding: { components: Array<{ modelVersion: string }> };
    };
    const tamperedComponent = tampered.binding.components[0];
    if (tamperedComponent === undefined)
      throw new Error("fixture omitted component");
    tamperedComponent.modelVersion = "jev-latest";
    expect(() =>
      validateFinanceObserveGatePolicyArtifact(
        tampered as unknown as typeof artifact,
      ),
    ).toThrow(/digest/u);
    const legacy = structuredClone(artifact) as unknown as {
      policy: { schemaVersion: string };
    };
    legacy.policy.schemaVersion = "2";
    expect(() =>
      validateFinanceObserveGatePolicyArtifact(
        legacy as unknown as typeof artifact,
      ),
    ).toThrow(/identity/u);
    const component = artifact.binding.components[0];
    if (component === undefined) throw new Error("fixture omitted component");
    expect(() =>
      createFinanceObserveGatePolicyArtifact(policy, {
        ...artifact.binding,
        components: [
          {
            ...component,
            probabilitySemantics: "fabricated",
          },
        ],
      } as unknown as typeof artifact.binding),
    ).toThrow(/model binding/u);
  });

  it("aligns final gold routes to atomic targets and reports per-candidate metrics", () => {
    const evidence = ledger("jev");
    const gold = evidence.questions.map((question) => ({
      questionId: question.questionId,
      label: question.selected,
      candidateId: question.candidateId,
      evidenceHash: question.evidenceHash,
    }));
    expect(() =>
      assertFinanceGoldRouteAlignment(
        "observe",
        gold,
        evidence.candidateBindings,
      ),
    ).not.toThrow();
    expect(() =>
      assertFinanceGoldRouteAlignment(
        "escalate",
        gold,
        evidence.candidateBindings,
      ),
    ).toThrow(/aligned/u);
    const forgedBindings = structuredClone(evidence.candidateBindings);
    const forgedBinding = forgedBindings[0];
    if (forgedBinding === undefined)
      throw new Error("fixture omitted candidate binding");
    const forgedGold = structuredClone(gold);
    const forgedClaim = forgedGold.find(
      ({ candidateId }) => candidateId === "item_1",
    );
    if (forgedClaim === undefined)
      throw new Error("fixture omitted claim gold");
    Object.assign(forgedBinding, {
      claimQuestionId: "finance-text-claim:other",
    });
    Object.assign(forgedClaim, { questionId: "finance-text-claim:other" });
    expect(() =>
      assertFinanceGoldRouteAlignment("observe", forgedGold, forgedBindings),
    ).toThrow(/claim binding/u);
    const metrics = financeAtomicMetrics([
      { caseId: "case-1", ledger: evidence, gold },
    ]);
    const claimMetrics = metrics.find(({ family }) => family === "claim");
    expect(claimMetrics).toMatchObject({
      sampleCount: 1,
      caseCount: 1,
      accuracy: 1,
    });
    expect(claimMetrics?.categoricalBrier).toBeCloseTo(0.0044, 12);
  });

  it("rejects test leakage, non-exact options, and hostile ledgers", () => {
    expect(() =>
      fitFinanceObserveGate(
        [
          {
            ...calibration("a", 0.8, "observe"),
            split: "test",
          } as unknown as FinanceObserveCalibrationCase,
        ],
        "financial_text_triage",
        "jev_advisory",
        0,
        1,
      ),
    ).toThrow(/calibration rows only/u);
    const extra = structuredClone(ledger("jev")) as unknown as MutableLedger;
    const route = extra.questions[0];
    if (route === undefined) throw new Error("fixture omitted route question");
    route.probabilities.other = 0;
    expect(() => financeObserveSupport(extra)).toThrow(/fields are not exact/u);
    const hostile = new Proxy(ledger("jev"), {});
    expect(() => financeObserveSupport(hostile)).toThrow(/plain object/u);
    expect(() =>
      fitFinanceObserveGate(
        [],
        "other" as unknown as "financial_text_triage",
        "jev_advisory",
        0,
        1,
      ),
    ).toThrow(/valid finance track/u);
    expect(() =>
      fitFinanceObserveGate(
        [],
        "financial_text_triage",
        "other" as unknown as "jev_advisory",
        0,
        1,
      ),
    ).toThrow(/valid finance architecture/u);
    const policy = fitFinanceObserveGate(
      [calibration("valid", 0.8, "observe")],
      "financial_text_triage",
      "jev_advisory",
      0,
      1,
    );
    expect(() =>
      applyFinanceObserveGate("other" as unknown as "observe", 0.8, policy),
    ).toThrow(/valid finance route/u);
  });
});

function choice(
  questionId: string,
  probabilities: Record<string, number>,
  candidateId: string | null = null,
) {
  const selected = Object.entries(probabilities).sort(
    (left, right) => right[1] - left[1],
  )[0]?.[0];
  if (selected === undefined)
    throw new Error("choice fixture requires probabilities");
  return {
    questionId,
    selected,
    probabilities,
    candidateId,
    evidenceHash: candidateId === null ? null : hash,
  };
}

function calibration(
  caseId: string,
  observeSupportScore: number,
  goldRoute: "observe" | "investigate" | "escalate",
): FinanceObserveCalibrationCase {
  return {
    caseId,
    groupId: `group-${caseId}`,
    track: "financial_text_triage",
    architecture: "jev_advisory",
    split: "calibration",
    predictedRoute: "observe",
    goldRoute,
    observeSupportScore,
  };
}

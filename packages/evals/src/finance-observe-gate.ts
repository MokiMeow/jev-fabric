import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";
import {
  financeArchitectures,
  financeRoutes,
  financeTracks,
} from "./finance.js";
import type {
  FinanceArchitecture,
  FinanceRoute,
  FinanceTrack,
} from "./finance.js";
import { categoricalBrier, topLabelEce } from "./metrics.js";
import { stableJson } from "./manifest.js";

export const financeObserveGatePolicyId = "finance.observe-gate.v1" as const;
export const financeObserveGateFormulaId =
  "minimum-required-observe-support.v1" as const;

export const financeAtomicBaseQuestions = {
  "finance-route": "observe",
  "finance-anomaly": "routine",
  "finance-evidence-quality": "sufficient",
  "finance-untrusted-influence": "absent",
} as const;

export const financeClaimQuestionPrefix = "finance-text-claim:" as const;
export const financeCitedClaimQuestionPrefix =
  "finance-text-claim-cited:" as const;
export const financeCitationQuestionPrefix = "finance-text-citation:" as const;

const financeRouteSet = new Set<string>(financeRoutes);
const financeTrackSet = new Set<string>(financeTracks);
const financeArchitectureSet = new Set<string>(financeArchitectures);
const probabilitySemanticsSet = new Set<string>([
  "native_calibrated",
  "normalized_logits",
  "self_reported",
  "synthetic",
  "unknown",
]);

export interface FinanceAtomicChoiceEvidence {
  readonly questionId: string;
  readonly selected: string;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly candidateId: string | null;
  readonly evidenceHash: string | null;
}

export interface FinanceAtomicEvidenceLedger {
  readonly role: "host" | "jev";
  readonly questionSetHash: string;
  readonly candidateBindings: readonly FinanceAtomicCandidateBinding[];
  readonly questions: readonly FinanceAtomicChoiceEvidence[];
}

export interface FinanceAtomicCandidateBinding {
  readonly candidateId: string;
  readonly evidenceHash: string;
  readonly claimQuestionId:
    | `${typeof financeClaimQuestionPrefix}${string}`
    | `${typeof financeCitedClaimQuestionPrefix}${string}`;
  readonly citationQuestionId:
    | `${typeof financeCitationQuestionPrefix}${string}`
    | null;
}

export interface FinanceAtomicGoldLabel {
  readonly questionId: string;
  readonly label: string;
  readonly candidateId: string | null;
  readonly evidenceHash: string | null;
}

export interface FinanceObserveSupport {
  readonly score: number;
  readonly factorCount: number;
}

export interface FinanceObserveCalibrationCase {
  readonly caseId: string;
  readonly groupId: string;
  readonly track: FinanceTrack;
  readonly architecture: FinanceArchitecture;
  readonly split: "calibration";
  readonly predictedRoute: FinanceRoute;
  readonly goldRoute: FinanceRoute;
  readonly observeSupportScore: number | null;
}

export type FinanceObserveGateUnavailableReason =
  | "deterministic_only"
  | "insufficient_calibration_groups"
  | "no_eligible_observe_cases"
  | "no_threshold_meets_risk_bound";

export type FinanceObserveGatePolicy =
  | {
      readonly schemaVersion: "1";
      readonly policyId: typeof financeObserveGatePolicyId;
      readonly formulaId: typeof financeObserveGateFormulaId;
      readonly track: FinanceTrack;
      readonly architecture: FinanceArchitecture;
      readonly riskSemantics: "empirical_calibration_only";
      readonly maxObservedFalseObserveRisk: number;
      readonly minimumCalibrationGroups: number;
      readonly status: "CALIBRATED";
      readonly threshold: number;
      readonly calibrationCaseCount: number;
      readonly calibrationGroupCount: number;
      readonly eligibleObserveCount: number;
      readonly acceptedObserveCount: number;
      readonly falseObserveCount: number;
      readonly observedFalseObserveRisk: number;
    }
  | {
      readonly schemaVersion: "1";
      readonly policyId: typeof financeObserveGatePolicyId;
      readonly formulaId: typeof financeObserveGateFormulaId;
      readonly track: FinanceTrack;
      readonly architecture: FinanceArchitecture;
      readonly riskSemantics: "empirical_calibration_only";
      readonly maxObservedFalseObserveRisk: number;
      readonly minimumCalibrationGroups: number;
      readonly status: "UNAVAILABLE";
      readonly reason: FinanceObserveGateUnavailableReason;
      readonly threshold: null;
      readonly calibrationCaseCount: number;
      readonly calibrationGroupCount: number;
      readonly eligibleObserveCount: number;
      readonly acceptedObserveCount: 0;
      readonly falseObserveCount: 0;
      readonly observedFalseObserveRisk: null;
    };

export interface FinanceObserveGateDecision {
  readonly route: FinanceRoute;
  readonly abstained: boolean;
  readonly reason: "below_threshold" | "policy_unavailable" | null;
}

export interface FinanceObserveGateMetrics {
  readonly regularCaseCount: number;
  readonly proposedObserveCount: number;
  readonly acceptedObserveCount: number;
  readonly falseObserveCount: number;
  readonly autoObserveRate: number | null;
  readonly observeAcceptanceRate: number | null;
  readonly falseObserveRisk: number | null;
  readonly abstainedObserveCount: number;
  readonly reviewRate: number | null;
}

export interface FinanceObserveGatePolicyBinding {
  readonly datasetDigest: string;
  readonly packId: string;
  readonly packVersion: string;
  readonly questionSetHash: string;
  readonly track: FinanceTrack;
  readonly architecture: FinanceArchitecture;
  readonly components: readonly Readonly<{
    role: "host" | "jev";
    providerId: string;
    modelId: string;
    modelVersion: string;
    responseModel: string;
    probabilitySemantics:
      | "native_calibrated"
      | "normalized_logits"
      | "self_reported"
      | "synthetic"
      | "unknown";
  }>[];
}

export interface FinanceObserveGatePolicyArtifact {
  readonly policy: FinanceObserveGatePolicy;
  readonly binding: FinanceObserveGatePolicyBinding;
  readonly policyDigest: string;
}

export interface FinanceAtomicMetricRow {
  readonly family:
    | "route"
    | "anomaly"
    | "evidence_quality"
    | "untrusted_influence"
    | "claim"
    | "citation";
  readonly sampleCount: number;
  readonly caseCount: number;
  readonly accuracy: number;
  readonly macroF1: number;
  readonly categoricalBrier: number;
  readonly topLabelEce: number;
}

/**
 * Produces a conservative selection score for an advisory observe route.
 * The minimum is deliberate: these are mandatory, non-compensating factors.
 * The result is not a probability that the composed route is correct.
 */
export function financeObserveSupport(
  ledger: FinanceAtomicEvidenceLedger,
): FinanceObserveSupport {
  validateLedger(ledger);
  const byId = new Map(
    ledger.questions.map((question) => [question.questionId, question]),
  );
  const factors: number[] = [];
  for (const [questionId, observeLabel] of Object.entries(
    financeAtomicBaseQuestions,
  )) {
    const question = byId.get(questionId);
    if (question === undefined)
      throw new TypeError(`finance atomic ledger omitted ${questionId}`);
    factors.push(requiredProbability(question, observeLabel));
  }

  const claims = ledger.questions.filter(
    (question) => claimPrefix(question.questionId) !== null,
  );
  const citations = ledger.questions.filter((question) =>
    question.questionId.startsWith(financeCitationQuestionPrefix),
  );
  const claimCandidates = new Set<string>();
  const citedClaimCandidates = new Set<string>();
  for (const claim of claims) {
    const prefix = claimPrefix(claim.questionId);
    if (prefix === null) throw new TypeError("finance claim prefix is invalid");
    const candidateId = dynamicCandidateId(claim, prefix);
    if (claimCandidates.has(candidateId))
      throw new TypeError(`duplicate finance claim candidate: ${candidateId}`);
    claimCandidates.add(candidateId);
    if (prefix === financeCitedClaimQuestionPrefix)
      citedClaimCandidates.add(candidateId);
    factors.push(requiredProbability(claim, "none"));
  }
  const citationCandidates = new Set<string>();
  for (const citation of citations) {
    const candidateId = dynamicCandidateId(
      citation,
      financeCitationQuestionPrefix,
    );
    if (!claimCandidates.has(candidateId))
      throw new TypeError(
        `finance citation has no matching claim candidate: ${candidateId}`,
      );
    if (citationCandidates.has(candidateId))
      throw new TypeError(
        `duplicate finance citation candidate: ${candidateId}`,
      );
    citationCandidates.add(candidateId);
    factors.push(requiredProbability(citation, "supports"));
  }
  for (const candidateId of citedClaimCandidates)
    if (!citationCandidates.has(candidateId))
      throw new TypeError(
        `finance cited claim omitted its citation question: ${candidateId}`,
      );
  return Object.freeze({
    score: Math.min(...factors),
    factorCount: factors.length,
  });
}

/** Derives the least-permissive semantic route selected by atomic evidence. */
export function financeAtomicEvidenceRoute(
  ledgers: readonly FinanceAtomicEvidenceLedger[],
): FinanceRoute | null {
  assertPlainArray(ledgers, "finance atomic ledgers");
  if (ledgers.length === 0) return null;
  let route: FinanceRoute = "observe";
  for (const ledger of ledgers) {
    validateLedger(ledger);
    for (const question of ledger.questions) {
      const escalates =
        (question.questionId === "finance-route" &&
          question.selected === "escalate") ||
        (question.questionId === "finance-anomaly" &&
          question.selected === "concerning") ||
        (question.questionId === "finance-evidence-quality" &&
          question.selected === "insufficient") ||
        (question.questionId === "finance-untrusted-influence" &&
          question.selected === "present") ||
        (question.questionId.startsWith(financeCitationQuestionPrefix) &&
          question.selected === "contradicts");
      if (escalates) return "escalate";
      const investigates =
        (question.questionId === "finance-route" &&
          question.selected === "investigate") ||
        (question.questionId === "finance-anomaly" &&
          question.selected === "unclear") ||
        (question.questionId === "finance-evidence-quality" &&
          question.selected === "conflicted") ||
        (claimPrefix(question.questionId) !== null &&
          question.selected !== "none") ||
        (question.questionId.startsWith(financeCitationQuestionPrefix) &&
          question.selected === "insufficient_context");
      if (investigates) route = "investigate";
    }
  }
  return route;
}

export function combineFinanceObserveSupport(
  ledgers: readonly FinanceAtomicEvidenceLedger[],
): FinanceObserveSupport | null {
  assertPlainArray(ledgers, "finance atomic ledgers");
  if (ledgers.length === 0) return null;
  const values = ledgers.map(financeObserveSupport);
  return Object.freeze({
    score: Math.min(...values.map(({ score }) => score)),
    factorCount: values.reduce((sum, { factorCount }) => sum + factorCount, 0),
  });
}

/** Fits a threshold only from the caller-supplied calibration rows and risk budget. */
export function fitFinanceObserveGate(
  rows: readonly FinanceObserveCalibrationCase[],
  track: FinanceTrack,
  architecture: FinanceArchitecture,
  maxObservedFalseObserveRisk: number,
  minimumCalibrationGroups: number,
): FinanceObserveGatePolicy {
  assertPlainArray(rows, "finance observe-gate calibration rows");
  assertFinanceTrack(track, "track");
  assertFinanceArchitecture(architecture, "architecture");
  finiteUnit(maxObservedFalseObserveRisk, "maxObservedFalseObserveRisk");
  if (
    !Number.isSafeInteger(minimumCalibrationGroups) ||
    minimumCalibrationGroups < 1
  )
    throw new TypeError(
      "minimumCalibrationGroups must be a positive safe integer",
    );
  const seen = new Set<string>();
  const groups = new Set<string>();
  const calibration = rows.filter((row) => {
    validateCalibrationCase(row);
    if (row.track !== track || row.architecture !== architecture) return false;
    if (seen.has(row.caseId))
      throw new TypeError(`duplicate finance calibration case: ${row.caseId}`);
    seen.add(row.caseId);
    groups.add(row.groupId);
    return true;
  });
  const base = {
    schemaVersion: "1" as const,
    policyId: financeObserveGatePolicyId,
    formulaId: financeObserveGateFormulaId,
    track,
    architecture,
    riskSemantics: "empirical_calibration_only" as const,
    maxObservedFalseObserveRisk,
    minimumCalibrationGroups,
    calibrationCaseCount: calibration.length,
    calibrationGroupCount: groups.size,
  };
  if (architecture === "deterministic_only")
    return unavailablePolicy(base, "deterministic_only", 0);
  if (groups.size < minimumCalibrationGroups)
    return unavailablePolicy(base, "insufficient_calibration_groups", 0);
  const eligible = calibration.filter(
    (row) =>
      row.predictedRoute === "observe" && row.observeSupportScore !== null,
  );
  if (eligible.length === 0)
    return unavailablePolicy(base, "no_eligible_observe_cases", 0);
  const thresholds = [
    ...new Set(eligible.map((row) => row.observeSupportScore as number)),
  ].sort((left, right) => left - right);
  const candidates = thresholds
    .map((threshold) => {
      const accepted = eligible.filter(
        (row) => (row.observeSupportScore as number) >= threshold,
      );
      const falseObserveCount = accepted.filter(
        (row) => row.goldRoute !== "observe",
      ).length;
      return {
        threshold,
        acceptedObserveCount: accepted.length,
        falseObserveCount,
        observedFalseObserveRisk: falseObserveCount / accepted.length,
      };
    })
    .filter(
      ({ observedFalseObserveRisk }) =>
        observedFalseObserveRisk <= maxObservedFalseObserveRisk,
    )
    .sort(
      (left, right) =>
        right.acceptedObserveCount - left.acceptedObserveCount ||
        left.threshold - right.threshold,
    );
  const selected = candidates[0];
  if (selected === undefined)
    return unavailablePolicy(
      base,
      "no_threshold_meets_risk_bound",
      eligible.length,
    );
  return Object.freeze({
    ...base,
    status: "CALIBRATED",
    threshold: selected.threshold,
    eligibleObserveCount: eligible.length,
    acceptedObserveCount: selected.acceptedObserveCount,
    falseObserveCount: selected.falseObserveCount,
    observedFalseObserveRisk: selected.observedFalseObserveRisk,
  });
}

export function applyFinanceObserveGate(
  predictedRoute: FinanceRoute,
  observeSupportScore: number | null,
  policy: FinanceObserveGatePolicy,
): FinanceObserveGateDecision {
  assertFinanceRoute(predictedRoute, "predictedRoute");
  validatePolicy(policy);
  if (predictedRoute !== "observe")
    return Object.freeze({
      route: predictedRoute,
      abstained: false,
      reason: null,
    });
  if (policy.status !== "CALIBRATED" || observeSupportScore === null)
    return Object.freeze({
      route: "investigate",
      abstained: true,
      reason: "policy_unavailable",
    });
  finiteUnit(observeSupportScore, "observeSupportScore");
  return observeSupportScore >= policy.threshold
    ? Object.freeze({ route: "observe", abstained: false, reason: null })
    : Object.freeze({
        route: "investigate",
        abstained: true,
        reason: "below_threshold",
      });
}

export function financeObserveGateMetrics(
  rows: readonly Readonly<{
    ungatedRoute: FinanceRoute;
    predictedRoute: FinanceRoute;
    goldRoute: FinanceRoute;
    abstained: boolean;
  }>[],
): FinanceObserveGateMetrics {
  assertPlainArray(rows, "finance observe-gate metric rows");
  for (const row of rows) validateGateMetricRow(row);
  const proposed = rows.filter(
    ({ ungatedRoute }) => ungatedRoute === "observe",
  );
  const accepted = proposed.filter(
    ({ predictedRoute, abstained }) =>
      predictedRoute === "observe" && !abstained,
  );
  const falseObserveCount = accepted.filter(
    ({ goldRoute }) => goldRoute !== "observe",
  ).length;
  const abstainedObserveCount = proposed.filter(
    ({ abstained }) => abstained,
  ).length;
  return Object.freeze({
    regularCaseCount: rows.length,
    proposedObserveCount: proposed.length,
    acceptedObserveCount: accepted.length,
    falseObserveCount,
    autoObserveRate: rows.length === 0 ? null : accepted.length / rows.length,
    observeAcceptanceRate:
      proposed.length === 0 ? null : accepted.length / proposed.length,
    falseObserveRisk:
      accepted.length === 0 ? null : falseObserveCount / accepted.length,
    abstainedObserveCount,
    reviewRate:
      rows.length === 0
        ? null
        : rows.filter(({ predictedRoute }) => predictedRoute !== "observe")
            .length / rows.length,
  });
}

export function createFinanceObserveGatePolicyArtifact(
  policy: FinanceObserveGatePolicy,
  binding: FinanceObserveGatePolicyBinding,
): FinanceObserveGatePolicyArtifact {
  validatePolicy(policy);
  validatePolicyBinding(policy, binding);
  const snapshot = structuredClone({ policy, binding });
  const policyDigest = `sha256:${createHash("sha256")
    .update(stableJson(snapshot))
    .digest("hex")}`;
  return deepFreeze({ ...snapshot, policyDigest });
}

export function validateFinanceObserveGatePolicyArtifact(
  artifact: FinanceObserveGatePolicyArtifact,
): void {
  exactObject(
    artifact,
    ["policy", "binding", "policyDigest"],
    "finance observe-gate policy artifact",
  );
  validatePolicy(artifact.policy);
  validatePolicyBinding(artifact.policy, artifact.binding);
  if (!/^sha256:[a-f0-9]{64}$/u.test(artifact.policyDigest))
    throw new TypeError("finance observe-gate policy digest is invalid");
  const expected = createFinanceObserveGatePolicyArtifact(
    artifact.policy,
    artifact.binding,
  ).policyDigest;
  if (artifact.policyDigest !== expected)
    throw new TypeError("finance observe-gate policy digest mismatch");
}

export function composeFinanceGoldRoute(
  gold: readonly FinanceAtomicGoldLabel[],
  candidateBindings: readonly FinanceAtomicCandidateBinding[],
): FinanceRoute {
  validateFinanceAtomicGold(gold, candidateBindings);
  const labels = new Map(gold.map((entry) => [entry.questionId, entry.label]));
  const dynamic = gold.filter(
    ({ questionId }) => dynamicPrefix(questionId) !== null,
  );
  const escalates =
    labels.get("finance-untrusted-influence") === "present" ||
    labels.get("finance-anomaly") === "concerning" ||
    labels.get("finance-evidence-quality") === "insufficient" ||
    labels.get("finance-route") === "escalate" ||
    dynamic.some(
      ({ questionId, label }) =>
        questionId.startsWith(financeCitationQuestionPrefix) &&
        label === "contradicts",
    );
  if (escalates) return "escalate";
  const investigates =
    labels.get("finance-anomaly") === "unclear" ||
    labels.get("finance-evidence-quality") === "conflicted" ||
    labels.get("finance-route") === "investigate" ||
    dynamic.some(({ questionId, label }) =>
      questionId.startsWith(financeCitationQuestionPrefix)
        ? label === "insufficient_context"
        : label !== "none",
    );
  return investigates ? "investigate" : "observe";
}

export function assertFinanceGoldRouteAlignment(
  goldRoute: FinanceRoute,
  gold: readonly FinanceAtomicGoldLabel[],
  candidateBindings: readonly FinanceAtomicCandidateBinding[],
): void {
  assertFinanceRoute(goldRoute, "goldRoute");
  if (composeFinanceGoldRoute(gold, candidateBindings) !== goldRoute)
    throw new TypeError(
      "finance final gold route is not aligned to atomic gold labels",
    );
}

export function financeAtomicMetrics(
  cases: readonly Readonly<{
    caseId: string;
    ledger: FinanceAtomicEvidenceLedger;
    gold: readonly FinanceAtomicGoldLabel[];
  }>[],
): readonly FinanceAtomicMetricRow[] {
  assertPlainArray(cases, "finance atomic metric cases");
  const families = [
    "route",
    "anomaly",
    "evidence_quality",
    "untrusted_influence",
    "claim",
    "citation",
  ] as const;
  const caseIds = new Set<string>();
  const observations = new Map<
    (typeof families)[number],
    Array<{
      caseId: string;
      predicted: string;
      gold: string;
      probabilities: Readonly<Record<string, number>>;
    }>
  >();
  for (const item of cases) {
    exactObject(
      item,
      ["caseId", "ledger", "gold"],
      "finance atomic metric case",
    );
    if (
      typeof item.caseId !== "string" ||
      item.caseId.length === 0 ||
      caseIds.has(item.caseId)
    )
      throw new TypeError(
        `duplicate or empty finance atomic case: ${item.caseId}`,
      );
    caseIds.add(item.caseId);
    validateLedger(item.ledger);
    validateFinanceAtomicGold(item.gold, item.ledger.candidateBindings);
    const gold = new Map(
      item.gold.map((entry) => [entry.questionId, entry.label]),
    );
    for (const question of item.ledger.questions) {
      const family = questionFamily(question.questionId);
      const label = gold.get(question.questionId);
      if (label === undefined)
        throw new TypeError("finance atomic gold coverage is incomplete");
      const rows = observations.get(family) ?? [];
      rows.push({
        caseId: item.caseId,
        predicted: question.selected,
        gold: label,
        probabilities: question.probabilities,
      });
      observations.set(family, rows);
    }
  }
  return families.flatMap((family) => {
    const rows = observations.get(family) ?? [];
    if (rows.length === 0) return [];
    const options = questionOptions(questionIdForFamily(family));
    const categorical = rows.map((row) => ({
      probabilities: row.probabilities,
      gold: row.gold,
    }));
    const brier = categoricalBrier(categorical);
    const ece = topLabelEce(categorical).value;
    if (brier === null || ece === null)
      throw new TypeError("finance atomic metric family cannot be empty");
    return [
      Object.freeze({
        family,
        sampleCount: rows.length,
        caseCount: new Set(rows.map(({ caseId }) => caseId)).size,
        accuracy:
          rows.filter(({ predicted, gold }) => predicted === gold).length /
          rows.length,
        macroF1: stringMacroF1(rows, options),
        categoricalBrier: brier,
        topLabelEce: ece,
      }),
    ];
  });
}

function unavailablePolicy(
  base: Omit<
    Extract<FinanceObserveGatePolicy, { status: "UNAVAILABLE" }>,
    | "status"
    | "reason"
    | "threshold"
    | "eligibleObserveCount"
    | "acceptedObserveCount"
    | "falseObserveCount"
    | "observedFalseObserveRisk"
  >,
  reason: FinanceObserveGateUnavailableReason,
  eligibleObserveCount: number,
): Extract<FinanceObserveGatePolicy, { status: "UNAVAILABLE" }> {
  return Object.freeze({
    ...base,
    status: "UNAVAILABLE",
    reason,
    threshold: null,
    eligibleObserveCount,
    acceptedObserveCount: 0,
    falseObserveCount: 0,
    observedFalseObserveRisk: null,
  });
}

function validateLedger(ledger: FinanceAtomicEvidenceLedger): void {
  exactObject(
    ledger,
    ["role", "questionSetHash", "candidateBindings", "questions"],
    "finance atomic ledger",
  );
  if (ledger.role !== "host" && ledger.role !== "jev")
    throw new TypeError("finance atomic ledger role is invalid");
  if (!/^sha256:[a-f0-9]{64}$/u.test(ledger.questionSetHash))
    throw new TypeError("finance atomic ledger questionSetHash is invalid");
  assertPlainArray(ledger.questions, "finance atomic ledger questions");
  assertPlainArray(
    ledger.candidateBindings,
    "finance atomic candidate bindings",
  );
  const expectedIds = new Set(Object.keys(financeAtomicBaseQuestions));
  for (const questionId of validateCandidateBindings(ledger.candidateBindings))
    expectedIds.add(questionId);
  const ids = new Set<string>();
  for (const question of ledger.questions) {
    if (ids.has(question.questionId))
      throw new TypeError(
        `duplicate finance atomic question: ${question.questionId}`,
      );
    ids.add(question.questionId);
    validateQuestion(question);
  }
  if (
    ids.size !== expectedIds.size ||
    [...expectedIds].some((questionId) => !ids.has(questionId))
  )
    throw new TypeError("finance atomic question coverage is not exact");
  const bindings = new Map(
    ledger.candidateBindings.map((binding) => [binding.candidateId, binding]),
  );
  for (const question of ledger.questions) {
    const prefix = dynamicPrefix(question.questionId);
    if (prefix === null) {
      if (question.candidateId !== null || question.evidenceHash !== null)
        throw new TypeError(
          "finance base question cannot claim candidate evidence",
        );
      continue;
    }
    const candidateId = question.questionId.slice(prefix.length);
    const binding = bindings.get(candidateId);
    if (
      binding === undefined ||
      question.candidateId !== candidateId ||
      question.evidenceHash !== binding.evidenceHash
    )
      throw new TypeError("finance dynamic question binding is invalid");
  }
}

function validateCandidateBindings(
  candidateBindings: readonly FinanceAtomicCandidateBinding[],
): ReadonlySet<string> {
  assertPlainArray(candidateBindings, "finance atomic candidate bindings");
  const candidateIds = new Set<string>();
  const questionIds = new Set<string>();
  for (const binding of candidateBindings) {
    exactObject(
      binding,
      ["candidateId", "evidenceHash", "claimQuestionId", "citationQuestionId"],
      "finance atomic candidate binding",
    );
    if (
      !/^[A-Za-z][A-Za-z0-9._:-]{0,63}$/u.test(binding.candidateId) ||
      candidateIds.has(binding.candidateId)
    )
      throw new TypeError(
        "finance atomic candidate binding identity is invalid",
      );
    candidateIds.add(binding.candidateId);
    if (!/^sha256:[a-f0-9]{64}$/u.test(binding.evidenceHash))
      throw new TypeError("finance atomic candidate evidenceHash is invalid");
    const regularClaim = `${financeClaimQuestionPrefix}${binding.candidateId}`;
    const citedClaim = `${financeCitedClaimQuestionPrefix}${binding.candidateId}`;
    if (
      binding.claimQuestionId !== regularClaim &&
      binding.claimQuestionId !== citedClaim
    )
      throw new TypeError("finance atomic claim binding is invalid");
    const expectedCitation =
      binding.claimQuestionId === citedClaim
        ? `${financeCitationQuestionPrefix}${binding.candidateId}`
        : null;
    if (binding.citationQuestionId !== expectedCitation)
      throw new TypeError("finance atomic citation binding is invalid");
    questionIds.add(binding.claimQuestionId);
    if (binding.citationQuestionId !== null)
      questionIds.add(binding.citationQuestionId);
  }
  return questionIds;
}

function validateQuestion(question: FinanceAtomicChoiceEvidence): void {
  exactObject(
    question,
    ["questionId", "selected", "probabilities", "candidateId", "evidenceHash"],
    "finance atomic question",
  );
  if (
    typeof question.questionId !== "string" ||
    question.questionId.length === 0
  )
    throw new TypeError("finance atomic questionId is required");
  if (typeof question.selected !== "string")
    throw new TypeError("finance atomic selected label is required");
  const probabilities = question.probabilities;
  if (
    !probabilities ||
    typeof probabilities !== "object" ||
    Array.isArray(probabilities)
  )
    throw new TypeError("finance atomic probabilities must be an object");
  const options = questionOptions(question.questionId);
  exactObject(probabilities, options, "finance atomic probabilities");
  const entries = Object.entries(probabilities);
  if (
    entries.length !== options.length ||
    options.some((option) => !Object.hasOwn(probabilities, option)) ||
    !options.includes(question.selected)
  )
    throw new TypeError("finance atomic probabilities are incomplete");
  let sum = 0;
  for (const [label, value] of entries) {
    if (label.length === 0)
      throw new TypeError("finance atomic label is empty");
    finiteUnit(value, "finance atomic probability");
    sum += value;
  }
  if (Math.abs(sum - 1) > 1e-6)
    throw new TypeError("finance atomic probabilities must sum to 1");
  const selectedProbability = probabilities[question.selected] as number;
  if (
    options.some(
      (option) =>
        option !== question.selected &&
        (probabilities[option] as number) >= selectedProbability,
    )
  )
    throw new TypeError(
      "finance atomic selected label must be the unique maximum",
    );
  if (
    question.candidateId !== null &&
    !/^[A-Za-z][A-Za-z0-9._:-]{0,63}$/u.test(question.candidateId)
  )
    throw new TypeError("finance atomic candidateId is invalid");
  if (
    question.evidenceHash !== null &&
    !/^sha256:[a-f0-9]{64}$/u.test(question.evidenceHash)
  )
    throw new TypeError("finance atomic evidenceHash is invalid");
}

function questionOptions(questionId: string): readonly string[] {
  if (questionId === "finance-route")
    return ["observe", "investigate", "escalate"];
  if (questionId === "finance-anomaly")
    return ["routine", "concerning", "unclear"];
  if (questionId === "finance-evidence-quality")
    return ["sufficient", "conflicted", "insufficient"];
  if (questionId === "finance-untrusted-influence")
    return ["absent", "present"];
  if (claimPrefix(questionId) !== null)
    return [
      "performance_change",
      "guidance_or_outlook_change",
      "liquidity_or_going_concern",
      "accounting_or_control_issue",
      "legal_or_regulatory_contingency",
      "none",
      "unclear",
    ];
  if (questionId.startsWith(financeCitationQuestionPrefix))
    return ["supports", "contradicts", "insufficient_context"];
  throw new TypeError(`unknown finance atomic question: ${questionId}`);
}

function dynamicPrefix(questionId: string): string | null {
  return (
    claimPrefix(questionId) ??
    (questionId.startsWith(financeCitationQuestionPrefix)
      ? financeCitationQuestionPrefix
      : null)
  );
}

function dynamicCandidateId(
  question: FinanceAtomicChoiceEvidence,
  prefix: string,
): string {
  const candidateId = question.questionId.slice(prefix.length);
  if (
    !/^[A-Za-z][A-Za-z0-9._:-]{0,63}$/u.test(candidateId) ||
    question.candidateId !== candidateId ||
    question.evidenceHash === null
  )
    throw new TypeError(
      `finance dynamic question binding is invalid: ${question.questionId}`,
    );
  return candidateId;
}

function requiredProbability(
  question: FinanceAtomicChoiceEvidence,
  label: string,
): number {
  const probability = question.probabilities[label];
  if (probability === undefined)
    throw new TypeError(
      `${question.questionId} omitted probability for ${label}`,
    );
  return probability;
}

function validateCalibrationCase(row: FinanceObserveCalibrationCase): void {
  exactObject(
    row,
    [
      "caseId",
      "groupId",
      "track",
      "architecture",
      "split",
      "predictedRoute",
      "goldRoute",
      "observeSupportScore",
    ],
    "finance observe-gate calibration row",
  );
  if (
    typeof row.caseId !== "string" ||
    row.caseId.length === 0 ||
    typeof row.groupId !== "string" ||
    row.groupId.length === 0
  )
    throw new TypeError("finance calibration case identity is required");
  assertFinanceTrack(row.track, "calibration track");
  assertFinanceArchitecture(row.architecture, "calibration architecture");
  assertFinanceRoute(row.predictedRoute, "calibration predictedRoute");
  assertFinanceRoute(row.goldRoute, "calibration goldRoute");
  if (row.split !== "calibration")
    throw new TypeError("finance observe gate accepts calibration rows only");
  if (row.observeSupportScore !== null)
    finiteUnit(row.observeSupportScore, "observeSupportScore");
}

function validateGateMetricRow(
  row: Readonly<{
    ungatedRoute: FinanceRoute;
    predictedRoute: FinanceRoute;
    goldRoute: FinanceRoute;
    abstained: boolean;
  }>,
): void {
  exactObject(
    row,
    ["ungatedRoute", "predictedRoute", "goldRoute", "abstained"],
    "finance observe-gate metric row",
  );
  assertFinanceRoute(row.ungatedRoute, "metric ungatedRoute");
  assertFinanceRoute(row.predictedRoute, "metric predictedRoute");
  assertFinanceRoute(row.goldRoute, "metric goldRoute");
  if (typeof row.abstained !== "boolean")
    throw new TypeError("finance observe-gate abstained must be boolean");
  if (row.ungatedRoute === "observe") {
    if (
      (row.abstained && row.predictedRoute !== "investigate") ||
      (!row.abstained && row.predictedRoute !== "observe")
    )
      throw new TypeError(
        "finance observe-gate metric decision is inconsistent",
      );
  } else if (row.abstained || row.predictedRoute !== row.ungatedRoute) {
    throw new TypeError(
      "finance observe-gate cannot alter an already restrictive route",
    );
  }
}

function validateFinanceAtomicGold(
  gold: readonly FinanceAtomicGoldLabel[],
  candidateBindings: readonly FinanceAtomicCandidateBinding[],
): void {
  assertPlainArray(gold, "finance atomic gold");
  validateCandidateBindings(candidateBindings);
  const expected = new Map<string, FinanceAtomicCandidateBinding | null>(
    Object.keys(financeAtomicBaseQuestions).map((questionId) => [
      questionId,
      null,
    ]),
  );
  for (const binding of candidateBindings) {
    expected.set(binding.claimQuestionId, binding);
    if (binding.citationQuestionId !== null)
      expected.set(binding.citationQuestionId, binding);
  }
  const seen = new Set<string>();
  for (const item of gold) {
    exactObject(
      item,
      ["questionId", "label", "candidateId", "evidenceHash"],
      "finance atomic gold label",
    );
    if (seen.has(item.questionId))
      throw new TypeError(
        `duplicate finance atomic gold question: ${item.questionId}`,
      );
    seen.add(item.questionId);
    const binding = expected.get(item.questionId);
    if (
      binding === undefined ||
      !questionOptions(item.questionId).includes(item.label)
    )
      throw new TypeError("finance atomic gold label is invalid");
    if (
      binding === null
        ? item.candidateId !== null || item.evidenceHash !== null
        : item.candidateId !== binding.candidateId ||
          item.evidenceHash !== binding.evidenceHash
    )
      throw new TypeError("finance atomic gold binding mismatch");
  }
  if (
    seen.size !== expected.size ||
    [...expected.keys()].some((questionId) => !seen.has(questionId))
  )
    throw new TypeError("finance atomic gold coverage is not exact");
}

function validatePolicyBinding(
  policy: FinanceObserveGatePolicy,
  binding: FinanceObserveGatePolicyBinding,
): void {
  exactObject(
    binding,
    [
      "datasetDigest",
      "packId",
      "packVersion",
      "questionSetHash",
      "track",
      "architecture",
      "components",
    ],
    "finance observe-gate policy binding",
  );
  if (
    !/^sha256:[a-f0-9]{64}$/u.test(binding.datasetDigest) ||
    !/^sha256:[a-f0-9]{64}$/u.test(binding.questionSetHash)
  )
    throw new TypeError("finance observe-gate binding hashes are invalid");
  if (
    typeof binding.packId !== "string" ||
    binding.packId.length === 0 ||
    typeof binding.packVersion !== "string" ||
    binding.packVersion.length === 0
  )
    throw new TypeError("finance observe-gate pack identity is required");
  assertFinanceTrack(binding.track, "policy-binding track");
  assertFinanceArchitecture(
    binding.architecture,
    "policy-binding architecture",
  );
  if (
    binding.track !== policy.track ||
    binding.architecture !== policy.architecture
  )
    throw new TypeError("finance observe-gate policy binding cell mismatch");
  assertPlainArray(binding.components, "finance observe-gate components");
  const expectedRoles: Readonly<
    Record<FinanceArchitecture, readonly string[]>
  > = {
    deterministic_only: [],
    host_model_only: ["host"],
    jev_advisory: ["jev"],
    host_plus_jev: ["host", "jev"],
  };
  if (
    binding.components.length !== expectedRoles[binding.architecture].length ||
    binding.components.some((component, index) => {
      exactObject(
        component,
        [
          "role",
          "providerId",
          "modelId",
          "modelVersion",
          "responseModel",
          "probabilitySemantics",
        ],
        "finance observe-gate model component",
      );
      return (
        component.role !== expectedRoles[binding.architecture][index] ||
        [
          component.providerId,
          component.modelId,
          component.modelVersion,
          component.responseModel,
        ].some((value) => typeof value !== "string" || value.length === 0) ||
        !probabilitySemanticsSet.has(component.probabilitySemantics)
      );
    })
  )
    throw new TypeError("finance observe-gate model binding is invalid");
}

function validatePolicy(policy: FinanceObserveGatePolicy): void {
  assertPlainRecord(policy, "finance observe-gate policy");
  const common = [
    "schemaVersion",
    "policyId",
    "formulaId",
    "track",
    "architecture",
    "riskSemantics",
    "maxObservedFalseObserveRisk",
    "minimumCalibrationGroups",
    "status",
    "threshold",
    "calibrationCaseCount",
    "calibrationGroupCount",
    "eligibleObserveCount",
    "acceptedObserveCount",
    "falseObserveCount",
    "observedFalseObserveRisk",
  ];
  exactObject(
    policy,
    policy.status === "UNAVAILABLE" ? [...common, "reason"] : common,
    "finance observe-gate policy",
  );
  if (
    !policy ||
    typeof policy !== "object" ||
    policy.schemaVersion !== "1" ||
    policy.policyId !== financeObserveGatePolicyId ||
    policy.formulaId !== financeObserveGateFormulaId
  )
    throw new TypeError("finance observe-gate policy identity is invalid");
  assertFinanceTrack(policy.track, "policy track");
  assertFinanceArchitecture(policy.architecture, "policy architecture");
  if (policy.riskSemantics !== "empirical_calibration_only")
    throw new TypeError("finance observe-gate risk semantics are invalid");
  finiteUnit(policy.maxObservedFalseObserveRisk, "maxObservedFalseObserveRisk");
  for (const [name, value] of [
    ["minimumCalibrationGroups", policy.minimumCalibrationGroups],
    ["calibrationCaseCount", policy.calibrationCaseCount],
    ["calibrationGroupCount", policy.calibrationGroupCount],
    ["eligibleObserveCount", policy.eligibleObserveCount],
    ["acceptedObserveCount", policy.acceptedObserveCount],
    ["falseObserveCount", policy.falseObserveCount],
  ] as const)
    if (!Number.isSafeInteger(value) || value < 0)
      throw new TypeError(`${name} must be a non-negative safe integer`);
  if (policy.minimumCalibrationGroups < 1)
    throw new TypeError("minimumCalibrationGroups must be positive");
  if (policy.status === "CALIBRATED") {
    finiteUnit(policy.threshold, "finance observe-gate threshold");
    finiteUnit(policy.observedFalseObserveRisk, "observedFalseObserveRisk");
    if (
      policy.acceptedObserveCount < 1 ||
      policy.falseObserveCount > policy.acceptedObserveCount ||
      policy.observedFalseObserveRisk !==
        policy.falseObserveCount / policy.acceptedObserveCount
    )
      throw new TypeError("finance calibrated policy counts are inconsistent");
  } else if (policy.status === "UNAVAILABLE") {
    if (
      ![
        "deterministic_only",
        "insufficient_calibration_groups",
        "no_eligible_observe_cases",
        "no_threshold_meets_risk_bound",
      ].includes(policy.reason)
    )
      throw new TypeError("finance unavailable policy reason is invalid");
    if (
      policy.threshold !== null ||
      policy.acceptedObserveCount !== 0 ||
      policy.falseObserveCount !== 0 ||
      policy.observedFalseObserveRisk !== null
    )
      throw new TypeError(
        "finance unavailable policy cannot claim calibration",
      );
  } else {
    throw new TypeError("finance observe-gate policy status is invalid");
  }
  if (
    policy.calibrationGroupCount > policy.calibrationCaseCount ||
    policy.eligibleObserveCount > policy.calibrationCaseCount ||
    policy.acceptedObserveCount > policy.eligibleObserveCount
  )
    throw new TypeError("finance observe-gate policy counts are inconsistent");
}

function questionFamily(questionId: string): FinanceAtomicMetricRow["family"] {
  if (questionId === "finance-route") return "route";
  if (questionId === "finance-anomaly") return "anomaly";
  if (questionId === "finance-evidence-quality") return "evidence_quality";
  if (questionId === "finance-untrusted-influence")
    return "untrusted_influence";
  if (claimPrefix(questionId) !== null) return "claim";
  if (questionId.startsWith(financeCitationQuestionPrefix)) return "citation";
  throw new TypeError(`unknown finance atomic question: ${questionId}`);
}

function questionIdForFamily(family: FinanceAtomicMetricRow["family"]): string {
  const ids: Readonly<Record<FinanceAtomicMetricRow["family"], string>> = {
    route: "finance-route",
    anomaly: "finance-anomaly",
    evidence_quality: "finance-evidence-quality",
    untrusted_influence: "finance-untrusted-influence",
    claim: `${financeClaimQuestionPrefix}candidate`,
    citation: `${financeCitationQuestionPrefix}candidate`,
  };
  return ids[family];
}

function stringMacroF1(
  rows: readonly Readonly<{ predicted: string; gold: string }>[],
  labels: readonly string[],
): number {
  return (
    labels.reduce((sum, label) => {
      const tp = rows.filter(
        ({ predicted, gold }) => predicted === label && gold === label,
      ).length;
      const fp = rows.filter(
        ({ predicted, gold }) => predicted === label && gold !== label,
      ).length;
      const fn = rows.filter(
        ({ predicted, gold }) => predicted !== label && gold === label,
      ).length;
      const denominator = 2 * tp + fp + fn;
      return sum + (denominator === 0 ? 0 : (2 * tp) / denominator);
    }, 0) / labels.length
  );
}

function exactObject(
  value: unknown,
  keys: readonly string[],
  label: string,
): void {
  assertPlainRecord(value, label);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Object.keys(descriptors).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    throw new TypeError(`${label} fields are not exact`);
}

function assertPlainRecord(value: unknown, label: string): void {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  )
    throw new TypeError(`${label} must be a plain object`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(descriptors).some((key) => typeof key !== "string") ||
    Object.values(descriptors).some(
      (descriptor) => !("value" in descriptor) || !descriptor.enumerable,
    )
  )
    throw new TypeError(`${label} must contain plain enumerable data`);
}

function assertPlainArray(value: unknown, label: string): void {
  if (
    !Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > 4_096
  )
    throw new TypeError(`${label} must be a bounded plain array`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const allowed = new Set(["length"]);
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    allowed.add(key);
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor))
      throw new TypeError(`${label} must contain plain data`);
  }
  if (Reflect.ownKeys(descriptors).some((key) => !allowed.has(String(key))))
    throw new TypeError(`${label} must not contain extra properties`);
}

function assertFinanceRoute(value: unknown, label: string): void {
  if (typeof value !== "string" || !financeRouteSet.has(value))
    throw new TypeError(`${label} is not a valid finance route`);
}

function assertFinanceTrack(value: unknown, label: string): void {
  if (typeof value !== "string" || !financeTrackSet.has(value))
    throw new TypeError(`${label} is not a valid finance track`);
}

function assertFinanceArchitecture(value: unknown, label: string): void {
  if (typeof value !== "string" || !financeArchitectureSet.has(value))
    throw new TypeError(`${label} is not a valid finance architecture`);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

function claimPrefix(questionId: string): string | null {
  if (questionId.startsWith(financeCitedClaimQuestionPrefix))
    return financeCitedClaimQuestionPrefix;
  if (questionId.startsWith(financeClaimQuestionPrefix))
    return financeClaimQuestionPrefix;
  return null;
}

function finiteUnit(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1)
    throw new TypeError(`${name} must be finite and in [0, 1]`);
}

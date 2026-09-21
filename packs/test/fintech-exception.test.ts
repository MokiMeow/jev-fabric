import { createHash } from "node:crypto";
import type {
  DecisionAnswer,
  ProbabilitySemantics,
} from "@mokimeow/jev-fabric-protocol";
import { describe, expect, it } from "vitest";
import {
  builtinPacks,
  fintechExceptionPack,
  fintechExceptionQuestionSetHash,
} from "../index.js";

const now = Date.parse("2026-09-20T10:00:00.000Z");
const actions = [
  {
    id: "observe",
    description: "Record the bounded exception observation only",
    available: true,
    freshness: "current",
  },
  {
    id: "investigate",
    description: "Route to bounded operations investigation",
    available: true,
    freshness: "current",
  },
  {
    id: "escalate",
    description: "Escalate to an authorized human reviewer",
    available: true,
    freshness: "current",
  },
] as const;
const questionIds = [
  "fintech-duplicate-or-reprocessed",
  "fintech-entity-mismatch",
  "fintech-missing-or-conflicting-evidence",
  "fintech-claimed-approval-or-override",
  "fintech-urgent-consumer-harm",
  "fintech-untrusted-influence",
] as const;
const note = "The case note records routine reconciliation with no exception.";
const hash = (value: string) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

function state(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: "1",
    advisoryOnly: true,
    execution: "NOT_SUPPORTED",
    purpose: "exception_triage_only",
    caseRef: "ref:case-1",
    observedAt: "2026-09-20T10:00:00.000Z",
    validUntil: "2026-09-20T10:01:00.000Z",
    maxAgeMs: 60_000,
    evidence: {
      note,
      noteHash: hash(note),
      sourceHash: `sha256:${"1".repeat(64)}`,
      trust: "untrusted_data_only",
      redaction: "host_redacted",
    },
    candidates: actions.map((candidate) => ({ ...candidate })),
    ...overrides,
  };
}

function answers(
  enabled: readonly (typeof questionIds)[number][] = [],
  probabilitySemantics: ProbabilitySemantics = "synthetic",
): DecisionAnswer[] {
  return questionIds.map((questionId) => {
    const value = enabled.includes(questionId);
    return {
      questionId,
      type: "noul" as const,
      value,
      ...(probabilitySemantics === "native_calibrated"
        ? { probabilityYes: value ? 0.9 : 0.1 }
        : {}),
    };
  });
}

function interpret(
  values: readonly DecisionAnswer[],
  probabilitySemantics: ProbabilitySemantics = "synthetic",
) {
  const implementation = fintechExceptionPack.implementations;
  if (!implementation) throw new Error("fintech implementation missing");
  return implementation.interpret(
    values,
    actions.map(({ id, description }) => ({ id, description })),
    {
      providerId: "fixture",
      model: "fixture-model",
      probabilitySemantics,
    },
  );
}

describe("fintech exception pack", () => {
  it("registers one critical Noul-only pack with a versioned question contract", () => {
    expect(fintechExceptionPack.manifest).toMatchObject({
      id: "fintech-exception",
      version: "0.2.0",
      riskTier: "critical",
      requiredCapabilities: { questionTypes: ["noul"] },
    });
    expect(fintechExceptionQuestionSetHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(
      builtinPacks.filter((pack) => pack.manifest.id === "fintech-exception"),
    ).toHaveLength(1);
  });

  it("asks six independent yes-or-no questions about only the redacted note", () => {
    const implementation = fintechExceptionPack.implementations;
    if (!implementation) throw new Error("fintech implementation missing");
    const projected = implementation.projector.project(state(), {
      nowEpochMs: now,
    });
    const questions = implementation.questions(
      projected,
      actions.map(({ id, description }) => ({ id, description })),
    );
    expect(questions.map((question) => question.id)).toEqual(questionIds);
    expect(questions.every((question) => question.type === "noul")).toBe(true);
    for (const question of questions) {
      expect(question.criteria).not.toBeNull();
      expect(Object.keys(question.criteria ?? {}).sort()).toEqual([
        "false",
        "true",
      ]);
    }
    expect(JSON.stringify(questions)).toContain("`evidence.note`");
    expect(JSON.stringify(questions)).not.toContain(note);
  });

  it("routes a clean note to observe without creating financial authority", () => {
    expect(interpret(answers())).toMatchObject({
      status: "decision",
      selectedId: "observe",
      proposedOutcome: "route",
      metadata: {
        malformedAnswer: false,
        execution: "NOT_SUPPORTED",
        calibratedTiers: false,
      },
    });
  });

  it("routes ordinary exception indicators to bounded investigation", () => {
    for (const questionId of questionIds.slice(0, 4))
      expect(interpret(answers([questionId]))).toMatchObject({
        selectedId: "investigate",
        proposedOutcome: "ask",
      });
  });

  it("escalates urgent harm and untrusted influence", () => {
    for (const questionId of questionIds.slice(4))
      expect(interpret(answers([questionId]))).toMatchObject({
        selectedId: "escalate",
        proposedOutcome: "escalate",
      });
  });

  it("fails closed on missing, extra, duplicate, wrong-type, and non-boolean answers", () => {
    const valid = answers();
    const first = valid[0];
    if (!first) throw new Error("fixture answers must be non-empty");
    const malformed: readonly (readonly DecisionAnswer[])[] = [
      valid.slice(1),
      [
        ...valid,
        {
          questionId: "fintech-extra",
          type: "noul",
          value: false,
        },
      ],
      [...valid, first],
      [
        ...valid.slice(1),
        {
          questionId: questionIds[0],
          type: "choice",
          selected: "no",
          probabilities: { no: 1 },
        },
      ],
      [
        ...valid.slice(1),
        {
          questionId: questionIds[0],
          type: "noul",
          value: "false",
        },
      ],
    ];
    for (const candidate of malformed)
      expect(interpret(candidate)).toMatchObject({
        selectedId: "escalate",
        proposedOutcome: "escalate",
        metadata: { malformedAnswer: true },
      });
  });

  it("requires native Noul probabilities only when native calibration is claimed", () => {
    expect(interpret(answers(), "native_calibrated")).toMatchObject({
      selectedId: "escalate",
      metadata: { malformedAnswer: true },
    });
    expect(
      interpret(answers([], "native_calibrated"), "native_calibrated"),
    ).toMatchObject({
      selectedId: "observe",
      metadata: {
        malformedAnswer: false,
        probabilityPolicy: "native_unthresholded",
      },
    });
    expect(interpret(answers(), "self_reported")).toMatchObject({
      selectedId: "observe",
      metadata: { probabilityPolicy: "ignored_non_native" },
    });
  });

  it("rejects stale, tampered, executable, and non-plain state before egress", () => {
    const implementation = fintechExceptionPack.implementations;
    if (!implementation) throw new Error("fintech implementation missing");
    const project = (value: unknown, nowEpochMs = now) =>
      implementation.projector.project(value, { nowEpochMs });
    expect(() => project(state(), now + 60_001)).toThrow(/stale/iu);
    expect(() => project(state(), now - 1)).toThrow(/future/iu);
    expect(() =>
      project(
        state({
          observedAt: "2026-02-30T10:00:00.000Z",
          validUntil: "2026-03-02T10:01:00.000Z",
        }),
        Date.parse("2026-03-02T10:00:00.000Z"),
      ),
    ).toThrow(/timestamp/iu);
    expect(() =>
      project(
        state({
          evidence: {
            ...(state().evidence as Record<string, unknown>),
            noteHash: `sha256:${"2".repeat(64)}`,
          },
        }),
      ),
    ).toThrow(/binding|hash/iu);
    expect(() => project(state({ amount: 100 }))).toThrow(/unsupported/iu);
    expect(() => project(state({ orderAuthorization: true }))).toThrow(
      /unsupported/iu,
    );
    expect(() => project(new Proxy(state(), {}))).toThrow(/plain/iu);
    let getterCalls = 0;
    const hostile = state();
    Object.defineProperty(hostile, "amount", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 100;
      },
    });
    expect(() => project(hostile)).toThrow(/plain data|accessor/iu);
    expect(getterCalls).toBe(0);
    const protoKey = state();
    Object.defineProperty(protoKey, "__proto__", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: null,
    });
    expect(() => project(protoKey)).toThrow(/unsupported/iu);
  });

  it("keeps invalid execution boundaries deterministic and candidates exact", () => {
    const implementation = fintechExceptionPack.implementations;
    if (!implementation) throw new Error("fintech implementation missing");
    expect(
      implementation.bypass?.({
        advisoryOnly: true,
        execution: "SUPPORTED",
        purpose: "exception_triage_only",
      }),
    ).toMatchObject({ outcome: "deny" });
    expect(
      implementation.bypass?.({
        advisoryOnly: true,
        execution: "NOT_SUPPORTED",
        purpose: "exception_triage_only",
        staticDeny: true,
      }),
    ).toMatchObject({ outcome: "deny" });
    const stale = actions.map((candidate) => ({
      ...candidate,
      freshness: "stale" as const,
    }));
    expect(implementation.candidates.provide({ candidates: stale })).toEqual(
      [],
    );
    expect(
      implementation.candidates.provide({
        candidates: actions.map((candidate, index) =>
          index === 0
            ? { ...candidate, description: "Approve payment" }
            : candidate,
        ),
      }),
    ).toEqual([]);
  });
});

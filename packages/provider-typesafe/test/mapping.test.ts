import { describe, expect, it } from "vitest";
import { compileTypeSafeRequest, mapTypeSafeResult } from "../src/mapping.js";
import type { DecisionRequest } from "@mokimeow/jev-fabric-protocol";

const request: DecisionRequest = {
  id: "decision_1",
  state: { ticket: { subject: "Refund request" } },
  questions: [
    {
      id: "route",
      type: "choice",
      instructions: { task: "Choose a route" },
      criteria: { billing: { label: "Billing" }, support: null },
      options: ["billing", "support"],
    },
    {
      id: "urgent",
      type: "noul",
      instructions: ["Is this urgent?"],
      criteria: { true: "Immediate response", false: "Can wait" },
    },
    {
      id: "severity",
      type: "score",
      instructions: { task: "Rate severity" },
      criteria: ["low", { label: "medium" }, "high"],
    },
  ],
};

describe("TypeSafe mapping", () => {
  it("compiles all native primitive shapes without stringifying structured data", () => {
    const compiled = compileTypeSafeRequest(request, "jev-1.13.0");
    expect(compiled).toEqual({
      state: request.state,
      model: "jev-1.13.0",
      questions: {
        route: {
          type: "choice",
          instructions: { task: "Choose a route" },
          criteria: { billing: { label: "Billing" }, support: null },
        },
        urgent: {
          type: "noul",
          instructions: ["Is this urgent?"],
          criteria: { true: "Immediate response", false: "Can wait" },
        },
        severity: {
          type: "score",
          instructions: { task: "Rate severity" },
          criteria: ["low", { label: "medium" }, "high"],
        },
      },
    });
  });

  it("rejects malformed Noul criteria before provider dispatch", () => {
    expect(() =>
      compileTypeSafeRequest(
        {
          id: "malformed-noul",
          state: {},
          questions: [
            {
              id: "urgent",
              type: "noul",
              instructions: "Is this urgent?",
              criteria: { yes: "Urgent", no: "Not urgent" },
            },
          ],
        } as unknown as DecisionRequest,
        "jev-1.13.0",
      ),
    ).toThrow();
  });

  it("enforces native Choice and Score cardinality limits", () => {
    const options = Array.from(
      { length: 256 },
      (_, index) => `option-${index}`,
    );
    expect(() =>
      compileTypeSafeRequest(
        {
          id: "choice-too-wide",
          state: {},
          questions: [
            {
              id: "route",
              type: "choice",
              instructions: "Choose one.",
              options,
              criteria: Object.fromEntries(
                options.map((option) => [option, null]),
              ),
            },
          ],
        },
        "jev-1.13.0",
      ),
    ).toThrow(/at most 255/u);
    expect(() =>
      compileTypeSafeRequest(
        {
          id: "score-too-wide",
          state: {},
          questions: [
            {
              id: "severity",
              type: "score",
              instructions: "Rate severity.",
              criteria: Array.from(
                { length: 11 },
                (_, index) => `level-${index}`,
              ),
            },
          ],
        },
        "jev-1.13.0",
      ),
    ).toThrow(/at most 10/u);
  });

  it("preserves distributions and keeps confidence separate from selected probability", () => {
    const mapped = mapTypeSafeResult(
      request,
      "typesafe",
      {
        model: "jev-1.13.0",
        usage: { input_tokens: 17, output_tokens: 9 },
        answers: {
          route: {
            type: "choice",
            choice: "billing",
            probabilities: { billing: 0.72, support: 0.28 },
            confidence: 0.91,
          },
          urgent: { type: "noul", noul: 0.8 },
          severity: {
            type: "score",
            score: 1.5,
            confidence: 0.62,
            legend: { 0: "low", 1: { label: "medium" }, 2: "high" },
            probabilities: { 0: 0.1, 1: 0.3, 2: 0.6 },
          },
        },
      },
      { requestedModel: "jev-1.13.0", approvedModels: ["jev-1.13.0"] },
    );
    expect(mapped.response).toMatchObject({
      requestId: "decision_1",
      providerId: "typesafe",
      model: "jev-1.13.0",
      probabilitySemantics: "native_calibrated",
      answers: [
        {
          questionId: "route",
          selected: "billing",
          probabilities: { billing: 0.72, support: 0.28 },
          confidence: 0.91,
        },
        { questionId: "urgent", value: true, probabilityYes: 0.8 },
        {
          questionId: "severity",
          score: 0.75,
          confidence: 0.62,
          probabilities: { 0: 0.1, 1: 0.3, 2: 0.6 },
        },
      ],
    });
    expect(mapped.usage).toEqual({
      inputTokens: 17,
      outputTokens: 9,
      totalTokens: 26,
    });
    expect(mapped.response.answers[0]).toMatchObject({ confidence: 0.91 });
    expect(
      (mapped.response.answers[0] as { probabilities: { billing: number } })
        .probabilities.billing,
    ).not.toBe(0.91);
  });

  it("rejects malformed native output instead of renormalizing it", () => {
    expect(() =>
      mapTypeSafeResult(
        request,
        "typesafe",
        {
          model: "jev-1.13.0",
          usage: { input_tokens: 1, output_tokens: 1 },
          answers: {
            route: {
              type: "choice",
              choice: "billing",
              probabilities: { billing: 0.6, support: 0.6 },
              confidence: 0.9,
            },
            urgent: { type: "noul", noul: 0.8 },
            severity: {
              type: "score",
              score: 1,
              confidence: 0.5,
              legend: { 0: "low", 1: "mid", 2: "high" },
              probabilities: { 0: 0.1, 1: 0.3, 2: 0.6 },
            },
          },
        },
        { requestedModel: "jev-1.13.0", approvedModels: ["jev-1.13.0"] },
      ),
    ).toThrow();
  });

  it("refuses calibrated semantics unless requested and returned models are approved", () => {
    const result = {
      model: "not-jev",
      usage: { input_tokens: 1, output_tokens: 1 },
      answers: {
        route: {
          type: "choice",
          choice: "billing",
          probabilities: { billing: 0.7, support: 0.3 },
          confidence: 0.8,
        },
        urgent: { type: "noul", noul: 0.8 },
        severity: {
          type: "score",
          score: 1.5,
          confidence: 0.5,
          legend: {},
          probabilities: { 0: 0.1, 1: 0.3, 2: 0.6 },
        },
      },
    };
    expect(() =>
      mapTypeSafeResult(request, "typesafe", result, {
        requestedModel: "jev-1.13.0",
        approvedModels: ["jev-1.13.0"],
      }),
    ).toThrow();
  });

  it("requires an exact plain own-data answer record before mapping native semantics", () => {
    const base = {
      route: {
        type: "choice",
        choice: "billing",
        probabilities: { billing: 0.7, support: 0.3 },
        confidence: 0.8,
      },
      urgent: { type: "noul", noul: 0.8 },
      severity: {
        type: "score",
        score: 1.5,
        confidence: 0.5,
        legend: { 0: "low", 1: "mid", 2: "high" },
        probabilities: { 0: 0.1, 1: 0.3, 2: 0.6 },
      },
    };
    const map = (answers: unknown) =>
      mapTypeSafeResult(
        request,
        "typesafe",
        {
          model: "jev-1.13.0",
          usage: { input_tokens: 1, output_tokens: 1 },
          answers: answers as Record<string, unknown>,
        },
        { requestedModel: "jev-1.13.0", approvedModels: ["jev-1.13.0"] },
      );
    expect(() => map({ ...base, unknown: base.route })).toThrow();
    expect(() => map({ ...base, [Symbol("unknown")]: base.route })).toThrow();
    const { severity: _missing, ...missing } = base;
    expect(() => map(missing)).toThrow();
    expect(() => map(Object.create(base))).toThrow();
    const accessor = { ...base };
    Object.defineProperty(accessor, "route", {
      enumerable: true,
      get: () => base.route,
    });
    expect(() => map(accessor)).toThrow();
    const duplicateQuestion = request.questions[0];
    if (!duplicateQuestion) throw new Error("test request requires a question");
    const duplicateQuestionRequest = {
      ...request,
      questions: [...request.questions, duplicateQuestion],
    };
    expect(() =>
      mapTypeSafeResult(
        duplicateQuestionRequest,
        "typesafe",
        {
          model: "jev-1.13.0",
          usage: { input_tokens: 1, output_tokens: 1 },
          answers: base,
        },
        { requestedModel: "jev-1.13.0", approvedModels: ["jev-1.13.0"] },
      ),
    ).toThrow();
  });
});

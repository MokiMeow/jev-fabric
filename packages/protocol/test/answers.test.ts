import { describe, expect, it } from "vitest";
import {
  decisionResponseSchema,
  validateDecisionResponse,
} from "../src/index.js";

const request = {
  id: "request-1",
  state: { operation: "delete" },
  questions: [
    {
      id: "route-primary",
      type: "choice",
      instructions: "Choose.",
      criteria: {},
      options: ["allow", "ask", "deny"],
    },
  ],
} as const;

const responseWithProbability = (probability: number) => ({
  requestId: "request-1",
  providerId: "test-provider",
  model: "test-model",
  probabilitySemantics: "self_reported",
  answers: [
    {
      questionId: "route-primary",
      type: "choice",
      selected: "allow",
      probabilities: { allow: probability, ask: 0, deny: 1 - probability },
      confidence: 0.73,
    },
  ],
});

describe("decision answers", () => {
  it("rejects non-finite and out-of-range probabilities", () => {
    expect(() =>
      decisionResponseSchema.parse(responseWithProbability(Number.NaN)),
    ).toThrow();
    expect(() =>
      decisionResponseSchema.parse(responseWithProbability(1.01)),
    ).toThrow();
  });

  it("requires the selected option to be an argmax and exact option membership", () => {
    expect(() =>
      validateDecisionResponse(request, {
        ...responseWithProbability(0.2),
        answers: [
          {
            ...responseWithProbability(0.2).answers[0],
            selected: "ask",
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      validateDecisionResponse(request, {
        ...responseWithProbability(0.8),
        answers: [
          {
            ...responseWithProbability(0.8).answers[0],
            probabilities: { allow: 0.8, ask: 0, deny: 0.1, forged: 0.1 },
          },
        ],
      }),
    ).toThrow();
  });

  it("keeps confidence distinct from selected-class probability", () => {
    const response = decisionResponseSchema.parse(responseWithProbability(0.8));
    expect(response.answers[0]).toMatchObject({
      confidence: 0.73,
      probabilities: { allow: 0.8 },
    });
  });

  it("preserves and strictly validates native Noul and Score distributions", () => {
    const nativeRequest = {
      id: "native-1",
      state: null,
      questions: [
        {
          id: "present",
          type: "noul",
          instructions: "present?",
          criteria: null,
        },
        {
          id: "severity",
          type: "score",
          instructions: "severity",
          criteria: ["low", "high"],
        },
      ],
    } as const;
    const nativeResponse = {
      requestId: "native-1",
      providerId: "native",
      model: "jev-1.13.0",
      probabilitySemantics: "native_calibrated" as const,
      answers: [
        {
          questionId: "present",
          type: "noul" as const,
          value: true,
          probabilityYes: 0.8,
        },
        {
          questionId: "severity",
          type: "score" as const,
          score: 0.7,
          probabilities: { 0: 0.3, 1: 0.7 },
        },
      ],
    };
    expect(validateDecisionResponse(nativeRequest, nativeResponse)).toEqual(
      nativeResponse,
    );
    expect(() =>
      validateDecisionResponse(nativeRequest, {
        ...nativeResponse,
        answers: [
          { ...nativeResponse.answers[0], probabilityYes: 0.2 },
          nativeResponse.answers[1],
        ],
      }),
    ).toThrow();
    expect(() =>
      validateDecisionResponse(nativeRequest, {
        ...nativeResponse,
        answers: [
          nativeResponse.answers[0],
          { ...nativeResponse.answers[1], probabilities: { 0: 0.4, 1: 0.4 } },
        ],
      }),
    ).toThrow();
  });
});

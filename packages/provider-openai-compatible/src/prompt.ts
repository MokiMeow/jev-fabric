import type {
  DecisionQuestion,
  DecisionRequest,
} from "@mokimeow/jev-fabric-protocol";

export function buildCompatiblePrompt(
  request: DecisionRequest,
  repair: boolean,
): string {
  return JSON.stringify({
    role: "You are a bounded decision service.",
    instruction: repair
      ? "Return a corrected JSON object only. Do not use markdown or prose."
      : "Return one JSON object only. Do not use markdown or prose.",
    requiredShape: {
      answers: ["one answer for every question, in request order"],
    },
    answerContracts: {
      choice: {
        questionId: "exact request question id",
        type: "choice",
        selected: "exactly one option id",
        probabilities:
          "object containing every option id exactly once; numeric values are 0..1, sum to 1, and selected is an argmax",
        confidence: "optional number from 0 through 1",
      },
      noul: {
        questionId: "exact request question id",
        type: "noul",
        value: "JSON value answering the question",
        confidence: "optional number from 0 through 1",
        probabilityYes:
          "optional number from 0 through 1, only with a boolean value whose argmax it matches",
      },
      score: {
        questionId: "exact request question id",
        type: "score",
        score: "number from 0 through 1",
        confidence: "optional number from 0 through 1",
      },
    },
    state: request.state,
    questions: request.questions,
  });
}

/** OpenAI-compatible strict JSON Schema response format, still revalidated locally. */
export function buildCompatibleResponseFormat(
  request: DecisionRequest,
  probabilityMode: "continuous" | "one_hot" = "continuous",
) {
  const answerSchemas = request.questions.map((question) =>
    answerSchema(question, probabilityMode),
  );
  return {
    type: "json_schema",
    json_schema: {
      name: "jev_fabric_decision",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["answers"],
        properties: {
          answers: {
            type: "object",
            additionalProperties: false,
            required: request.questions.map((question) => question.id),
            properties: Object.fromEntries(
              request.questions.map((question, index) => [
                question.id,
                answerSchemas[index],
              ]),
            ),
          },
        },
      },
    },
  } as const;
}

function answerSchema(
  question: DecisionQuestion,
  probabilityMode: "continuous" | "one_hot",
): Record<string, unknown> {
  const common = {
    type: "object",
    additionalProperties: false,
  } as const;
  if (question.type === "choice") {
    if (probabilityMode === "one_hot")
      return {
        oneOf: question.options.map((selected) => ({
          ...common,
          required: ["questionId", "type", "selected", "probabilities"],
          properties: {
            questionId: { const: question.id },
            type: { const: "choice" },
            selected: { const: selected },
            probabilities: {
              type: "object",
              additionalProperties: false,
              required: question.options,
              properties: Object.fromEntries(
                question.options.map((option) => [
                  option,
                  { const: option === selected ? 1 : 0 },
                ]),
              ),
            },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
        })),
      };
    return {
      ...common,
      required: ["questionId", "type", "selected", "probabilities"],
      properties: {
        questionId: { const: question.id },
        type: { const: "choice" },
        selected: { enum: question.options },
        probabilities: {
          type: "object",
          additionalProperties: false,
          required: question.options,
          properties: Object.fromEntries(
            question.options.map((option) => [
              option,
              { type: "number", minimum: 0, maximum: 1 },
            ]),
          ),
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
    };
  }
  if (question.type === "noul") {
    return {
      ...common,
      required: ["questionId", "type", "value"],
      properties: {
        questionId: { const: question.id },
        type: { const: "noul" },
        value: {},
        confidence: { type: "number", minimum: 0, maximum: 1 },
        probabilityYes: { type: "number", minimum: 0, maximum: 1 },
      },
    };
  }
  return {
    ...common,
    required: ["questionId", "type", "score"],
    properties: {
      questionId: { const: question.id },
      type: { const: "score" },
      score: { type: "number", minimum: 0, maximum: 1 },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
  };
}

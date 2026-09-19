import { z } from "zod";
import { jsonValueSchema, portableIdentifierSchema } from "./json.js";
import { decisionQuestionSchema, type DecisionQuestion } from "./questions.js";

export const probabilitySemanticsSchema = z.enum([
  "native_calibrated",
  "normalized_logits",
  "self_reported",
  "synthetic",
  "unknown",
]);

export type ProbabilitySemantics = z.infer<typeof probabilitySemanticsSchema>;

const probabilitySchema = z.number().finite().min(0).max(1);

export const probabilityDistributionSchema = z
  .record(portableIdentifierSchema, probabilitySchema)
  .refine(
    (distribution) => Object.keys(distribution).length > 0,
    "must contain at least one probability",
  )
  .superRefine((distribution, context) => {
    const sum = Object.values(distribution).reduce(
      (total, probability) => total + probability,
      0,
    );
    if (Math.abs(sum - 1) > 0.000001) {
      context.addIssue({
        code: "custom",
        message: "probabilities must sum to 1 within 1e-6",
      });
    }
  });

export interface ChoiceDecisionAnswer {
  readonly questionId: string;
  readonly type: "choice";
  readonly selected: string;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly confidence?: number | undefined;
}

export interface NoulDecisionAnswer {
  readonly questionId: string;
  readonly type: "noul";
  readonly value: import("./json.js").JsonValue;
  readonly confidence?: number | undefined;
  /** Native probability that the answer is yes; optional for generic providers. */
  readonly probabilityYes?: number | undefined;
}

export interface ScoreDecisionAnswer {
  readonly questionId: string;
  readonly type: "score";
  readonly score: number;
  readonly confidence?: number | undefined;
  /** Native probability for every zero-based score level. */
  readonly probabilities?: Readonly<Record<string, number>> | undefined;
}

export type DecisionAnswer =
  | ChoiceDecisionAnswer
  | NoulDecisionAnswer
  | ScoreDecisionAnswer;

const confidenceSchema = z.number().finite().min(0).max(1).optional();
const scoreProbabilityDistributionSchema = z
  .record(z.string().regex(/^(0|[1-9]\d*)$/), probabilitySchema)
  .refine((distribution) => Object.keys(distribution).length > 0)
  .superRefine((distribution, context) => {
    const sum = Object.values(distribution).reduce(
      (total, probability) => total + probability,
      0,
    );
    if (Math.abs(sum - 1) > 0.000001)
      context.addIssue({
        code: "custom",
        message: "probabilities must sum to 1 within 1e-6",
      });
  });

export const choiceDecisionAnswerSchema = z
  .object({
    questionId: portableIdentifierSchema,
    type: z.literal("choice"),
    selected: portableIdentifierSchema,
    probabilities: probabilityDistributionSchema,
    confidence: confidenceSchema,
  })
  .strict();

export const noulDecisionAnswerSchema = z
  .object({
    questionId: portableIdentifierSchema,
    type: z.literal("noul"),
    value: jsonValueSchema,
    confidence: confidenceSchema,
    probabilityYes: probabilitySchema.optional(),
  })
  .strict();

export const scoreDecisionAnswerSchema = z
  .object({
    questionId: portableIdentifierSchema,
    type: z.literal("score"),
    score: z.number().finite().min(0).max(1),
    confidence: confidenceSchema,
    probabilities: scoreProbabilityDistributionSchema.optional(),
  })
  .strict();

export const decisionAnswerSchema = z.discriminatedUnion("type", [
  choiceDecisionAnswerSchema,
  noulDecisionAnswerSchema,
  scoreDecisionAnswerSchema,
]);

export interface DecisionRequest {
  readonly id: string;
  readonly state: import("./json.js").JsonValue;
  readonly questions: readonly DecisionQuestion[];
}

export const decisionRequestSchema = z
  .object({
    id: portableIdentifierSchema,
    state: jsonValueSchema,
    questions: z
      .array(decisionQuestionSchema)
      .min(1)
      .superRefine((questions, context) => {
        const ids = questions.map((question) => question.id);
        if (new Set(ids).size !== ids.length) {
          context.addIssue({
            code: "custom",
            message: "question ids must be unique",
          });
        }
      }),
  })
  .strict();

export interface DecisionResponse {
  readonly requestId: string;
  readonly providerId: string;
  readonly model: string;
  readonly probabilitySemantics: ProbabilitySemantics;
  readonly answers: readonly DecisionAnswer[];
}

export const decisionResponseSchema = z
  .object({
    requestId: portableIdentifierSchema,
    providerId: portableIdentifierSchema,
    model: z.string().min(1),
    probabilitySemantics: probabilitySemanticsSchema,
    answers: z
      .array(decisionAnswerSchema)
      .min(1)
      .superRefine((answers, context) => {
        const ids = answers.map((answer) => answer.questionId);
        if (new Set(ids).size !== ids.length) {
          context.addIssue({
            code: "custom",
            message: "answer question ids must be unique",
          });
        }
      }),
  })
  .strict();

export function validateDecisionResponse(
  inputRequest: DecisionRequest,
  inputResponse: DecisionResponse,
): DecisionResponse {
  const request = decisionRequestSchema.parse(inputRequest) as DecisionRequest;
  const response = decisionResponseSchema.parse(
    inputResponse,
  ) as DecisionResponse;

  if (response.requestId !== request.id) {
    throw new z.ZodError([
      {
        code: "custom",
        message: "response requestId does not match request",
        path: ["requestId"],
      },
    ]);
  }

  const questionsById = new Map(
    request.questions.map((question) => [question.id, question]),
  );
  if (response.answers.length !== request.questions.length) {
    throw new z.ZodError([
      {
        code: "custom",
        message: "response must answer every request question",
        path: ["answers"],
      },
    ]);
  }

  for (const answer of response.answers) {
    const question = questionsById.get(answer.questionId);
    if (!question) {
      throw new z.ZodError([
        {
          code: "custom",
          message: "answer has an unknown question id",
          path: ["answers", answer.questionId],
        },
      ]);
    }
    if (answer.type !== question.type) {
      throw new z.ZodError([
        {
          code: "custom",
          message: "answer type does not match question type",
          path: ["answers", answer.questionId, "type"],
        },
      ]);
    }
    if (question.type === "choice" && answer.type === "choice") {
      const expected = new Set(question.options);
      const actual = Object.keys(answer.probabilities);
      if (
        actual.length !== expected.size ||
        actual.some((option) => !expected.has(option))
      ) {
        throw new z.ZodError([
          {
            code: "custom",
            message: "choice probabilities must match options exactly",
            path: ["answers", answer.questionId, "probabilities"],
          },
        ]);
      }
      if (!expected.has(answer.selected)) {
        throw new z.ZodError([
          {
            code: "custom",
            message: "selected option must be a request option",
            path: ["answers", answer.questionId, "selected"],
          },
        ]);
      }
      const selectedProbability = answer.probabilities[answer.selected];
      const maximumProbability = Math.max(
        ...Object.values(answer.probabilities),
      );
      if (
        selectedProbability === undefined ||
        selectedProbability !== maximumProbability
      ) {
        throw new z.ZodError([
          {
            code: "custom",
            message: "selected option must be an argmax",
            path: ["answers", answer.questionId, "selected"],
          },
        ]);
      }
    }
    if (
      question.type === "noul" &&
      answer.type === "noul" &&
      answer.probabilityYes !== undefined
    ) {
      if (
        typeof answer.value !== "boolean" ||
        answer.value !== answer.probabilityYes >= 0.5
      )
        throw new z.ZodError([
          {
            code: "custom",
            message: "Noul value must be the probability argmax",
            path: ["answers", answer.questionId, "value"],
          },
        ]);
    }
    if (
      question.type === "score" &&
      answer.type === "score" &&
      answer.probabilities !== undefined
    ) {
      const probabilities = answer.probabilities;
      const keys = Array.from(
        { length: question.criteria.length },
        (_, index) => String(index),
      );
      const actual = Object.keys(probabilities);
      if (
        actual.length !== keys.length ||
        keys.some((key) => !(key in probabilities))
      )
        throw new z.ZodError([
          {
            code: "custom",
            message: "score probabilities must match score criteria exactly",
            path: ["answers", answer.questionId, "probabilities"],
          },
        ]);
      const expected =
        keys.reduce(
          (total, key, index) => total + index * (probabilities[key] ?? 0),
          0,
        ) /
        (question.criteria.length - 1);
      if (Math.abs(expected - answer.score) > 0.000001)
        throw new z.ZodError([
          {
            code: "custom",
            message: "score must match its probability distribution",
            path: ["answers", answer.questionId, "score"],
          },
        ]);
    }
  }

  return response;
}

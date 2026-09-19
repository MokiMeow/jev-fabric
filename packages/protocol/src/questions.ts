import { z } from "zod";
import { jsonValueSchema, portableIdentifierSchema } from "./json.js";

export interface ChoiceQuestion {
  readonly id: string;
  readonly type: "choice";
  readonly instructions: import("./json.js").JsonValue;
  readonly criteria: Readonly<
    Record<string, import("./json.js").JsonValue | null>
  >;
  readonly options: readonly string[];
}

export interface NoulQuestion {
  readonly id: string;
  readonly type: "noul";
  readonly instructions: import("./json.js").JsonValue;
  readonly criteria: import("./json.js").JsonValue;
}

export interface ScoreQuestion {
  readonly id: string;
  readonly type: "score";
  readonly instructions: import("./json.js").JsonValue;
  readonly criteria: readonly import("./json.js").JsonValue[];
}

export type DecisionQuestion = ChoiceQuestion | NoulQuestion | ScoreQuestion;

const choiceOptionsSchema = z
  .array(portableIdentifierSchema)
  .min(2)
  .superRefine((options, context) => {
    if (new Set(options).size !== options.length) {
      context.addIssue({
        code: "custom",
        message: "choice options must be unique",
      });
    }
  });

export const choiceQuestionSchema = z
  .object({
    id: portableIdentifierSchema,
    type: z.literal("choice"),
    instructions: jsonValueSchema,
    criteria: z.record(z.string(), jsonValueSchema.nullable()),
    options: choiceOptionsSchema,
  })
  .strict();

export const noulQuestionSchema = z
  .object({
    id: portableIdentifierSchema,
    type: z.literal("noul"),
    instructions: jsonValueSchema,
    criteria: jsonValueSchema,
  })
  .strict();

export const scoreQuestionSchema = z
  .object({
    id: portableIdentifierSchema,
    type: z.literal("score"),
    instructions: jsonValueSchema,
    criteria: z.array(jsonValueSchema).min(1),
  })
  .strict();

export const decisionQuestionSchema = z.discriminatedUnion("type", [
  choiceQuestionSchema,
  noulQuestionSchema,
  scoreQuestionSchema,
]);

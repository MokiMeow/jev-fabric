import { z } from "zod";
import {
  decisionAnswerSchema,
  probabilitySemanticsSchema,
  type DecisionAnswer,
  type ProbabilitySemantics,
} from "./answers.js";
import { portableIdentifierSchema } from "./json.js";

export const policyOutcomeSchema = z.enum([
  "allow",
  "deny",
  "ask",
  "route",
  "retry",
  "escalate",
  "abstain",
  "unavailable",
]);

export type PolicyOutcome = z.infer<typeof policyOutcomeSchema>;

const tokenCountSchema = z.number().int().safe().nonnegative();

export interface DecisionUsage {
  readonly inputTokens?: number | undefined;
  readonly outputTokens?: number | undefined;
  readonly totalTokens?: number | undefined;
}

export const decisionUsageSchema = z
  .object({
    inputTokens: tokenCountSchema.optional(),
    outputTokens: tokenCountSchema.optional(),
    totalTokens: tokenCountSchema.optional(),
  })
  .strict()
  .refine(
    (usage) => Object.keys(usage).length > 0,
    "usage must contain at least one known measurement",
  )
  .superRefine((usage, context) => {
    if (
      usage.inputTokens !== undefined &&
      usage.outputTokens !== undefined &&
      usage.totalTokens !== undefined &&
      usage.totalTokens !== usage.inputTokens + usage.outputTokens
    ) {
      context.addIssue({
        code: "custom",
        path: ["totalTokens"],
        message: "totalTokens must equal inputTokens plus outputTokens",
      });
    }
  });

export interface DecisionCost {
  readonly currency: string;
  readonly amountMicros: string;
}

export const decisionCostSchema = z
  .object({
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, "must be an ISO 4217 currency code"),
    amountMicros: z
      .string()
      .regex(/^(0|[1-9]\d*)$/, "must be a non-negative integer decimal string"),
  })
  .strict();

export interface DecisionReceipt {
  readonly schemaVersion: string;
  readonly decisionId: string;
  readonly stateHash: string;
  readonly scopeHash: string;
  readonly packVersion: string;
  readonly policyVersion: string;
  readonly providerId: string;
  readonly model: string;
  readonly probabilitySemantics: ProbabilitySemantics;
  readonly answers: readonly DecisionAnswer[];
  readonly outcome: PolicyOutcome;
  readonly reasonCodes: readonly string[];
  readonly cache: "hit" | "miss" | "bypass";
  readonly fallback: "none" | "used" | "unavailable";
  /** Persistence failed after validation; the judgment is still usable. */
  readonly cacheWrite?: "failed" | undefined;
  /** A live stage ended before it produced a semantic provider result. */
  readonly termination?: "cancelled" | "deadline" | undefined;
  readonly latencyMs: number;
  readonly usage?: DecisionUsage | undefined;
  readonly cost?: DecisionCost | undefined;
  readonly redacted: boolean;
}

export const decisionReceiptSchema = z
  .object({
    schemaVersion: z.string().min(1),
    decisionId: portableIdentifierSchema,
    stateHash: z.string().min(1),
    scopeHash: z.string().min(1),
    packVersion: z.string().min(1),
    policyVersion: z.string().min(1),
    providerId: portableIdentifierSchema,
    model: z.string().min(1),
    probabilitySemantics: probabilitySemanticsSchema,
    answers: z.array(decisionAnswerSchema),
    outcome: policyOutcomeSchema,
    reasonCodes: z.array(z.string().min(1)),
    cache: z.enum(["hit", "miss", "bypass"]),
    fallback: z.enum(["none", "used", "unavailable"]),
    cacheWrite: z.enum(["failed"]).optional(),
    termination: z.enum(["cancelled", "deadline"]).optional(),
    latencyMs: z.number().finite().min(0),
    usage: decisionUsageSchema.optional(),
    cost: decisionCostSchema.optional(),
    redacted: z.boolean(),
  })
  .strict();

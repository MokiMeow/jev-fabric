import { z } from "zod";
import {
  decisionResponseSchema,
  probabilitySemanticsSchema,
  type DecisionRequest,
  type DecisionResponse,
  type ProbabilitySemantics,
} from "./answers.js";

export interface ProviderCapabilities {
  readonly questionTypes: readonly ("choice" | "noul" | "score")[];
  readonly probabilitySemantics: readonly ProbabilitySemantics[];
  readonly maxQuestions: number;
}

export const providerCapabilitiesSchema: z.ZodType<ProviderCapabilities> = z
  .object({
    questionTypes: z.array(z.enum(["choice", "noul", "score"])).min(1),
    probabilitySemantics: z.array(probabilitySemanticsSchema).min(1),
    maxQuestions: z.number().int().positive(),
  })
  .strict();

export interface EvaluateOptions {
  readonly signal?: AbortSignal;
  readonly deadlineMs?: number;
}

export interface DecisionProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  evaluate(
    request: DecisionRequest,
    options?: EvaluateOptions,
  ): Promise<DecisionResponse>;
}

export { decisionResponseSchema };

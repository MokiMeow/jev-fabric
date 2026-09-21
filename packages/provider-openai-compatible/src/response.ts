import {
  type DecisionRequest,
  type DecisionResponse,
  type DecisionUsage,
  decisionAnswerSchema,
  validateDecisionResponse,
} from "@mokimeow/jev-fabric-protocol";
import { z } from "zod";

const answerEnvelope = z
  .object({ answers: z.array(decisionAnswerSchema).min(1) })
  .strict();

/** Parses only the exact model answer envelope; markdown/prose cannot pass. */
export function parseCompatibleAnswers(
  request: DecisionRequest,
  providerId: string,
  model: string,
  content: string,
): DecisionResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new TypeError("compatible provider returned invalid JSON");
  }
  const normalized = normalizeIndexedAnswers(request, parsed);
  const envelope = answerEnvelope.safeParse(normalized);
  if (!envelope.success)
    throw new TypeError(
      "compatible provider returned an invalid answer envelope",
    );
  try {
    return validateDecisionResponse(request, {
      requestId: request.id,
      providerId,
      model,
      probabilitySemantics: "self_reported",
      answers: envelope.data.answers,
    });
  } catch {
    throw new TypeError("compatible provider answer violated the request");
  }
}

function normalizeIndexedAnswers(
  request: DecisionRequest,
  parsed: unknown,
): unknown {
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length !== 1 ||
    !("answers" in parsed)
  )
    return parsed;
  const answers = (parsed as { readonly answers?: unknown }).answers;
  if (!answers || typeof answers !== "object" || Array.isArray(answers))
    return parsed;
  const expected = request.questions.map((question) => question.id);
  const actual = Object.keys(answers);
  if (
    actual.length !== expected.length ||
    actual.some((questionId) => !expected.includes(questionId))
  )
    return parsed;
  return {
    answers: expected.map(
      (questionId) =>
        (answers as Readonly<Record<string, unknown>>)[questionId],
    ),
  };
}

export interface CompatibleResponseEnvelope {
  readonly content: string;
  /** Exact model identifier reported by the upstream response. */
  readonly model: string;
  readonly usage?: DecisionUsage;
}

/** Extracts the single answer plus optional provider-reported token usage. */
export function extractCompatibleResponse(
  body: string,
): CompatibleResponseEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new TypeError("compatible endpoint returned invalid JSON");
  }
  const value = z
    .object({
      model: z.string().min(1),
      choices: z
        .array(
          z
            .object({
              message: z.object({ content: z.string() }).passthrough(),
            })
            .passthrough(),
        )
        .length(1),
      usage: z
        .object({
          prompt_tokens: z.number().int().safe().nonnegative().optional(),
          completion_tokens: z.number().int().safe().nonnegative().optional(),
          total_tokens: z.number().int().safe().nonnegative().optional(),
        })
        .passthrough()
        .refine(
          (usage) =>
            usage.prompt_tokens !== undefined ||
            usage.completion_tokens !== undefined ||
            usage.total_tokens !== undefined,
          "usage must contain at least one token measurement",
        )
        .optional(),
    })
    .passthrough()
    .safeParse(parsed);
  if (!value.success)
    throw new TypeError("compatible endpoint returned an invalid envelope");
  const content =
    value.data.choices[0]?.message.content ??
    (() => {
      throw new TypeError("compatible endpoint omitted content");
    })();
  const usage = mapCompatibleUsage(value.data.usage);
  return {
    content,
    model: value.data.model,
    ...(usage === undefined ? {} : { usage }),
  };
}

/** Backwards-compatible content-only extractor. */
export function extractCompatibleContent(body: string): string {
  return extractCompatibleResponse(body).content;
}

function mapCompatibleUsage(
  usage:
    | {
        readonly prompt_tokens?: number | undefined;
        readonly completion_tokens?: number | undefined;
        readonly total_tokens?: number | undefined;
      }
    | undefined,
): DecisionUsage | undefined {
  if (usage === undefined) return undefined;
  if (
    usage.prompt_tokens !== undefined &&
    usage.completion_tokens !== undefined &&
    usage.total_tokens !== undefined &&
    usage.total_tokens !== usage.prompt_tokens + usage.completion_tokens
  )
    throw new TypeError(
      "compatible endpoint token usage total does not match components",
    );
  return {
    ...(usage.prompt_tokens === undefined
      ? {}
      : { inputTokens: usage.prompt_tokens }),
    ...(usage.completion_tokens === undefined
      ? {}
      : { outputTokens: usage.completion_tokens }),
    ...(usage.total_tokens === undefined
      ? {}
      : { totalTokens: usage.total_tokens }),
  };
}

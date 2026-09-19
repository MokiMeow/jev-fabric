import { z } from "zod";
import {
  decisionAnswerSchema,
  validateDecisionResponse,
  type DecisionRequest,
  type DecisionResponse,
} from "@mokimeow/jev-fabric-protocol";

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
  const envelope = answerEnvelope.parse(parsed);
  return validateDecisionResponse(request, {
    requestId: request.id,
    providerId,
    model,
    probabilitySemantics: "self_reported",
    answers: envelope.answers,
  });
}

export function extractCompatibleContent(body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new TypeError("compatible endpoint returned invalid JSON");
  }
  const value = z
    .object({
      choices: z
        .array(
          z
            .object({ message: z.object({ content: z.string() }).strict() })
            .strict(),
        )
        .length(1),
    })
    .passthrough()
    .parse(parsed);
  return (
    value.choices[0]?.message.content ??
    (() => {
      throw new TypeError("compatible endpoint omitted content");
    })()
  );
}

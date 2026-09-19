import type { DecisionRequest } from "@mokimeow/jev-fabric-protocol";

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
      answers: [
        { questionId: "request question id", type: "choice|noul|score" },
      ],
    },
    state: request.state,
    questions: request.questions,
  });
}

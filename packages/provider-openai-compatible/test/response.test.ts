import { describe, expect, it } from "vitest";
import { parseCompatibleAnswers } from "../src/response.js";
import type { DecisionRequest } from "@mokimeow/jev-fabric-protocol";

const request: DecisionRequest = {
  id: "request_1",
  state: { subject: "refund" },
  questions: [
    {
      id: "route",
      type: "choice",
      instructions: "route",
      criteria: { billing: "billing", other: "other" },
      options: ["billing", "other"],
    },
  ],
};

describe("strict compatible response parsing", () => {
  it("accepts only an exact JSON answer envelope and always supplies self_reported semantics", () => {
    expect(
      parseCompatibleAnswers(
        request,
        "compatible",
        "gpt-compatible",
        '{"answers":[{"questionId":"route","type":"choice","selected":"billing","probabilities":{"billing":0.7,"other":0.3}}]}',
      ),
    ).toEqual({
      requestId: "request_1",
      providerId: "compatible",
      model: "gpt-compatible",
      probabilitySemantics: "self_reported",
      answers: [
        {
          questionId: "route",
          type: "choice",
          selected: "billing",
          probabilities: { billing: 0.7, other: 0.3 },
        },
      ],
    });
  });

  it("rejects fences, unknown fields, native claims, unknown ids, and invalid distributions", () => {
    const rejected = [
      '```json\n{"answers":[]}\n```',
      '{"answers":[],"probabilitySemantics":"native_calibrated"}',
      '{"answers":[{"questionId":"unknown","type":"choice","selected":"billing","probabilities":{"billing":0.7,"other":0.3}}]}',
      '{"answers":[{"questionId":"route","type":"choice","selected":"billing","probabilities":{"billing":0.8,"other":0.8}}]}',
    ];
    for (const content of rejected)
      expect(() =>
        parseCompatibleAnswers(request, "compatible", "model", content),
      ).toThrow();
  });
});

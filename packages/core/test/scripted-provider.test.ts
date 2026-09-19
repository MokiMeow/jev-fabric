import { describe, expect, it } from "vitest";
import { ScriptedProvider } from "../src/index.js";
import type {
  DecisionRequest,
  DecisionResponse,
} from "@mokimeow/jev-fabric-protocol";

const request: DecisionRequest = {
  id: "d1",
  state: null,
  questions: [{ id: "q1", type: "noul", instructions: "yes?", criteria: null }],
};
const response = (value: boolean): DecisionResponse => ({
  requestId: "d1",
  providerId: "scripted",
  model: "offline",
  probabilitySemantics: "synthetic",
  answers: [{ questionId: "q1", type: "noul", value }],
});

describe("ScriptedProvider", () => {
  it("replays deterministic responses and reports one offline attempt per evaluation", async () => {
    const attempts: unknown[] = [];
    const provider = new ScriptedProvider({
      id: "scripted",
      model: "offline",
      steps: [response(true), response(false)],
      onAttempt: (attempt) => attempts.push(attempt),
    });
    await expect(provider.evaluate(request)).resolves.toEqual(response(true));
    await expect(provider.evaluate(request)).resolves.toEqual(response(false));
    expect(attempts).toHaveLength(2);
  });

  it("supports deterministic scripted errors, abortable delays, and never calls network", async () => {
    const provider = new ScriptedProvider({
      id: "scripted",
      model: "offline",
      steps: [
        { error: new Error("planned failure") },
        { response: response(true), delayMs: 1000 },
      ],
      sleep: async (_ms, signal) => {
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        );
      },
    });
    await expect(provider.evaluate(request)).rejects.toThrow("planned failure");
    const controller = new AbortController();
    const pending = provider.evaluate(request, { signal: controller.signal });
    controller.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
  });

  it("accepts answer-only fixtures but rejects spoofed response identities", async () => {
    const provider = new ScriptedProvider({
      id: "scripted",
      model: "offline",
      steps: [
        { answers: response(true).answers },
        { ...response(false), providerId: "spoofed" },
      ],
    });
    await expect(provider.evaluate(request)).resolves.toEqual(response(true));
    await expect(provider.evaluate(request)).rejects.toThrow("identity");
  });
});

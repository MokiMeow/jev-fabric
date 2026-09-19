import {
  validateDecisionResponse,
  type DecisionProvider,
  type DecisionRequest,
  type DecisionResponse,
  type EvaluateOptions,
  type ProviderCapabilities,
} from "@mokimeow/jev-fabric-protocol";

export interface ScriptedProviderAttempt {
  readonly requestId: string;
  readonly attempt: number;
  readonly outcome: "succeeded" | "failed" | "cancelled";
}
/** Answer-only scripts intentionally have no provider identity to spoof. */
export interface ScriptedResponsePayload {
  readonly answers: DecisionResponse["answers"];
  readonly probabilitySemantics?: DecisionResponse["probabilitySemantics"];
}
export type ScriptedProviderStep =
  | DecisionResponse
  | ScriptedResponsePayload
  | {
      readonly response: DecisionResponse | ScriptedResponsePayload;
      readonly delayMs?: number;
    }
  | { readonly error: Error; readonly delayMs?: number };
export interface ScriptedProviderOptions {
  readonly id: string;
  readonly model: string;
  readonly steps: readonly ScriptedProviderStep[];
  readonly onAttempt?: (attempt: ScriptedProviderAttempt) => void;
  readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

/** Deterministic, offline provider for tests, examples, and replay. */
export class ScriptedProvider implements DecisionProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities = {
    questionTypes: ["choice", "noul", "score"],
    probabilitySemantics: ["synthetic"],
    maxQuestions: 100,
  };
  readonly #model: string;
  readonly #steps: readonly ScriptedProviderStep[];
  readonly #onAttempt: ((attempt: ScriptedProviderAttempt) => void) | undefined;
  readonly #sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  #cursor = 0;
  constructor(options: ScriptedProviderOptions) {
    if (!options.id || !options.model)
      throw new RangeError("scripted provider id and model are required");
    this.id = options.id;
    this.#model = options.model;
    this.#steps = options.steps;
    this.#onAttempt = options.onAttempt;
    this.#sleep = options.sleep ?? sleep;
  }
  async evaluate(
    request: DecisionRequest,
    options?: EvaluateOptions,
  ): Promise<DecisionResponse> {
    if (
      options?.deadlineMs !== undefined &&
      (!Number.isFinite(options.deadlineMs) || options.deadlineMs < 0)
    )
      throw new RangeError("scripted provider deadline must be non-negative");
    const attempt = this.#cursor + 1;
    const step = this.#steps[this.#cursor++];
    if (!step) {
      this.#onAttempt?.({ requestId: request.id, attempt, outcome: "failed" });
      throw new Error("scripted provider has no remaining step");
    }
    const controller = new AbortController();
    const abort = () => controller.abort(options?.signal?.reason);
    if (options?.signal?.aborted) abort();
    else options?.signal?.addEventListener("abort", abort, { once: true });
    const timer =
      options?.deadlineMs === undefined
        ? undefined
        : setTimeout(
            () => controller.abort(new Error("decision deadline exceeded")),
            options.deadlineMs,
          );
    try {
      const delay = "delayMs" in step ? step.delayMs : undefined;
      if (delay !== undefined) await this.#sleep(delay, controller.signal);
      if (controller.signal.aborted) throw aborted(controller.signal);
      if ("error" in step) throw step.error;
      const response = "response" in step ? step.response : step;
      const normalized = isFullResponse(response)
        ? response
        : {
            requestId: request.id,
            providerId: this.id,
            model: this.#model,
            probabilitySemantics: response.probabilitySemantics ?? "synthetic",
            answers: response.answers,
          };
      if (
        normalized.requestId !== request.id ||
        normalized.providerId !== this.id ||
        normalized.model !== this.#model
      )
        throw new Error(
          "scripted response identity does not match request/provider",
        );
      const validated = validateDecisionResponse(request, normalized);
      this.#onAttempt?.({
        requestId: request.id,
        attempt,
        outcome: "succeeded",
      });
      return validated;
    } catch (error) {
      this.#onAttempt?.({
        requestId: request.id,
        attempt,
        outcome: controller.signal.aborted ? "cancelled" : "failed",
      });
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      options?.signal?.removeEventListener("abort", abort);
    }
  }
}
function isFullResponse(
  value: ScriptedResponsePayload | DecisionResponse,
): value is DecisionResponse {
  return "requestId" in value;
}
function aborted(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("scripted provider cancelled");
}
function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(aborted(signal));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    const cancel = () => {
      clearTimeout(timer);
      reject(aborted(signal));
    };
    function done() {
      signal.removeEventListener("abort", cancel);
      resolve();
    }
    signal.addEventListener("abort", cancel, { once: true });
  });
}

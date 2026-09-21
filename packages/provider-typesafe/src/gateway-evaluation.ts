import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  decisionRequestSchema,
  validateDecisionResponse,
  type DecisionAnswer,
  type DecisionProvider,
  type DecisionRequest,
  type DecisionResponse,
  type DecisionUsage,
  type EvaluateOptions,
  type ProviderCapabilities,
} from "@mokimeow/jev-fabric-protocol";
import { TypeSafeProviderError } from "./errors.js";
import {
  VERCEL_GATEWAY_JEV_MODEL,
  VERCEL_GATEWAY_JEV_PROVIDER_ID,
} from "./gateway-client.js";
import { compileTypeSafeRequest } from "./mapping.js";
import { pinnedTypeSafeFetch } from "./transport.js";

export const VERCEL_GATEWAY_EVALUATION_URL =
  "https://ai-gateway.vercel.sh/v1/evaluate" as const;
export const VERCEL_GATEWAY_EVALUATION_PROVIDER_ID =
  `${VERCEL_GATEWAY_JEV_PROVIDER_ID}-evaluate` as const;

const GATEWAY_PROVIDER = "typesafe-ai" as const;
const MAX_REQUEST_BYTES = 1_000_000;
const MAX_RESPONSE_BYTES = 1_000_000;
// AI Gateway documents Score values rounded independently from their displayed
// rung probabilities (for example 2.97 versus a 2.98 expectation). Preserve
// Fabric's exact score/distribution invariant by treating the distribution as
// canonical, while still rejecting disagreement beyond that documented
// hundredth-point presentation gap.
const SCORE_PRESENTATION_TOLERANCE = 0.0100001;
const MAX_GENERATION_ID_BYTES = 1_024;
const GENERATION_ID_HASH_DOMAIN =
  "jev-fabric/vercel-gateway-generation-id/v1\u0000";

type GatewayFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface VercelGatewayEvaluationJevProviderOptions {
  /** Resolved by trusted server startup; never read from ambient state. */
  readonly apiKey: string;
}

export interface VercelGatewayEvaluationRoute {
  readonly originalModelId: typeof VERCEL_GATEWAY_JEV_MODEL;
  readonly canonicalSlug: typeof VERCEL_GATEWAY_JEV_MODEL;
  readonly resolvedProvider: typeof GATEWAY_PROVIDER;
  readonly finalProvider: typeof GATEWAY_PROVIDER;
}

export interface VercelGatewayEvaluationMappedResult {
  readonly response: DecisionResponse;
  readonly usage: DecisionUsage;
  /** Provider-reported route, validated against the pinned request identity. */
  readonly route: VercelGatewayEvaluationRoute;
  /** Domain-separated digest only; the raw Gateway generation ID is discarded. */
  readonly providerRequestIdHash?: `sha256:${string}`;
}

export interface VercelGatewayEvaluationJevProvider extends DecisionProvider {
  evaluateWithMetadata(
    request: DecisionRequest,
    options?: EvaluateOptions,
  ): Promise<VercelGatewayEvaluationMappedResult>;
}

/**
 * Creates the fixed AI Gateway Evaluation integration. The request always asks
 * for ZDR, no prompt training, and the TypeSafe-only provider allowlist. These
 * are requested controls, not evidence that an account is entitled to them.
 */
export function createVercelGatewayEvaluationJevProvider(
  options: VercelGatewayEvaluationJevProviderOptions,
): VercelGatewayEvaluationJevProvider {
  return createPinnedVercelGatewayEvaluationJevProvider(options.apiKey);
}

/** Internal wire-test seam; absent from the package root export. */
export function createPinnedVercelGatewayEvaluationJevProvider(
  apiKey: string,
  endpoint = VERCEL_GATEWAY_EVALUATION_URL,
  fetchImplementation: GatewayFetch = pinnedTypeSafeFetch,
): VercelGatewayEvaluationJevProvider {
  return new PinnedGatewayEvaluationProvider(
    apiKey,
    endpoint,
    fetchImplementation,
  );
}

class PinnedGatewayEvaluationProvider
  implements VercelGatewayEvaluationJevProvider
{
  readonly capabilities: ProviderCapabilities = {
    questionTypes: ["choice", "noul", "score"],
    probabilitySemantics: ["native_calibrated"],
    maxQuestions: 100,
  };
  readonly id = VERCEL_GATEWAY_EVALUATION_PROVIDER_ID;
  readonly #apiKey: string;
  readonly #endpoint: string;
  readonly #fetch: GatewayFetch;

  constructor(
    apiKey: string,
    endpoint: string,
    fetchImplementation: GatewayFetch,
  ) {
    if (
      !apiKey ||
      Buffer.byteLength(apiKey, "utf8") > 4_096 ||
      hasControlCharacter(apiKey) ||
      !endpoint
    )
      throw new TypeSafeProviderError("configuration", false);
    this.#apiKey = apiKey;
    this.#endpoint = endpoint;
    this.#fetch = fetchImplementation;
  }

  async evaluate(
    request: DecisionRequest,
    options?: EvaluateOptions,
  ): Promise<DecisionResponse> {
    return (await this.evaluateWithMetadata(request, options)).response;
  }

  async evaluateWithMetadata(
    request: DecisionRequest,
    options?: EvaluateOptions,
  ): Promise<VercelGatewayEvaluationMappedResult> {
    if (
      options?.deadlineMs !== undefined &&
      (!Number.isFinite(options.deadlineMs) || options.deadlineMs <= 0)
    )
      throw new TypeSafeProviderError("configuration", false);

    let body: string;
    try {
      body = JSON.stringify(compileGatewayEvaluationRequest(request));
      if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES)
        throw new RangeError("Gateway evaluation request is too large");
    } catch {
      throw new TypeSafeProviderError("invalid_request", false);
    }

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(options?.signal?.reason);
    if (options?.signal?.aborted) abortFromCaller();
    else
      options?.signal?.addEventListener("abort", abortFromCaller, {
        once: true,
      });
    let timedOut = false;
    const timer =
      options?.deadlineMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            controller.abort(new Error("deadline"));
          }, options.deadlineMs);
    let responseReceived = false;
    try {
      const response = await this.#fetch(this.#endpoint, {
        method: "POST",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          accept: "application/json",
          "content-type": "application/json",
        },
        body,
      });
      responseReceived = true;
      if (!response.ok) throw responseError(response);
      if (
        response.headers.get("content-type")?.toLowerCase().split(";", 1)[0] !==
        "application/json"
      )
        throw new TypeError("Gateway evaluation response is not JSON");
      const parsed = await readBoundedJson(response, MAX_RESPONSE_BYTES);
      return mapGatewayEvaluationResult(request, parsed);
    } catch (error) {
      if (error instanceof TypeSafeProviderError) throw error;
      if (options?.signal?.aborted)
        throw new TypeSafeProviderError("cancelled", false);
      if (timedOut) throw new TypeSafeProviderError("timeout", true);
      throw new TypeSafeProviderError(
        responseReceived ? "invalid_response" : "network",
        !responseReceived,
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      options?.signal?.removeEventListener("abort", abortFromCaller);
    }
  }
}

function compileGatewayEvaluationRequest(request: DecisionRequest): unknown {
  const compiled = compileTypeSafeRequest(request, VERCEL_GATEWAY_JEV_MODEL);
  const questions: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const [id, question] of Object.entries(compiled.questions))
    questions[id] =
      question.type === "noul" ? { ...question, type: "boolean" } : question;
  return {
    model: VERCEL_GATEWAY_JEV_MODEL,
    state: compiled.state,
    questions,
    providerOptions: {
      gateway: {
        zeroDataRetention: true,
        disallowPromptTraining: true,
        only: [GATEWAY_PROVIDER],
      },
    },
  };
}

function mapGatewayEvaluationResult(
  inputRequest: DecisionRequest,
  value: unknown,
): VercelGatewayEvaluationMappedResult {
  const request = decisionRequestSchema.parse(inputRequest) as DecisionRequest;
  const root = plainRecord(value, "Gateway evaluation result");
  exactKeys(root, ["answers", "model", "providerMetadata", "usage"], "result");
  if (root.model !== VERCEL_GATEWAY_JEV_MODEL)
    throw new TypeError("Gateway evaluation model drift");
  const answersRecord = exactAnswerRecord(root.answers, request);
  const providerMetadata = plainRecord(
    root.providerMetadata,
    "provider metadata",
  );
  const gateway = plainRecord(providerMetadata.gateway, "Gateway metadata");
  const routeRecord = plainRecord(gateway.routing, "Gateway routing metadata");
  const route: VercelGatewayEvaluationRoute = {
    originalModelId: exactString(
      routeRecord.originalModelId,
      VERCEL_GATEWAY_JEV_MODEL,
      "original model",
    ),
    canonicalSlug: exactString(
      routeRecord.canonicalSlug,
      VERCEL_GATEWAY_JEV_MODEL,
      "canonical model",
    ),
    resolvedProvider: exactString(
      routeRecord.resolvedProvider,
      GATEWAY_PROVIDER,
      "resolved provider",
    ),
    finalProvider: exactString(
      routeRecord.finalProvider,
      GATEWAY_PROVIDER,
      "final provider",
    ),
  };
  const confidence = confidenceRecord(providerMetadata.typesafe, request);
  const answers: DecisionAnswer[] = request.questions.map((question) => {
    const answer = plainRecord(
      answersRecord[question.id],
      `answer ${question.id}`,
    );
    if (question.type === "choice") {
      exactKeys(answer, ["choice", "probabilities", "type"], "choice answer");
      if (answer.type !== "choice") throw new TypeError("answer type drift");
      return {
        questionId: question.id,
        type: "choice",
        selected: nonemptyString(answer.choice, "choice"),
        probabilities: numericRecord(answer.probabilities, "probabilities"),
        ...(confidence[question.id] === undefined
          ? {}
          : { confidence: confidence[question.id] }),
      };
    }
    if (question.type === "noul") {
      exactKeys(answer, ["probability", "type"], "boolean answer");
      if (answer.type !== "boolean") throw new TypeError("answer type drift");
      const probability = unitNumber(answer.probability, "probability");
      return {
        questionId: question.id,
        type: "noul",
        value: probability >= 0.5,
        probabilityYes: probability,
      };
    }
    exactKeys(answer, ["probabilities", "score", "type"], "score answer");
    if (answer.type !== "score") throw new TypeError("answer type drift");
    const probabilities = numericRecord(
      answer.probabilities,
      "score probabilities",
    );
    const expectedScore = scoreFromProbabilities(
      probabilities,
      question.criteria.length,
    );
    const reportedScore = finiteNumber(answer.score, "score");
    const maximumScore = question.criteria.length - 1;
    if (
      reportedScore < 0 ||
      reportedScore > maximumScore ||
      Math.abs(reportedScore - expectedScore) > SCORE_PRESENTATION_TOLERANCE
    )
      throw new TypeError("Gateway score does not match its distribution");
    return {
      questionId: question.id,
      type: "score",
      score: expectedScore / maximumScore,
      probabilities,
      ...(confidence[question.id] === undefined
        ? {}
        : { confidence: confidence[question.id] }),
    };
  });
  const usageRecord = plainRecord(root.usage, "usage");
  exactKeys(usageRecord, ["inputTokens", "outputTokens"], "usage");
  const inputTokens = nonnegativeSafeInteger(
    usageRecord.inputTokens,
    "inputTokens",
  );
  const outputTokens = nonnegativeSafeInteger(
    usageRecord.outputTokens,
    "outputTokens",
  );
  if (!Number.isSafeInteger(inputTokens + outputTokens))
    throw new TypeError("usage total is unsafe");
  const usage: DecisionUsage = {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
  const response = validateDecisionResponse(request, {
    requestId: request.id,
    providerId: VERCEL_GATEWAY_EVALUATION_PROVIDER_ID,
    model: VERCEL_GATEWAY_JEV_MODEL,
    probabilitySemantics: "native_calibrated",
    answers,
  });
  const providerRequestIdHash = hashGenerationId(gateway.generationId);
  return {
    response,
    usage,
    route,
    ...(providerRequestIdHash === undefined ? {} : { providerRequestIdHash }),
  };
}

function scoreFromProbabilities(
  probabilities: Readonly<Record<string, number>>,
  levels: number,
): number {
  const expectedKeys = Array.from({ length: levels }, (_, index) =>
    String(index),
  );
  if (
    Object.keys(probabilities).length !== expectedKeys.length ||
    expectedKeys.some((key) => !(key in probabilities))
  )
    throw new TypeError("score probabilities do not match criteria");
  let sum = 0;
  let expectedScore = 0;
  for (const [index, key] of expectedKeys.entries()) {
    const probability = unitNumber(probabilities[key], "score probability");
    sum += probability;
    expectedScore += index * probability;
  }
  if (Math.abs(sum - 1) > 0.000001)
    throw new TypeError("score probabilities must sum to one");
  return expectedScore;
}

function confidenceRecord(
  value: unknown,
  request: DecisionRequest,
): Readonly<Record<string, number>> {
  const expected = new Set(
    request.questions
      .filter((question) => question.type !== "noul")
      .map((question) => question.id),
  );
  if (value === undefined) return Object.create(null);
  const metadata = plainRecord(value, "TypeSafe metadata");
  exactKeys(metadata, ["confidence"], "TypeSafe metadata");
  const record = plainRecord(metadata.confidence, "confidence metadata");
  const result: Record<string, number> = Object.create(null) as Record<
    string,
    number
  >;
  for (const [key, item] of Object.entries(record)) {
    if (!expected.delete(key))
      throw new TypeError("confidence keys do not match questions");
    result[key] = unitNumber(item, "confidence");
  }
  return result;
}

function exactAnswerRecord(
  value: unknown,
  request: DecisionRequest,
): Readonly<Record<string, unknown>> {
  const record = plainRecord(value, "answers");
  const expected = new Set(request.questions.map((question) => question.id));
  if (Reflect.ownKeys(record).length !== expected.size)
    throw new TypeError("answer keys do not match questions");
  for (const key of Object.keys(record))
    if (!expected.delete(key))
      throw new TypeError("answer keys do not match questions");
  if (expected.size !== 0)
    throw new TypeError("answer keys do not match questions");
  return record;
}

function plainRecord(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${label} must be a record`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError(`${label} must be a plain record`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string")
      throw new TypeError(`${label} has a symbol key`);
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
      throw new TypeError(`${label} must contain enumerable data properties`);
    result[key] = descriptor.value;
  }
  return result;
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted))
    throw new TypeError(`${label} fields do not match the contract`);
}

function numericRecord(value: unknown, label: string): Record<string, number> {
  const record = plainRecord(value, label);
  const result: Record<string, number> = Object.create(null) as Record<
    string,
    number
  >;
  for (const [key, item] of Object.entries(record))
    result[key] = unitNumber(item, label);
  return result;
}

function exactString<T extends string>(
  value: unknown,
  expected: T,
  label: string,
): T {
  if (value !== expected) throw new TypeError(`${label} drift`);
  return expected;
}

function nonemptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new TypeError(`${label} must be a nonempty string`);
  return value;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new TypeError(`${label} must be finite`);
  return value;
}

function unitNumber(value: unknown, label: string): number {
  const number = finiteNumber(value, label);
  if (number < 0 || number > 1)
    throw new TypeError(`${label} must be within [0,1]`);
  return number;
}

function nonnegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new TypeError(`${label} must be a non-negative safe integer`);
  return value as number;
}

function hashGenerationId(value: unknown): `sha256:${string}` | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > MAX_GENERATION_ID_BYTES ||
    hasControlCharacter(value)
  )
    throw new TypeError("invalid Gateway generation ID");
  return `sha256:${createHash("sha256")
    .update(GENERATION_ID_HASH_DOMAIN, "utf8")
    .update(value, "utf8")
    .digest("hex")}`;
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    );
  });
}

function responseError(response: Response): TypeSafeProviderError {
  const status = response.status;
  const retryAfterMs = retryAfter(response.headers.get("retry-after"));
  if (status === 408) return new TypeSafeProviderError("timeout", true, status);
  if (status === 401)
    return new TypeSafeProviderError("authentication", false, status);
  if (status === 403)
    return new TypeSafeProviderError("authorization", false, status);
  if (status === 400 || status === 404 || status === 422)
    return new TypeSafeProviderError("invalid_request", false, status);
  if (status === 429)
    return new TypeSafeProviderError(
      "rate_limited",
      true,
      status,
      retryAfterMs,
    );
  return new TypeSafeProviderError("unavailable", status >= 500, status);
}

function retryAfter(value: string | null): number | undefined {
  if (!value || !/^\d+$/u.test(value)) return undefined;
  const milliseconds = Number(value) * 1_000;
  return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
}

async function readBoundedJson(
  response: Response,
  maximum: number,
): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/u.test(length) || Number(length) > maximum))
    throw new TypeError("response body too large");
  const reader = response.body?.getReader();
  if (!reader) throw new TypeError("response body is missing");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new TypeError("response body too large");
    }
    chunks.push(next.value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
}

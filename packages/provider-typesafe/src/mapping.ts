import {
  choice,
  noul,
  score,
  type EntryType,
  type Questions,
} from "@typesafe-ai/sdk";
import {
  decisionRequestSchema,
  validateDecisionResponse,
  type DecisionAnswer,
  type DecisionRequest,
  type DecisionResponse,
  type DecisionUsage,
  type JsonValue,
} from "@mokimeow/jev-fabric-protocol";

export interface TypeSafeResult {
  readonly model: string;
  readonly usage: {
    readonly input_tokens: number;
    readonly output_tokens: number;
  };
  readonly answers: Readonly<Record<string, unknown>>;
}

export interface TypeSafeMappedResult {
  readonly response: DecisionResponse;
  readonly usage: DecisionUsage;
  /** Domain-separated digest of the upstream request ID; the raw ID is never retained. */
  readonly providerRequestIdHash?: `sha256:${string}`;
}
export interface NativeModelPolicy {
  readonly requestedModel: string;
  readonly approvedModels: readonly string[];
}

/** Converts protocol questions through the SDK's official primitive builders. */
export function compileTypeSafeRequest(
  inputRequest: DecisionRequest,
  model: string,
): {
  readonly state: EntryType;
  readonly questions: Questions;
  readonly model: string;
} {
  const request = decisionRequestSchema.parse(inputRequest) as DecisionRequest;
  const questions: Questions = {};
  for (const question of request.questions) {
    if (question.type === "choice") {
      if (question.options.length > 255)
        throw new RangeError("TypeSafe Choice accepts at most 255 options");
      const keys = Object.keys(question.criteria);
      if (
        keys.length !== question.options.length ||
        keys.some((key) => !question.options.includes(key))
      )
        throw new RangeError(
          "choice criteria must match choice options exactly",
        );
      questions[question.id] = choice(
        nativeEntry(question.instructions, `${question.id}.instructions`),
        Object.fromEntries(
          Object.entries(question.criteria).map(([key, value]) => [
            key,
            nativeEntry(value, `${question.id}.criteria.${key}`),
          ]),
        ),
      );
    } else if (question.type === "noul") {
      questions[question.id] = noul(
        nativeEntry(question.instructions, `${question.id}.instructions`),
        question.criteria === null
          ? null
          : Object.fromEntries(
              Object.entries(question.criteria).map(([key, value]) => [
                key,
                nativeEntry(value, `${question.id}.criteria.${key}`),
              ]),
            ),
      );
    } else {
      if (question.criteria.length < 2)
        throw new RangeError("TypeSafe score requires at least two criteria");
      if (question.criteria.length > 10)
        throw new RangeError("TypeSafe Score accepts at most 10 criteria");
      questions[question.id] = score(
        nativeEntry(question.instructions, `${question.id}.instructions`),
        nativeScoreCriteria(question.criteria, `${question.id}.criteria`),
      );
    }
  }
  return { state: nativeEntry(request.state, "state"), questions, model };
}

/** Mirrors the SDK's EntryType instead of hiding unsupported scalars in casts. */
function nativeEntry(value: JsonValue, path: string): EntryType {
  if (
    value === null ||
    typeof value === "string" ||
    Array.isArray(value) ||
    typeof value === "object"
  )
    return value as EntryType;
  throw new TypeError(
    `${path} must be text, a structured JSON object or array, or null`,
  );
}

function nativeScoreCriteria(
  values: readonly JsonValue[],
  path: string,
): readonly [EntryType, EntryType, ...EntryType[]] {
  const [first, second, ...rest] = values;
  if (first === undefined || second === undefined)
    throw new RangeError("TypeSafe score requires at least two criteria");
  return [
    nativeEntry(first, `${path}.0`),
    nativeEntry(second, `${path}.1`),
    ...rest.map((value, index) => nativeEntry(value, `${path}.${index + 2}`)),
  ];
}

/** Maps direct SDK output without renormalizing malformed native distributions. */
export function mapTypeSafeResult(
  request: DecisionRequest,
  providerId: string,
  result: TypeSafeResult,
  policy: NativeModelPolicy,
): TypeSafeMappedResult {
  const nativeAnswers = exactPlainAnswerRecord(result.answers, request);
  if (
    !policy.approvedModels.includes(policy.requestedModel) ||
    !policy.approvedModels.includes(nonemptyString(result.model, "model"))
  )
    throw new TypeError("unapproved native model");
  const usage = mapUsage(result.usage);
  const answers: DecisionAnswer[] = request.questions.map((question) => {
    const answer = nativeAnswers[question.id];
    if (!answer || typeof answer !== "object")
      throw new TypeError("missing TypeSafe answer");
    const record = answer as Record<string, unknown>;
    if (record.type !== question.type)
      throw new TypeError("TypeSafe answer type mismatch");
    if (question.type === "choice") {
      return {
        questionId: question.id,
        type: "choice",
        selected: stringValue(record.choice, "choice"),
        probabilities: numericRecord(record.probabilities, "probabilities"),
        confidence: unitNumber(record.confidence, "confidence"),
      };
    }
    if (question.type === "noul") {
      const probability = unitNumber(record.noul, "noul");
      return {
        questionId: question.id,
        type: "noul",
        // The protocol's Noul representation is categorical. This preserves the
        // native yes/no argmax without misrepresenting it as confidence.
        value: probability >= 0.5,
        probabilityYes: probability,
      };
    }
    const probabilities = numericRecord(record.probabilities, "probabilities");
    const expected = expectedScore(probabilities, question.criteria.length);
    const nativeScore = finiteNumber(record.score, "score");
    if (Math.abs(nativeScore - expected) > 0.000001)
      throw new TypeError("TypeSafe score does not match its distribution");
    return {
      questionId: question.id,
      type: "score",
      score: nativeScore / (question.criteria.length - 1),
      confidence: unitNumber(record.confidence, "confidence"),
      probabilities,
    };
  });
  const response = validateDecisionResponse(request, {
    requestId: request.id,
    providerId,
    model: nonemptyString(result.model, "model"),
    probabilitySemantics: "native_calibrated",
    answers,
  });
  return { response, usage };
}

/**
 * Native calibrated output is accepted only as a literal answer map. This
 * prevents unknown, inherited, or accessor-provided answers from being silently
 * ignored before calibrated semantics are assigned.
 */
function exactPlainAnswerRecord(
  input: unknown,
  request: DecisionRequest,
): Readonly<Record<string, unknown>> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("TypeSafe answers must be a plain record");
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError("TypeSafe answers must be a plain record");
  const expected = new Set(request.questions.map((question) => question.id));
  if (expected.size !== request.questions.length)
    throw new TypeError("TypeSafe request has duplicate question IDs");
  const keys = Reflect.ownKeys(input);
  if (keys.length !== expected.size)
    throw new TypeError("TypeSafe answer keys do not match request");
  const answers: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const key of keys) {
    if (typeof key !== "string" || !expected.delete(key))
      throw new TypeError("TypeSafe answer keys do not match request");
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
      throw new TypeError("TypeSafe answers must contain own data values");
    answers[key] = descriptor.value;
  }
  if (expected.size !== 0)
    throw new TypeError("TypeSafe answer keys do not match request");
  return answers;
}

function mapUsage(usage: TypeSafeResult["usage"]): DecisionUsage {
  const inputTokens = nonnegativeSafeInteger(
    usage.input_tokens,
    "input_tokens",
  );
  const outputTokens = nonnegativeSafeInteger(
    usage.output_tokens,
    "output_tokens",
  );
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}
function numericRecord(value: unknown, name: string): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${name} must be an object`);
  const result: Record<string, number> = {};
  for (const [key, item] of Object.entries(value))
    result[key] = finiteNumber(item, name);
  return result;
}
function expectedScore(
  probabilities: Record<string, number>,
  levels: number,
): number {
  const expectedKeys = Array.from({ length: levels }, (_, index) =>
    String(index),
  );
  if (
    Object.keys(probabilities).length !== expectedKeys.length ||
    expectedKeys.some((key) => !(key in probabilities))
  )
    throw new TypeError("TypeSafe score probabilities do not match criteria");
  const sum = Object.values(probabilities).reduce(
    (total, value) => total + value,
    0,
  );
  if (Math.abs(sum - 1) > 0.000001)
    throw new TypeError("TypeSafe score probabilities must sum to one");
  return expectedKeys.reduce(
    (total, key, index) => total + index * (probabilities[key] ?? 0),
    0,
  );
}
function nonemptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new TypeError(`${name} must be a nonempty string`);
  return value;
}
function stringValue(value: unknown, name: string): string {
  if (typeof value !== "string")
    throw new TypeError(`${name} must be a string`);
  return value;
}
function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new TypeError(`${name} must be finite`);
  return value;
}
function unitNumber(value: unknown, name: string): number {
  const number = finiteNumber(value, name);
  if (number < 0 || number > 1)
    throw new TypeError(`${name} must be within [0,1]`);
  return number;
}
function nonnegativeSafeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new TypeError(`${name} must be a non-negative safe integer`);
  return value as number;
}

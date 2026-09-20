import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AuthorizationContext } from "@mokimeow/jev-fabric-protocol";
import type { PolicyRule } from "@mokimeow/jev-fabric-core";

export const fixturePackIds = [
  "route",
  "screen",
  "rank",
  "verify",
  "risk",
  "progress",
  "completion",
  "finance-surveillance",
] as const;
export type FixturePackId = (typeof fixturePackIds)[number];
type FixtureResponse = {
  readonly answers: readonly import("@mokimeow/jev-fabric-protocol").DecisionAnswer[];
};

export interface ExecutableFixture {
  readonly id: string;
  readonly pack: FixturePackId;
  readonly state: Readonly<Record<string, unknown>>;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly script:
    | {
        readonly kind: "response";
        /** Semantic payload only; ScriptedProvider supplies trusted identity. */
        readonly response: FixtureResponse;
      }
    | {
        readonly kind: "failure";
        readonly failure: { readonly name: string; readonly message: string };
      };
  readonly authorization: AuthorizationContext;
  readonly policy: { readonly rules: readonly PolicyRule[] };
  readonly budget: { readonly requests: number };
  readonly cache: {
    readonly mode: "cold" | "warm";
    readonly maxEntries: number;
  };
  readonly expected: {
    readonly semanticStatus:
      | "decision"
      | "abstain"
      | "unavailable"
      | "no_match";
    readonly semanticData: Readonly<Record<string, unknown>>;
    readonly policyOutcome: string;
    readonly providerCallCount: number;
    readonly schedulerAttemptCount: number;
    readonly negativeInvariant: string;
  };
}

/** Reads JSONL fixtures as strict, executable public-runtime cases. */
export async function loadPackFixtures(
  root: string,
  pack: FixturePackId,
): Promise<readonly ExecutableFixture[]> {
  const contents = await readFile(
    resolve(root, pack, "fixtures.jsonl"),
    "utf8",
  );
  const rows = contents.trim().split("\n");
  if (rows.length !== 6)
    throw new Error(`${pack}: fixtures must contain exactly six rows`);
  const ids = new Set<string>();
  return rows.map((row, index) => {
    let value: unknown;
    try {
      value = JSON.parse(row);
    } catch {
      throw new Error(`${pack}:${index + 1}: invalid JSON`);
    }
    const fixture = parseFixture(value, `${pack}:${index + 1}`);
    if (fixture.pack !== pack)
      throw new Error(`${pack}:${index + 1}: fixture pack must match its file`);
    if (ids.has(fixture.id))
      throw new Error(
        `${pack}:${index + 1}: duplicate fixture id ${fixture.id}`,
      );
    ids.add(fixture.id);
    return fixture;
  });
}

export function parseFixture(
  value: unknown,
  subject = "fixture",
): ExecutableFixture {
  const row = object(value, subject);
  exactKeys(
    row,
    [
      "id",
      "pack",
      "state",
      "evidence",
      "script",
      "authorization",
      "policy",
      "budget",
      "cache",
      "expected",
    ],
    subject,
  );
  const id = string(row.id, `${subject}.id`);
  if (!/^[a-z][a-z0-9_]*$/u.test(id))
    throw new Error(`${subject}.id must be a stable identifier`);
  const pack = string(row.pack, `${subject}.pack`);
  if (!fixturePackIds.includes(pack as FixturePackId))
    throw new Error(`${subject}.pack is unknown`);
  const state = object(row.state, `${subject}.state`);
  assertCandidates(state, `${subject}.state`);
  const evidence = object(row.evidence, `${subject}.evidence`);
  const script = parseScript(row.script, `${subject}.script`);
  const authorization = parseAuthorization(
    row.authorization,
    `${subject}.authorization`,
  );
  const policy = parsePolicy(row.policy, `${subject}.policy`);
  const budget = object(row.budget, `${subject}.budget`);
  exactKeys(budget, ["requests"], `${subject}.budget`);
  if (!Number.isSafeInteger(budget.requests) || (budget.requests as number) < 0)
    throw new Error(
      `${subject}.budget.requests must be a non-negative safe integer`,
    );
  const cache = object(row.cache, `${subject}.cache`);
  exactKeys(cache, ["mode", "maxEntries"], `${subject}.cache`);
  if (cache.mode !== "cold" && cache.mode !== "warm")
    throw new Error(`${subject}.cache.mode is invalid`);
  if (
    !Number.isSafeInteger(cache.maxEntries) ||
    (cache.maxEntries as number) < 1
  )
    throw new Error(`${subject}.cache.maxEntries must be positive`);
  const expected = object(row.expected, `${subject}.expected`);
  exactKeys(
    expected,
    [
      "semanticStatus",
      "semanticData",
      "policyOutcome",
      "providerCallCount",
      "schedulerAttemptCount",
      "negativeInvariant",
    ],
    `${subject}.expected`,
  );
  if (
    !(["decision", "abstain", "unavailable", "no_match"] as const).includes(
      expected.semanticStatus as never,
    )
  )
    throw new Error(`${subject}.expected.semanticStatus is invalid`);
  const semanticData = object(
    expected.semanticData,
    `${subject}.expected.semanticData`,
  );
  const policyOutcome = string(
    expected.policyOutcome,
    `${subject}.expected.policyOutcome`,
  );
  if (
    !Number.isSafeInteger(expected.providerCallCount) ||
    (expected.providerCallCount as number) < 0
  )
    throw new Error(
      `${subject}.expected.providerCallCount must be non-negative`,
    );
  if (
    !Number.isSafeInteger(expected.schedulerAttemptCount) ||
    (expected.schedulerAttemptCount as number) < 0
  )
    throw new Error(
      `${subject}.expected.schedulerAttemptCount must be non-negative`,
    );
  const negativeInvariant = string(
    expected.negativeInvariant,
    `${subject}.expected.negativeInvariant`,
  );
  return {
    id,
    pack: pack as FixturePackId,
    state,
    evidence,
    script,
    authorization,
    policy,
    budget: { requests: budget.requests as number },
    cache: { mode: cache.mode, maxEntries: cache.maxEntries as number },
    expected: {
      semanticStatus:
        expected.semanticStatus as ExecutableFixture["expected"]["semanticStatus"],
      semanticData,
      policyOutcome,
      providerCallCount: expected.providerCallCount as number,
      schedulerAttemptCount: expected.schedulerAttemptCount as number,
      negativeInvariant,
    },
  };
}

function parseScript(
  value: unknown,
  subject: string,
): ExecutableFixture["script"] {
  const script = object(value, subject);
  if (script.kind === "response") {
    exactKeys(script, ["kind", "response"], subject);
    assertResponse(script.response, `${subject}.response`);
    return {
      kind: "response",
      response: script.response as FixtureResponse,
    };
  }
  if (script.kind === "failure") {
    exactKeys(script, ["kind", "failure"], subject);
    const failure = object(script.failure, `${subject}.failure`);
    exactKeys(failure, ["name", "message"], `${subject}.failure`);
    return {
      kind: "failure",
      failure: {
        name: string(failure.name, `${subject}.failure.name`),
        message: string(failure.message, `${subject}.failure.message`),
      },
    };
  }
  throw new Error(`${subject}.kind is invalid`);
}

function parseAuthorization(
  value: unknown,
  subject: string,
): AuthorizationContext {
  const auth = object(value, subject);
  exactKeys(
    auth,
    [
      "principalId",
      "tenantId",
      "workspaceId",
      "resourceScopes",
      "actionScopes",
      "permissionEpoch",
      "approvalReferences",
      "expiresAt",
    ],
    subject,
  );
  for (const key of [
    "principalId",
    "tenantId",
    "workspaceId",
    "permissionEpoch",
    "expiresAt",
  ])
    string(auth[key], `${subject}.${key}`);
  for (const key of ["resourceScopes", "actionScopes", "approvalReferences"])
    strings(auth[key], `${subject}.${key}`);
  return auth as unknown as AuthorizationContext;
}

function parsePolicy(
  value: unknown,
  subject: string,
): { readonly rules: readonly PolicyRule[] } {
  const policy = object(value, subject);
  exactKeys(policy, ["rules"], subject);
  if (!Array.isArray(policy.rules))
    throw new Error(`${subject}.rules must be an array`);
  for (const [index, value] of policy.rules.entries()) {
    const rule = object(value, `${subject}.rules.${index}`);
    exactKeys(
      rule,
      ["id", "phase", "outcome", "reasonCode", "action", "minimumRisk"],
      `${subject}.rules.${index}`,
    );
    string(rule.id, `${subject}.rules.${index}.id`);
    if (rule.phase !== "static" && rule.phase !== "semantic")
      throw new Error(`${subject}.rules.${index}.phase is invalid`);
    string(rule.outcome, `${subject}.rules.${index}.outcome`);
    string(rule.reasonCode, `${subject}.rules.${index}.reasonCode`);
    if (rule.action !== null)
      string(rule.action, `${subject}.rules.${index}.action`);
    if (
      rule.minimumRisk !== null &&
      (!Number.isFinite(rule.minimumRisk) || (rule.minimumRisk as number) < 0)
    )
      throw new Error(`${subject}.rules.${index}.minimumRisk is invalid`);
  }
  return {
    rules: policy.rules.map((rule) => ({
      ...rule,
      ...(rule.action === null ? {} : { action: rule.action as string }),
      ...(rule.minimumRisk === null
        ? {}
        : { minimumRisk: rule.minimumRisk as number }),
    })) as PolicyRule[],
  };
}

function assertCandidates(
  state: Record<string, unknown>,
  subject: string,
): void {
  if (!("candidates" in state))
    throw new Error(`${subject}.candidates is required`);
  if (!Array.isArray(state.candidates))
    throw new Error(`${subject}.candidates must be an array`);
  for (const [index, value] of state.candidates.entries()) {
    const candidate = object(value, `${subject}.candidates.${index}`);
    exactKeys(
      candidate,
      ["id", "description", "available", "freshness"],
      `${subject}.candidates.${index}`,
    );
    string(candidate.id, `${subject}.candidates.${index}.id`);
    string(candidate.description, `${subject}.candidates.${index}.description`);
    if (typeof candidate.available !== "boolean")
      throw new Error(
        `${subject}.candidates.${index}.available must be boolean`,
      );
    if (
      !["current", "stale", "unknown"].includes(candidate.freshness as string)
    )
      throw new Error(`${subject}.candidates.${index}.freshness is invalid`);
  }
}

function assertResponse(value: unknown, subject: string): void {
  const response = object(value, subject);
  exactKeys(response, ["answers"], subject);
  if (!Array.isArray(response.answers) || response.answers.length === 0)
    throw new Error(`${subject}.answers must be non-empty`);
  for (const [index, value] of response.answers.entries()) {
    const answer = object(value, `${subject}.answers.${index}`);
    if (answer.type === "choice") {
      exactKeys(
        answer,
        ["questionId", "type", "selected", "probabilities"],
        `${subject}.answers.${index}`,
      );
      string(answer.questionId, `${subject}.answers.${index}.questionId`);
      string(answer.selected, `${subject}.answers.${index}.selected`);
      probabilities(
        answer.probabilities,
        `${subject}.answers.${index}.probabilities`,
      );
    } else if (answer.type === "score") {
      exactKeys(
        answer,
        ["questionId", "type", "score", "probabilities"],
        `${subject}.answers.${index}`,
      );
      string(answer.questionId, `${subject}.answers.${index}.questionId`);
      if (!Number.isFinite(answer.score))
        throw new Error(`${subject}.answers.${index}.score is invalid`);
      probabilities(
        answer.probabilities,
        `${subject}.answers.${index}.probabilities`,
      );
    } else throw new Error(`${subject}.answers.${index}.type is invalid`);
  }
}

function probabilities(value: unknown, subject: string): void {
  const items = object(value, subject);
  const values = Object.values(items);
  if (
    values.length === 0 ||
    values.some(
      (item) =>
        !Number.isFinite(item) || (item as number) < 0 || (item as number) > 1,
    )
  )
    throw new Error(`${subject} is invalid`);
  const numbers = values as number[];
  if (Math.abs(numbers.reduce((sum, item) => sum + item, 0) - 1) > 0.000001)
    throw new Error(`${subject} must sum to one`);
}

function object(value: unknown, subject: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${subject} must be an object`);
  return value as Record<string, unknown>;
}
function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  subject: string,
): void {
  const actual = Object.keys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => !keys.includes(key)) ||
    keys.some((key) => !(key in value))
  )
    throw new Error(`${subject} has unknown or missing fields`);
}
function string(value: unknown, subject: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${subject} must be a non-empty string`);
  return value;
}
function strings(value: unknown, subject: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  )
    throw new Error(`${subject} must be a string array`);
  return value as readonly string[];
}

export interface DecisionCandidate {
  readonly id: string;
  readonly description: string;
  readonly available?: boolean;
  readonly freshness?: "current" | "stale" | "unknown";
}

export interface CandidateProvider<Input = unknown> {
  provide(input: Input): readonly DecisionCandidate[];
}

export interface CandidateLimits {
  readonly maxCandidates: number;
  readonly maxCandidateIdLength: number;
  readonly maxCandidateDescriptionBytes: number;
}

export class CandidateCoverageError extends Error {
  override name = "CandidateCoverageError";
}

/** Validates availability and preserves caller-declared candidate order exactly. */
export function compileCandidates(
  provider: CandidateProvider<unknown>,
  state: unknown,
  limits: CandidateLimits,
): readonly DecisionCandidate[] {
  if (!provider || typeof provider.provide !== "function")
    throw new CandidateCoverageError(
      "a trusted candidate provider is required",
    );
  const candidates = provider.provide(state);
  if (!Array.isArray(candidates))
    throw new CandidateCoverageError("candidate provider must return an array");
  if (candidates.length > limits.maxCandidates)
    throw new CandidateCoverageError("candidate count exceeds maxCandidates");
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object")
      throw new CandidateCoverageError("candidate must be an object");
    if (
      !/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u.test(candidate.id) ||
      candidate.id.length > limits.maxCandidateIdLength
    )
      throw new CandidateCoverageError("candidate id is invalid or too long");
    if (ids.has(candidate.id))
      throw new CandidateCoverageError("candidate ids must be unique");
    ids.add(candidate.id);
    if (
      typeof candidate.description !== "string" ||
      Buffer.byteLength(candidate.description, "utf8") >
        limits.maxCandidateDescriptionBytes
    )
      throw new CandidateCoverageError("candidate description is too long");
    if (
      candidate.freshness !== undefined &&
      !["current", "stale", "unknown"].includes(candidate.freshness)
    )
      throw new CandidateCoverageError("candidate freshness is invalid");
    if (
      candidate.available !== undefined &&
      typeof candidate.available !== "boolean"
    )
      throw new CandidateCoverageError(
        "candidate availability must be boolean",
      );
  }
  return Object.freeze(
    candidates.map((candidate) => Object.freeze({ ...candidate })),
  );
}

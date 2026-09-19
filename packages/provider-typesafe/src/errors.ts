export type TypeSafeProviderErrorCategory =
  | "authentication"
  | "authorization"
  | "invalid_request"
  | "rate_limited"
  | "unavailable"
  | "timeout"
  | "cancelled"
  | "invalid_response"
  | "configuration"
  | "network";

/** A stable, redacted provider error safe to surface in receipts and logs. */
export class TypeSafeProviderError extends Error {
  readonly name = "TypeSafeProviderError";
  constructor(
    readonly category: TypeSafeProviderErrorCategory,
    readonly retryable: boolean,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(`TypeSafe provider ${category.replaceAll("_", " ")}`);
  }
}

export function sanitizeTypeSafeError(error: unknown): TypeSafeProviderError {
  if (error instanceof TypeSafeProviderError) return error;
  const status = safeIntegerProperty(error, "status");
  const retryAfterMs = safeIntegerProperty(error, "retryAfterMs");
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
  if (status !== undefined)
    return new TypeSafeProviderError("unavailable", status >= 500, status);
  const name = error instanceof Error ? error.name : "";
  if (name === "APIUserAbortError" || name === "AbortError")
    return new TypeSafeProviderError("cancelled", false);
  if (name === "APITimeoutError")
    return new TypeSafeProviderError("timeout", true);
  if (name === "TypeError" || name === "ZodError")
    return new TypeSafeProviderError("invalid_response", false);
  return new TypeSafeProviderError("network", true);
}

function safeIntegerProperty(error: unknown, key: string): number | undefined {
  if (!error || typeof error !== "object" || !(key in error)) return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

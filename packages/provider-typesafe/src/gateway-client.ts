import { TypeSafeClient } from "@typesafe-ai/sdk";
import { sanitizeTypeSafeError, TypeSafeProviderError } from "./errors.js";
import { pinnedTypeSafeFetch } from "./transport.js";

/** Official TypeSafe SDK endpoint for Vercel AI Gateway's Jev route. */
export const VERCEL_GATEWAY_TYPESAFE_BASE_URL =
  "https://ai-gateway.vercel.sh/typesafe" as const;
/** Gateway model IDs are transport-specific and deliberately not aliases. */
export const VERCEL_GATEWAY_JEV_MODEL = "typesafe-ai/jev" as const;
export const VERCEL_GATEWAY_JEV_PROVIDER_ID =
  "typesafe-vercel-gateway" as const;

/**
 * Constructs the SDK client behind the public fixed Gateway factory.
 *
 * This module is deliberately absent from the package export map. The base URL
 * seam exists only so an offline loopback test can prove the emitted wire
 * contract; package consumers cannot use it to bypass the pinned public route.
 */
export function createPinnedVercelGatewayJevClient(
  apiKey: string,
  baseURL: string = VERCEL_GATEWAY_TYPESAFE_BASE_URL,
): TypeSafeClient {
  if (!apiKey) throw new TypeSafeProviderError("configuration", false);
  try {
    return new TypeSafeClient({
      apiKey,
      baseURL,
      defaultModel: VERCEL_GATEWAY_JEV_MODEL,
      fetch: pinnedTypeSafeFetch,
      logLevel: "off",
      retry: { maxRetries: 0 },
    });
  } catch (error) {
    throw sanitizeTypeSafeError(error);
  }
}

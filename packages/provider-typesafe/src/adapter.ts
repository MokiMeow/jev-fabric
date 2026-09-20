import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type {
  DecisionProvider,
  DecisionRequest,
  DecisionResponse,
  DecisionUsage,
  EvaluateOptions,
  ProviderCapabilities,
} from "@mokimeow/jev-fabric-protocol";
import { type RequestOptions, TypeSafeClient } from "@typesafe-ai/sdk";
import { sanitizeTypeSafeError, TypeSafeProviderError } from "./errors.js";
import {
  createPinnedVercelGatewayJevClient,
  VERCEL_GATEWAY_JEV_MODEL,
  VERCEL_GATEWAY_JEV_PROVIDER_ID,
} from "./gateway-client.js";
import {
  compileTypeSafeRequest,
  mapTypeSafeResult,
  type TypeSafeMappedResult,
  type TypeSafeResult,
} from "./mapping.js";
import { pinnedTypeSafeFetch } from "./transport.js";

export interface TypeSafeClientResponse {
  readonly data: unknown;
  readonly requestId: string | undefined;
}

export interface TypeSafeClientPromise extends PromiseLike<unknown> {
  readonly withResponse?: () => Promise<TypeSafeClientResponse>;
}

export interface TypeSafeClientLike {
  systemOne(request: unknown, options?: RequestOptions): TypeSafeClientPromise;
}
export interface TypeSafeProviderOptions {
  readonly id: string;
  readonly model: string;
  readonly client?: TypeSafeClientLike;
  /** Used only when no client is injected. Never read credentials from ambient environment. */
  readonly apiKey?: string;
  /** Explicit trusted host policy for future official Jev aliases. */
  readonly approvedModels?: readonly string[];
}

/** The only native Jev model admitted by the alpha CLI integration. */
export const NATIVE_JEV_MODEL = "jev-1.13.0" as const;
export const NATIVE_JEV_PROVIDER_ID = "typesafe-native" as const;
export {
  VERCEL_GATEWAY_JEV_MODEL,
  VERCEL_GATEWAY_JEV_PROVIDER_ID,
  VERCEL_GATEWAY_TYPESAFE_BASE_URL,
} from "./gateway-client.js";

export interface NativeJevProviderOptions {
  /** Resolved by a trusted server process after CLI gates have passed. */
  readonly apiKey: string;
  /** Injection seam for offline tests; no network client is constructed when supplied. */
  readonly client?: TypeSafeClientLike;
}

export interface VercelGatewayJevProviderOptions {
  /** Resolved by trusted server startup after explicit live-use gates pass. */
  readonly apiKey: string;
}

/**
 * Creates the pinned native integration. It has no alias, endpoint, model, or
 * ambient-credential escape hatch; Fabric owns retries and accounting.
 */
export function createNativeJevProvider(
  options: NativeJevProviderOptions,
): TypeSafeProvider {
  if (!options.apiKey) throw new TypeSafeProviderError("configuration", false);
  return new TypeSafeProvider({
    id: NATIVE_JEV_PROVIDER_ID,
    model: NATIVE_JEV_MODEL,
    apiKey: options.apiKey,
    ...(options.client === undefined ? {} : { client: options.client }),
  });
}

/**
 * Creates the fixed Vercel AI Gateway Jev integration. It never reads ambient
 * credentials and has no caller-controlled endpoint, model, or provider ID.
 */
export function createVercelGatewayJevProvider(
  options: VercelGatewayJevProviderOptions,
): TypeSafeProvider {
  if (!options.apiKey) throw new TypeSafeProviderError("configuration", false);
  return new TypeSafeProvider({
    id: VERCEL_GATEWAY_JEV_PROVIDER_ID,
    model: VERCEL_GATEWAY_JEV_MODEL,
    approvedModels: [VERCEL_GATEWAY_JEV_MODEL],
    client: createPinnedVercelGatewayJevClient(options.apiKey),
  });
}

export class TypeSafeProvider implements DecisionProvider {
  readonly capabilities: ProviderCapabilities = {
    questionTypes: ["choice", "noul", "score"],
    probabilitySemantics: ["native_calibrated"],
    maxQuestions: 100,
  };
  readonly #client: TypeSafeClientLike;
  readonly #model: string;
  readonly #approvedModels: readonly string[];
  readonly id: string;

  constructor(options: TypeSafeProviderOptions) {
    this.#approvedModels = options.approvedModels ?? ["jev-1.13.0"];
    if (
      !options.id ||
      !options.model ||
      !this.#approvedModels.includes(options.model)
    )
      throw new TypeSafeProviderError("configuration", false);
    this.id = options.id;
    this.#model = options.model;
    this.#client =
      options.client ?? createClient(options.apiKey, options.model);
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
  ): Promise<TypeSafeMappedResult> {
    if (
      options?.deadlineMs !== undefined &&
      (!Number.isFinite(options.deadlineMs) || options.deadlineMs <= 0)
    )
      throw new TypeSafeProviderError("configuration", false);
    let compiled: ReturnType<typeof compileTypeSafeRequest>;
    try {
      compiled = compileTypeSafeRequest(request, this.#model);
    } catch {
      throw new TypeSafeProviderError("invalid_request", false);
    }
    try {
      const callOptions: RequestOptions = {
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
        ...(options?.deadlineMs === undefined
          ? {}
          : { timeout: options.deadlineMs }),
        // Fabric owns retry/accounting; never let the SDK make hidden attempts.
        retry: { maxRetries: 0 },
      };
      const pending = this.#client.systemOne(compiled, callOptions);
      const withResponse = pending.withResponse;
      const envelope =
        typeof withResponse === "function"
          ? validateClientResponse(await withResponse.call(pending))
          : { data: await pending, requestId: undefined };
      const mapped = mapTypeSafeResult(
        request,
        this.id,
        envelope.data as TypeSafeResult,
        {
          requestedModel: this.#model,
          approvedModels: this.#approvedModels,
        },
      );
      const providerRequestIdHash = hashProviderRequestId(envelope.requestId);
      return providerRequestIdHash === undefined
        ? mapped
        : { ...mapped, providerRequestIdHash };
    } catch (error) {
      throw sanitizeTypeSafeError(error);
    }
  }
}

const MAX_PROVIDER_REQUEST_ID_BYTES = 1_024;
const REQUEST_ID_HASH_DOMAIN = "jev-fabric/typesafe-request-id/v1\u0000";

function validateClientResponse(value: unknown): TypeSafeClientResponse {
  if (!value || typeof value !== "object" || !("data" in value))
    throw new TypeError("invalid TypeSafe response envelope");
  const requestId = (value as { readonly requestId?: unknown }).requestId;
  if (requestId !== undefined && typeof requestId !== "string")
    throw new TypeError("invalid TypeSafe request ID");
  return { data: (value as { readonly data: unknown }).data, requestId };
}

function hashProviderRequestId(
  requestId: string | undefined,
): `sha256:${string}` | undefined {
  if (requestId === undefined) return undefined;
  if (
    requestId.length === 0 ||
    Buffer.byteLength(requestId, "utf8") > MAX_PROVIDER_REQUEST_ID_BYTES ||
    containsControlCharacter(requestId)
  )
    throw new TypeError("invalid TypeSafe request ID");
  return `sha256:${createHash("sha256")
    .update(REQUEST_ID_HASH_DOMAIN, "utf8")
    .update(requestId, "utf8")
    .digest("hex")}`;
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    );
  });
}

function createClient(
  apiKey: string | undefined,
  model: string,
): TypeSafeClient {
  if (!apiKey) throw new TypeSafeProviderError("configuration", false);
  try {
    return new TypeSafeClient({
      apiKey,
      defaultModel: model,
      fetch: pinnedTypeSafeFetch,
      logLevel: "off",
      retry: { maxRetries: 0 },
    });
  } catch (error) {
    throw sanitizeTypeSafeError(error);
  }
}

export type { DecisionUsage };

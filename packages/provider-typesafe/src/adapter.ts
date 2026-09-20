import { TypeSafeClient, type RequestOptions } from "@typesafe-ai/sdk";
import type {
  DecisionProvider,
  DecisionRequest,
  DecisionResponse,
  DecisionUsage,
  EvaluateOptions,
  ProviderCapabilities,
} from "@mokimeow/jev-fabric-protocol";
import { TypeSafeProviderError, sanitizeTypeSafeError } from "./errors.js";
import {
  compileTypeSafeRequest,
  mapTypeSafeResult,
  type TypeSafeMappedResult,
  type TypeSafeResult,
} from "./mapping.js";

export interface TypeSafeClientLike {
  systemOne(request: unknown, options?: RequestOptions): Promise<unknown>;
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
/** Official TypeSafe SDK endpoint for Vercel AI Gateway's Jev route. */
export const VERCEL_GATEWAY_TYPESAFE_BASE_URL =
  "https://ai-gateway.vercel.sh/typesafe" as const;
/** Gateway model IDs are transport-specific and deliberately not aliases. */
export const VERCEL_GATEWAY_JEV_MODEL = "typesafe-ai/jev" as const;
export const VERCEL_GATEWAY_JEV_PROVIDER_ID =
  "typesafe-vercel-gateway" as const;

export interface NativeJevProviderOptions {
  /** Resolved by a trusted server process after CLI gates have passed. */
  readonly apiKey: string;
  /** Injection seam for offline tests; no network client is constructed when supplied. */
  readonly client?: TypeSafeClientLike;
}

export interface VercelGatewayJevProviderOptions {
  /** Resolved by trusted server startup after explicit live-use gates pass. */
  readonly apiKey: string;
  /** Injection seam for offline tests; no network client is constructed when supplied. */
  readonly client?: TypeSafeClientLike;
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
    ...(options.client === undefined
      ? { client: createVercelGatewayJevClient(options.apiKey) }
      : { client: options.client }),
  });
}

/** Internal transport construction; callers cannot bypass the pinned provider. */
function createVercelGatewayJevClient(apiKey: string): TypeSafeClient {
  if (!apiKey) throw new TypeSafeProviderError("configuration", false);
  try {
    return new TypeSafeClient({
      apiKey,
      baseURL: VERCEL_GATEWAY_TYPESAFE_BASE_URL,
      defaultModel: VERCEL_GATEWAY_JEV_MODEL,
      logLevel: "off",
      retry: { maxRetries: 0 },
    });
  } catch (error) {
    throw sanitizeTypeSafeError(error);
  }
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
    try {
      if (
        options?.deadlineMs !== undefined &&
        (!Number.isFinite(options.deadlineMs) || options.deadlineMs <= 0)
      )
        throw new TypeSafeProviderError("configuration", false);
      const callOptions: RequestOptions = {
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
        ...(options?.deadlineMs === undefined
          ? {}
          : { timeout: options.deadlineMs }),
        // Fabric owns retry/accounting; never let the SDK make hidden attempts.
        retry: { maxRetries: 0 },
      };
      const result = await this.#client.systemOne(
        compileTypeSafeRequest(request, this.#model),
        callOptions,
      );
      return mapTypeSafeResult(request, this.id, result as TypeSafeResult, {
        requestedModel: this.#model,
        approvedModels: this.#approvedModels,
      });
    } catch (error) {
      throw sanitizeTypeSafeError(error);
    }
  }
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
      logLevel: "off",
      retry: { maxRetries: 0 },
    });
  } catch (error) {
    throw sanitizeTypeSafeError(error);
  }
}

export type { DecisionUsage };

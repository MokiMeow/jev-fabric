import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  decisionResponseSchema,
  type DecisionResponse,
} from "@mokimeow/jev-fabric-protocol";
import { canonicalize, sha256Digest } from "./canonical.js";
import { CacheError } from "./errors.js";

export interface DecisionCacheKey {
  /** Trusted tenant identifier; it is included in every cache identity. */
  readonly tenantId: string;
  readonly namespace: string;
  /** A digest or other opaque identity, never raw state. */
  readonly key: string;
}

export interface CacheSetOptions {
  readonly ttlMs?: number;
}

export interface DecisionCache<T = unknown> {
  get(key: DecisionCacheKey): Promise<T | undefined>;
  set(
    key: DecisionCacheKey,
    value: T,
    options?: CacheSetOptions,
  ): Promise<void>;
  delete(key: DecisionCacheKey): Promise<void>;
}

interface CachedValue<T> {
  readonly value: T;
  readonly expiresAt?: number;
}

export interface MemoryDecisionCacheOptions {
  readonly maxEntries: number;
  readonly now?: () => number;
}

/** Bounded LRU cache; entries are isolated by their complete tenant-scoped key. */
export class MemoryDecisionCache<T = unknown> implements DecisionCache<T> {
  readonly #entries = new Map<string, CachedValue<T>>();
  readonly #now: () => number;
  readonly #maxEntries: number;

  constructor(options: MemoryDecisionCacheOptions) {
    if (!Number.isSafeInteger(options.maxEntries) || options.maxEntries <= 0) {
      throw new CacheError("maxEntries must be a positive safe integer");
    }
    this.#maxEntries = options.maxEntries;
    this.#now = options.now ?? Date.now;
  }

  async get(key: DecisionCacheKey): Promise<T | undefined> {
    const identity = cacheIdentity(key);
    const entry = this.#entries.get(identity);
    if (!entry) return undefined;
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.#now()) {
      this.#entries.delete(identity);
      return undefined;
    }
    this.#entries.delete(identity);
    this.#entries.set(identity, entry);
    return entry.value;
  }

  async set(
    key: DecisionCacheKey,
    value: T,
    options: CacheSetOptions = {},
  ): Promise<void> {
    const identity = cacheIdentity(key);
    const expiresAt = expiry(this.#now(), options.ttlMs);
    this.#entries.delete(identity);
    this.#entries.set(
      identity,
      expiresAt === undefined ? { value } : { value, expiresAt },
    );
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
  }

  async delete(key: DecisionCacheKey): Promise<void> {
    this.#entries.delete(cacheIdentity(key));
  }
}

/** Strict metadata-only value allowed in the persistent cache. */
export interface PersistedDecisionCacheEntry {
  readonly schemaVersion: 1;
  readonly stateHash: string;
  readonly scopeHash: string;
  readonly packVersion: string;
  readonly providerId: string;
  readonly model: string;
  /** A protocol-validated judgment, never input state or authorization. */
  readonly response: DecisionResponse;
  readonly provenance?: {
    readonly compilerVersion: string;
    readonly sensitivity: "public" | "internal" | "confidential" | "restricted";
  };
  readonly accounting?: {
    readonly latencyMs: number;
    readonly inputTokens?: number;
    readonly outputTokens?: number;
  };
}

interface FileEnvelope {
  readonly version: 1;
  readonly keyHash: string;
  readonly createdAt: number;
  readonly expiresAt?: number;
  readonly value: PersistedDecisionCacheEntry;
  readonly integrity: string;
}

export interface FileDecisionCacheOptions {
  readonly directory: string;
  readonly now?: () => number;
}

/**
 * Persistent cache whose filenames are opaque tenant-keyed digests. Its value
 * is an explicit, validated metadata record; arbitrary state cannot be written.
 */
export class FileDecisionCache
  implements DecisionCache<PersistedDecisionCacheEntry>
{
  readonly #directory: string;
  readonly #now: () => number;
  readonly #operations = new Map<string, Promise<void>>();

  constructor(options: FileDecisionCacheOptions) {
    if (!options.directory) throw new CacheError("directory is required");
    this.#directory = options.directory;
    this.#now = options.now ?? Date.now;
  }

  pathFor(key: DecisionCacheKey): string {
    cacheIdentity(key);
    const digest = sha256Digest(key, "jev-fabric/cache-path/v1");
    return join(this.#directory, digest.slice(0, 2), `${digest}.json`);
  }

  async get(
    key: DecisionCacheKey,
  ): Promise<PersistedDecisionCacheEntry | undefined> {
    const path = this.pathFor(key);
    return this.serial(path, async () => {
      try {
        const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
        if (
          !isEnvelope(parsed) ||
          parsed.keyHash !== fileKeyHash(key) ||
          !validEnvelope(parsed)
        )
          return undefined;
        if (parsed.expiresAt !== undefined && parsed.expiresAt <= this.#now()) {
          await unlink(path).catch(() => undefined);
          return undefined;
        }
        return parsed.value;
      } catch {
        return undefined;
      }
    });
  }

  async set(
    key: DecisionCacheKey,
    value: PersistedDecisionCacheEntry,
    options: CacheSetOptions = {},
  ): Promise<void> {
    cacheIdentity(key);
    const path = this.pathFor(key);
    const entry = validatePersistentEntry(value);
    await this.serial(path, async () => {
      const expiresAt = expiry(this.#now(), options.ttlMs);
      const body =
        expiresAt === undefined
          ? {
              version: 1 as const,
              keyHash: fileKeyHash(key),
              createdAt: this.#now(),
              value: entry,
            }
          : {
              version: 1 as const,
              keyHash: fileKeyHash(key),
              createdAt: this.#now(),
              expiresAt,
              value: entry,
            };
      const envelope: FileEnvelope = {
        ...body,
        integrity: sha256Digest(body, "jev-fabric/cache-envelope/v1"),
      };
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, canonicalize(envelope), {
          encoding: "utf8",
          flag: "wx",
        });
        await rename(temporary, path);
      } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
      }
    });
  }

  async delete(key: DecisionCacheKey): Promise<void> {
    const path = this.pathFor(key);
    await this.serial(path, async () => {
      await unlink(path).catch(() => undefined);
    });
  }

  private async serial<T>(
    path: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.#operations.get(path) ?? Promise.resolve();
    let complete!: () => void;
    const tail = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const chain = previous.catch(() => undefined).then(() => tail);
    this.#operations.set(path, chain);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      complete();
      if (this.#operations.get(path) === chain) this.#operations.delete(path);
    }
  }
}

function cacheIdentity(key: DecisionCacheKey): string {
  if (!key.tenantId || !key.namespace || !key.key)
    throw new CacheError("cache keys require tenantId, namespace, and key");
  return canonicalize({
    tenantId: key.tenantId,
    namespace: key.namespace,
    key: key.key,
  });
}

function expiry(now: number, ttlMs: number | undefined): number | undefined {
  if (ttlMs === undefined) return undefined;
  if (!Number.isFinite(ttlMs) || ttlMs < 0)
    throw new CacheError("ttlMs must be non-negative and finite");
  return now + ttlMs;
}

function isEnvelope(value: unknown): value is FileEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    typeof record.keyHash === "string" &&
    typeof record.createdAt === "number" &&
    typeof record.integrity === "string" &&
    (record.expiresAt === undefined || typeof record.expiresAt === "number") &&
    "value" in record &&
    isPersistentEntry(record.value)
  );
}

function validEnvelope(envelope: FileEnvelope): boolean {
  try {
    const { integrity, ...body } = envelope;
    return integrity === sha256Digest(body, "jev-fabric/cache-envelope/v1");
  } catch {
    return false;
  }
}
function fileKeyHash(key: DecisionCacheKey): string {
  return sha256Digest(key, "jev-fabric/cache-entry-key/v1");
}

function isPersistentEntry(
  value: unknown,
): value is PersistedDecisionCacheEntry {
  try {
    validatePersistentEntry(value);
    return true;
  } catch {
    return false;
  }
}

function validatePersistentEntry(value: unknown): PersistedDecisionCacheEntry {
  const snapshot = JSON.parse(canonicalize(value)) as unknown;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
    throw new CacheError("persistent cache entry must be an object");
  const entry = snapshot as Record<string, unknown>;
  const allowed = new Set([
    "schemaVersion",
    "stateHash",
    "scopeHash",
    "packVersion",
    "providerId",
    "model",
    "response",
    "provenance",
    "accounting",
  ]);
  if (Object.keys(entry).some((key) => !allowed.has(key)))
    throw new CacheError(
      "persistent cache entry contains an unsupported field",
    );
  if (
    entry.schemaVersion !== 1 ||
    !nonEmpty(entry.stateHash) ||
    !nonEmpty(entry.scopeHash) ||
    !nonEmpty(entry.packVersion) ||
    !nonEmpty(entry.providerId) ||
    !nonEmpty(entry.model)
  )
    throw new CacheError("persistent cache entry metadata is invalid");
  let response: DecisionResponse;
  try {
    response = decisionResponseSchema.parse(entry.response) as DecisionResponse;
  } catch {
    throw new CacheError("persistent cache entry response is invalid");
  }
  if (
    response.providerId !== entry.providerId ||
    response.model !== entry.model
  )
    throw new CacheError(
      "persistent cache entry provenance does not match response",
    );
  validateProvenance(entry.provenance);
  validateAccounting(entry.accounting);
  return snapshot as PersistedDecisionCacheEntry;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
function validateProvenance(value: unknown): void {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CacheError("persistent cache provenance is invalid");
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) => key !== "compilerVersion" && key !== "sensitivity",
    ) ||
    !nonEmpty(record.compilerVersion) ||
    !["public", "internal", "confidential", "restricted"].includes(
      record.sensitivity as string,
    )
  )
    throw new CacheError("persistent cache provenance is invalid");
}
function validateAccounting(value: unknown): void {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CacheError("persistent cache accounting is invalid");
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) =>
        key !== "latencyMs" && key !== "inputTokens" && key !== "outputTokens",
    ) ||
    !nonNegativeNumber(record.latencyMs) ||
    (record.inputTokens !== undefined &&
      !nonNegativeInteger(record.inputTokens)) ||
    (record.outputTokens !== undefined &&
      !nonNegativeInteger(record.outputTokens))
  )
    throw new CacheError("persistent cache accounting is invalid");
}
function nonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

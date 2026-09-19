import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FileDecisionCache,
  MemoryDecisionCache,
  type PersistedDecisionCacheEntry,
} from "../src/index.js";

const key = (tenantId: string) => ({
  tenantId,
  namespace: "judgment",
  key: "digest",
});

const entry = (): PersistedDecisionCacheEntry => ({
  schemaVersion: 1,
  stateHash: "state-hash",
  scopeHash: "scope-hash",
  packVersion: "1.0.0",
  providerId: "provider",
  model: "model",
  response: {
    requestId: "request",
    providerId: "provider",
    model: "model",
    probabilitySemantics: "synthetic",
    answers: [{ questionId: "question", type: "noul", value: "answer" }],
  },
});

describe("decision caches", () => {
  it("never returns another tenant's judgment", async () => {
    const cache = new MemoryDecisionCache({ maxEntries: 2 });
    await cache.set(key("one"), { result: "one" });
    expect(await cache.get(key("two"))).toBeUndefined();
  });

  it("expires entries on the TTL boundary and evicts least-recently-used entries", async () => {
    let now = 10;
    const cache = new MemoryDecisionCache({ maxEntries: 1, now: () => now });
    await cache.set(key("one"), "first", { ttlMs: 5 });
    now = 15;
    expect(await cache.get(key("one"))).toBeUndefined();
    await cache.set(key("one"), "first");
    await cache.set({ ...key("one"), key: "next" }, "second");
    expect(await cache.get(key("one"))).toBeUndefined();
  });

  it("remains bounded when concurrent writes race with eviction", async () => {
    const cache = new MemoryDecisionCache({ maxEntries: 1 });
    await Promise.all(
      ["one", "two", "three"].map((suffix) =>
        cache.set({ ...key("tenant"), key: suffix }, suffix),
      ),
    );
    const values = await Promise.all(
      ["one", "two", "three"].map((suffix) =>
        cache.get({ ...key("tenant"), key: suffix }),
      ),
    );
    expect(values.filter((value) => value !== undefined)).toHaveLength(1);
  });

  it("rejects corrupt file entries and uses opaque tenant-keyed paths", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jev-cache-"));
    const cache = new FileDecisionCache({ directory });
    await cache.set(key("private-tenant"), entry());
    const path = cache.pathFor(key("private-tenant"));
    expect(path).not.toContain("private-tenant");
    expect(await cache.get(key("private-tenant"))).toEqual(entry());
    await writeFile(path, "not an envelope", "utf8");
    expect(await cache.get(key("private-tenant"))).toBeUndefined();
  });

  it("rejects integrity tampering without exposing stored content", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jev-cache-"));
    const cache = new FileDecisionCache({ directory });
    await cache.set(key("one"), entry());
    const path = cache.pathFor(key("one"));
    const envelope = JSON.parse(await readFile(path, "utf8")) as {
      value: unknown;
    };
    envelope.value = { ...entry(), stateHash: "tampered" };
    await writeFile(path, JSON.stringify(envelope), "utf8");
    expect(await cache.get(key("one"))).toBeUndefined();
  });

  it("rejects arbitrary raw state even when callers bypass the static entry type", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jev-cache-"));
    const cache = new FileDecisionCache({ directory });
    if (process.env.JEV_FABRIC_TYPE_TEST === "1") {
      // @ts-expect-error File cache values are deliberately metadata-only.
      cache.set(key("one"), { state: { secret: "not persistable" } });
    }
    await expect(
      cache.set(key("one"), {
        state: { secret: "not persistable" },
      } as unknown as PersistedDecisionCacheEntry),
    ).rejects.toThrow();
  });

  it("keeps a fresh write that races an expired read", async () => {
    let now = 0;
    const directory = await mkdtemp(join(tmpdir(), "jev-cache-"));
    const cache = new FileDecisionCache({ directory, now: () => now });
    await cache.set(key("one"), entry(), { ttlMs: 1 });
    now = 1;
    const staleRead = cache.get(key("one"));
    await cache.set(key("one"), { ...entry(), stateHash: "fresh" });
    await staleRead;
    expect(await cache.get(key("one"))).toEqual({
      ...entry(),
      stateHash: "fresh",
    });
  });
});

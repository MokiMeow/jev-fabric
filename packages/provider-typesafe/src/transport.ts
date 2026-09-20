import type { Fetch } from "@typesafe-ai/sdk";
import { fetch as undiciFetch } from "undici";

/**
 * The SDK buffers cloned responses so callers can use `withResponse()`. Node 22's
 * bundled fetch can surface an unhandled AbortError when that response is
 * cancelled after headers. Pin the independently versioned transport whose
 * clone/cancellation behavior is covered by Fabric's child-process probe.
 */
export const pinnedTypeSafeFetch: Fetch = async (input, init) =>
  (await undiciFetch(
    input,
    init as unknown as Parameters<typeof undiciFetch>[1],
  )) as unknown as Response;

import { bindWebMcpAdvisory } from "../../packages/adapters/src/index.js";

/**
 * Offline WebMCP compatibility example. Host policy is projected separately;
 * page metadata merely has to match that projection. No browser or tool call is
 * available from this example.
 */
export function example() {
  const hostProjection = {
    origin: "https://tools.example.test",
    frameId: "frame-main",
    toolName: "summarize_page",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", maxLength: 200 } },
      required: ["text"],
      additionalProperties: false,
    },
    policyEpoch: "policy-7",
    stateVersion: "state-42",
  } as const;
  const binding = bindWebMcpAdvisory(hostProjection, {
    origin: hostProjection.origin,
    frameId: hostProjection.frameId,
    toolName: hostProjection.toolName,
    inputSchema: hostProjection.inputSchema,
  });
  let rejectedCrossOrigin = false;
  try {
    bindWebMcpAdvisory(hostProjection, {
      origin: "https://untrusted.example.test",
      frameId: hostProjection.frameId,
      toolName: hostProjection.toolName,
      inputSchema: hostProjection.inputSchema,
    });
  } catch {
    rejectedCrossOrigin = true;
  }
  if (!rejectedCrossOrigin)
    throw new Error("cross-origin metadata must abstain");
  return { binding, rejectedCrossOrigin };
}

if (import.meta.main) console.log(JSON.stringify(example()));

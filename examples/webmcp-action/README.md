# WebMCP advisory binding

This experimental example binds host-projected origin, frame, tool schema, policy epoch, and state version to matching untrusted page metadata. It also demonstrates the stricter `mcp-handler` bridge contract: an exact same-origin script asset, a sorted read-only-only allowlist, same-origin credentials, and a required same-origin cookie gate. It does not import browser automation, discover tools, invoke `executeTool`, or authorize an action. A cross-origin page is rejected deterministically.

Run this repository example offline with `pnpm exec tsx examples/webmcp-action/index.ts`.

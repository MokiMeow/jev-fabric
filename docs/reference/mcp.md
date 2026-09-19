# MCP reference
The MCP server exposes exactly five read-only advisory tools:

| Tool | Purpose |
| --- | --- |
| `decision_evaluate_pack` | evaluate a declared built-in pack |
| `decision_route` | route among supplied candidates |
| `decision_rank` | rank supplied evidence candidates |
| `decision_verify` | verify a bounded assertion |
| `decision_explain_receipt` | retrieve a retained redacted receipt |

Tool output includes structured advisory content and never executes, authorizes, or grants permission. Inputs, output size, receipts, body size, deadlines, bearer authentication, host/origin handling, and HTTP transport are bounded. HTTP serves loopback only in this alpha; use stdio where practical.

## Tool inputs

`decision_evaluate_pack` accepts `{ pack, state, tenantId, action,
knownActions, trustedRisk?, deadlineMs? }`. `decision_route`, `decision_rank`,
and `decision_verify` accept the same shape without `pack`; their pack is fixed
by the tool name. `decision_explain_receipt` accepts `{ decisionId }`.

All strings and JSON structures are bounded. `state` must be data-only: it may
not contain credential or action-ticket material. The caller supplies ordinary
request context, but an administrator-configured live stdio overlay replaces
identity/policy fields with its fixed operator controls.

Success returns `content` plus `structuredContent` with `{ advisory: true,
semantic, receipt, accounting }`; receipt lookup returns `{ advisory: true,
receipt }`. Tool errors have `isError: true` and a redacted code such as
`INVALID_INPUT`, `PACK_NOT_FOUND`, `RECEIPT_NOT_FOUND`, `CANCELLED`, or
`DECISION_UNAVAILABLE`. A receipt ID is opaque, scope-bound, and expires after
five minutes; it is provenance, never a permission.

`tenantId` and `action` are 1–128 character portable identifiers
(`A-Z`, `a-z`, digits, `.`, `_`, `:`, `-`). `knownActions` contains 1–32
non-empty values and must include the action. `deadlineMs`, if supplied, is an
integer from 1 through 60,000. State is JSON only and is bounded to 32 KiB,
eight nested levels, 100 entries, 128-character property names, and 4 KiB
strings. Specific tools deliberately do **not** accept `pack`.

## Copyable offline stdio exchange

Start `jev-fabric serve --transport stdio`, then send newline-delimited JSON-RPC
messages on stdin. A normal MCP SDK handles framing; the compact transcript
below shows the application values. Replace the JSON-RPC `id` values as needed.

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2026-07-28","capabilities":{},"clientInfo":{"name":"example","version":"1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"decision_evaluate_pack","arguments":{"pack":"route","state":{"candidates":[{"id":"docs","description":"Documentation"},{"id":"code","description":"Code"}]},"tenantId":"demo","action":"route","knownActions":["route"],"deadlineMs":1000}}}
```

For `decision_route`, `decision_rank`, and `decision_verify`, reuse the final
call but omit `pack` and set `name` to the fixed tool. The generic
`decision_evaluate_pack` is the only tool that accepts a pack ID. The fifth
tool is a separate receipt lookup:

```json
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"decision_explain_receipt","arguments":{"decisionId":"receipt_<opaque-id-from-call-3>"}}}
```

The successful call result contains
`result.structuredContent = { advisory: true, semantic, receipt, accounting }`.
The exact receipt ID is random rather than the placeholder above. Invalid state
returns a redacted MCP tool error such as
`{ "isError": true, "content": [{ "type": "text", "text": "{\\\"code\\\":\\\"INVALID_INPUT\\\"}" }] }`.
Use `decision_explain_receipt` before its five-minute expiry. It returns
`RECEIPT_NOT_FOUND` after expiry, for an unknown ID, or from a different HTTP
bearer scope. The executable [MCP/CLI smoke](../../scripts/mcp-cli-smoke.mjs)
checks all five tool calls against the built stdio server.

## Stdio and loopback HTTP

Start offline stdio with `jev-fabric serve --transport stdio`. An MCP client
performs its normal initialize/tools/list/call sequence; the returned decision
is still advisory. Generated host files only wire this already-installed binary
and do not enable live mode.

HTTP is a separate loopback deployment surface: configure a bearer token by
environment *name* with `serve --transport http --token-env NAME`. It accepts
only `/mcp`, validates origin/host/protocol negotiation/authentication, bounds
body/deadline/concurrency, and derives receipt scope from authenticated bearer
material. Never put the token in an artifact. Live provider serving over HTTP
is rejected; see [native live operation](../providers/typesafe-native.md).

For HTTP, send `POST /mcp` with `Content-Type: application/json`, an accepted
`Accept` value (for example `application/json`), the expected MCP protocol
version after initialization, and `Authorization: Bearer <operator-token>`.
The listener accepts only the exact loopback path with no query; rejects
untrusted Origin/Host values, duplicate critical headers, chunked bodies, and
oversized uploads. The bearer value is never copied into receipts; its trusted
hash scopes receipt lookup across stateless exchanges.

# Experimental WebMCP advisory binding

WebMCP page metadata is untrusted input, not a capability grant. A trusted host must independently project the allowed HTTPS origin, frame identifier, tool name, and structural input schema, then bind them to a policy epoch and trusted state version. Jev Fabric emits only opaque advisory fingerprints; it does not return page descriptions, hints, output, or any browser/tool execution handle.

The adapter rejects cross-origin frames, changed frame/tool/schema values, page-supplied hints, descriptions, and output fields. The host must still perform user consent, authorization, origin enforcement, and any eventual browser or tool action outside this package. See the offline [example](../../examples/webmcp-action/README.md).

## Vercel `mcp-handler` bridge

Evidence: Vercel's official [`mcp-handler` WebMCP announcement](https://vercel.com/changelog/webmcp-mcp-handler) and [bridge documentation](https://github.com/vercel-labs/mcp-handler/blob/main/docs/WEBMCP.md), revalidated 2026-09-21.

Vercel's experimental bridge in `mcp-handler@2.2.0` can register an allowlisted subset of an MCP server's tools in the page and proxy calls back with the signed-in user's session cookies. Use `bindMcpHandlerWebMcpAdvisory` to bind one selected tool to:

- the exact same-origin `?webmcp-script` asset;
- an explicit, sorted allowlist whose complete surface is host-declared read-only;
- `credentials: "same-origin"`;
- an explicit host requirement to reject cookie-authenticated calls that are not same-origin; and
- the existing origin, frame, tool, schema, policy-epoch, and state-version contract.

The binding emits only fingerprints and `authority: "NONE"`. It does not verify cookies, install `mcp-handler`, fetch the bridge script, list tools, call a tool, or prove that the server middleware actually enforces `Sec-Fetch-Site`. Those remain host responsibilities.

The bridge's allowlist controls what is surfaced to the page, not what the MCP endpoint exposes to ordinary clients. `readOnlyHint` is page-observed metadata, not permission; Fabric requires an independent host declaration and still does not execute. `mcp-handler` returns tool output unchanged and does not automatically translate every MCP annotation into WebMCP trust or consequence hints, so keep outputs outside this binding and treat them as hostile input.

Where Jev is added downstream, use it as an additional bounded review signal over minimal state. Never let a low prompt-injection score clear a deterministic denial or confirmation requirement: TypeSafe's current [Jev 1.13 guidance](https://docs.typesafe.ai/model-jaggedness/jev-1.13) explicitly notes that adversarial state can move an answer.

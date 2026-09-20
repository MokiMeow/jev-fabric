# Experimental WebMCP advisory binding

WebMCP page metadata is untrusted input, not a capability grant. A trusted host must independently project the allowed HTTPS origin, frame identifier, tool name, and structural input schema, then bind them to a policy epoch and trusted state version. Jev Fabric emits only opaque advisory fingerprints; it does not return page descriptions, hints, output, or any browser/tool execution handle.

The adapter rejects cross-origin frames, changed frame/tool/schema values, page-supplied hints, descriptions, and output fields. The host must still perform user consent, authorization, origin enforcement, and any eventual browser or tool action outside this package. See the offline [example](../../examples/webmcp-action/README.md).

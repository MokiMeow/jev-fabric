# Browser assistance
Jev Fabric may advise a bounded next action such as “summarize visible content” or “ask the user before navigation.” The browser automation layer must independently enforce origin, action allowlists, user confirmation, and sensitive-data restrictions. Do not convert a route answer into a click, form submission, download, purchase, or login action.

See [browser-action](../../examples/browser-action/README.md).

For sites that deliberately expose page-owned tools, use the stricter
[experimental WebMCP boundary](webmcp-browser.md). WebMCP can reduce ambiguous
DOM discovery and interaction steps, but it does not make the page, network, or
provider intrinsically faster and its annotations are not authorization.

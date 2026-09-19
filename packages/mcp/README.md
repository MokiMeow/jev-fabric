# @mokimeow/jev-fabric-mcp

Advisory MCP server for [Jev Fabric](https://github.com/MokiMeow/jev-fabric).

## Install

`npm install @mokimeow/jev-fabric-mcp`

## Use

Import `createMcpServer` or `createHttpHandler` from the package root and inject a bounded runtime.

The server exposes read-only advisory tools; do not expose it as an authorization or execution endpoint.

Read the [repository documentation](https://github.com/MokiMeow/jev-fabric/tree/main/docs), [security boundary](https://github.com/MokiMeow/jev-fabric/tree/main/docs/security), and [Apache-2.0 license](https://github.com/MokiMeow/jev-fabric/blob/main/LICENSE). Requires Node.js >=22.14 and <25.

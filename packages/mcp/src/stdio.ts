import {
  serveStdio as serve,
  type StdioServerHandle,
  type ServeStdioOptions,
} from "@modelcontextprotocol/server/stdio";
import {
  createMcpServer,
  ReceiptRepository,
  type McpServerOptions,
} from "./index.js";

export interface StdioOptions extends McpServerOptions {
  readonly transport?: ServeStdioOptions["transport"];
}

/** Serves newline-framed stdio MCP without logging application data to stdout. */
export function serveStdio(options: StdioOptions): StdioServerHandle {
  // A local stdio process is one trusted boundary. Sharing this finite store
  // makes reconnect/discover exchanges behave consistently without deriving
  // identity from model-provided tool input.
  const receipts =
    options.receiptStore ??
    new ReceiptRepository(options.maxReceipts ?? 100, options.now);
  return serve(() => createMcpServer({ ...options, receiptStore: receipts }), {
    // v2's Node StdioClientTransport deliberately opens with the compatible
    // initialize exchange. HTTP remains modern-only; stdio must serve this
    // SDK-supported connection era for local interoperability.
    legacy: "serve",
    ...(options.transport === undefined
      ? {}
      : { transport: options.transport }),
    onerror: () =>
      options.logger?.error("mcp_error", { code: "STDIO_PROTOCOL_ERROR" }),
    maxSubscriptions: 0,
  });
}

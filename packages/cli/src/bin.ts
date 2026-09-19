#!/usr/bin/env node
import { once } from "node:events";
import { startHttpServer, startStdioServer, runCli } from "./index.js";
import { installShutdownHandlers } from "./lifecycle.js";

const args = process.argv.slice(2);
const result = await runCli(args);
const serving = result.exitCode === 0 && result.serve !== undefined;
const transport = result.serve?.transport;
// stdout belongs exclusively to MCP framing for stdio.
if (!serving || transport !== "stdio") {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}
if (result.exitCode !== 0) process.exitCode = result.exitCode;
else if (serving) {
  let closeServer: (() => Promise<void>) | undefined;
  const lifecycle = installShutdownHandlers({
    close: async () => closeServer?.(),
  });
  if (transport === "stdio") {
    // Resolve the actual credential exactly once, only after runCli has
    // accepted the direct --live flag and every static bound. It never enters
    // configuration JSON, stdout, stderr, or MCP receipts.
    const live = result.serve?.live;
    const apiKey = live ? process.env[live.credentialEnv] : undefined;
    if (live) {
      if (!apiKey) {
        process.stderr.write(
          "LIVE_CREDENTIAL_REQUIRED: credential environment variable is not present\n",
        );
        process.exitCode = 2;
        lifecycle.dispose();
      } else {
        const handle = startStdioServer({ live, apiKey });
        closeServer = () => handle.close();
      }
    } else {
      const handle = startStdioServer();
      closeServer = () => handle.close();
    }
  } else {
    const envName = result.serve?.tokenEnv;
    const token = envName ? process.env[envName] : undefined;
    if (token) {
      const server = startHttpServer(result.serve?.port ?? 0, token);
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("loopback HTTP server has no TCP address");
      process.stderr.write(
        `${JSON.stringify({
          event: "jev-fabric-http-listening",
          endpoint: `http://127.0.0.1:${address.port}/mcp`,
        })}\n`,
      );
      closeServer = () =>
        new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
    }
  }
  // Keep this binding live so the signal listener is retained for the server.
  void lifecycle;
}

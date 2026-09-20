import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  APIUserAbortError,
  TypeSafeClient,
  noul,
  type Fetch,
} from "@typesafe-ai/sdk";
import { pinnedTypeSafeFetch } from "../../src/transport.js";

const controller = new AbortController();
const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.flushHeaders();
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

try {
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("loopback server address unavailable");
  const fetchAfterHeaders: Fetch = async (input, init) => {
    const response = await pinnedTypeSafeFetch(input, init);
    setImmediate(() => controller.abort());
    return response;
  };
  const client = new TypeSafeClient({
    apiKey: "not-a-credential",
    baseURL: `http://127.0.0.1:${address.port}`,
    fetch: fetchAfterHeaders,
    retry: { maxRetries: 0 },
  });
  await assert.rejects(
    client.systemOne(
      { state: "synthetic", questions: { ok: noul("Is this synthetic?") } },
      { signal: controller.signal },
    ),
    APIUserAbortError,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

console.log("PASS cancellation remained handled");

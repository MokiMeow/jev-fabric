import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import {
  createPinnedVercelGatewayJevClient,
  VERCEL_GATEWAY_JEV_MODEL,
} from "../src/gateway-client.js";

describe("pinned Vercel Gateway SDK client", () => {
  it("emits the documented TypeSafe path, bearer credential, and Jev model", async () => {
    let requestCount = 0;
    let receivedMethod: string | undefined;
    let receivedPath: string | undefined;
    let receivedAuthorization: string | undefined;
    let receivedBody: unknown;
    const server = createServer((request, response) => {
      requestCount += 1;
      receivedMethod = request.method;
      receivedPath = request.url;
      receivedAuthorization = request.headers.authorization;
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            model: VERCEL_GATEWAY_JEV_MODEL,
            answers: {
              safe: { type: "noul", noul: 0.9 },
            },
            usage: { input_tokens: 7, output_tokens: 0 },
          }),
        );
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new Error("loopback server address unavailable");
      const client = createPinnedVercelGatewayJevClient(
        "gateway-test-key",
        `http://127.0.0.1:${address.port}/typesafe`,
      );

      await expect(
        client.systemOne({
          state: "read-only research request",
          questions: {
            safe: {
              type: "noul",
              instructions: "Is this request read-only?",
            },
          },
        }),
      ).resolves.toMatchObject({ model: VERCEL_GATEWAY_JEV_MODEL });

      expect(requestCount).toBe(1);
      expect(receivedMethod).toBe("POST");
      expect(receivedPath).toBe("/typesafe/v1/systemone");
      expect(receivedAuthorization).toBe("Bearer gateway-test-key");
      expect(receivedBody).toMatchObject({
        model: VERCEL_GATEWAY_JEV_MODEL,
        state: "read-only research request",
        questions: {
          safe: {
            type: "noul",
            instructions: "Is this request read-only?",
          },
        },
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});

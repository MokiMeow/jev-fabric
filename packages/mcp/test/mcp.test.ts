import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import {
  createHttpHandler,
  createMcpServer,
  ReceiptRepository,
  toolNames,
} from "../src/index.js";

describe("MCP advisory surface", () => {
  it("exposes exactly the five approved decision tools", () => {
    expect(toolNames).toEqual([
      "decision_evaluate_pack",
      "decision_route",
      "decision_rank",
      "decision_verify",
      "decision_explain_receipt",
    ]);
    expect(createMcpServer).toBeTypeOf("function");
  });

  it("discovers the fixed tools through the real v2 client/server wire", async () => {
    const runtime = {
      evaluate: async () => {
        throw new Error("not invoked");
      },
    };
    const server = createMcpServer({ runtime });
    const client = new Client({ name: "conformance", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    expect(
      (await client.listTools()).tools.map((tool) => tool.name).sort(),
    ).toEqual([...toolNames].sort());
    await Promise.all([client.close(), server.close()]);
  });

  it("calls every decision-only tool with structured results", async () => {
    const runtime = {
      evaluate: async () => ({
        semantic: {
          status: "decision",
          proposedOutcome: "allow",
          metadata: {},
        },
        receipt: {
          schemaVersion: "1",
          decisionId: "decision-test",
          stateHash: "state",
          scopeHash: "scope",
          packVersion: "1",
          policyVersion: "1",
          providerId: "test",
          model: "test",
          probabilitySemantics: "synthetic",
          answers: [],
          outcome: "allow",
          reasonCodes: ["TEST"],
          cache: "bypass",
          fallback: "none",
          latencyMs: 0,
          redacted: true,
        },
        accounting: {},
      }),
    };
    const server = createMcpServer({ runtime: runtime as never });
    const client = new Client({ name: "conformance", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    const input = {
      state: {
        candidates: [
          { id: "a", description: "A" },
          { id: "b", description: "B" },
        ],
      },
      tenantId: "tenant",
      action: "read",
      knownActions: ["read"],
    };
    let opaqueId = "";
    for (const name of [
      "decision_evaluate_pack",
      "decision_route",
      "decision_rank",
      "decision_verify",
    ] as const) {
      const result = await client.callTool({
        name,
        arguments:
          name === "decision_evaluate_pack"
            ? { ...input, pack: "route" }
            : input,
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ advisory: true });
      opaqueId = (
        result.structuredContent as { receipt: { decisionId: string } }
      ).receipt.decisionId;
    }
    const receipt = await client.callTool({
      name: "decision_explain_receipt",
      arguments: {
        decisionId: opaqueId,
      },
    });
    expect(receipt.structuredContent).toMatchObject({ advisory: true });
    await Promise.all([client.close(), server.close()]);
  });

  it("fails closed at the stateless HTTP boundary", async () => {
    const runtime = {
      evaluate: async () => {
        throw new Error("not invoked");
      },
    };
    const handler = createHttpHandler({ runtime, bearerToken: "a".repeat(32) });
    const unauthorized = await handler.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { host: "localhost", "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(unauthorized.status).toBe(401);
    const badHost = await handler.fetch(
      new Request("http://evil.test/mcp", {
        method: "POST",
        headers: {
          host: "evil.test",
          authorization: `Bearer ${"a".repeat(32)}`,
          "content-type": "application/json",
        },
        body: "{}",
      }),
    );
    expect(badHost.status).toBe(421);
    const badType = await handler.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          host: "localhost",
          authorization: `Bearer ${"a".repeat(32)}`,
          "content-type": "text/plain",
        },
        body: "{}",
      }),
    );
    expect(badType.status).toBe(415);
    const badAccept = await handler.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          host: "localhost",
          authorization: `Bearer ${"a".repeat(32)}`,
          "content-type": "application/json",
          accept: "text/event-stream",
        },
        body: "{}",
      }),
    );
    expect(badAccept.status).toBe(406);
    for (const accept of [
      "application/json;q=0",
      "application/*; q=0, text/plain;q=1",
      "application/json;q=1.001",
      "application/json;q=bogus",
    ]) {
      const rejected = await handler.fetch(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: {
            host: "localhost",
            authorization: `Bearer ${"a".repeat(32)}`,
            "content-type": "application/json",
            accept,
          },
          body: "{}",
        }),
      );
      expect(rejected.status).toBe(406);
    }
    const quotedAccept = await handler.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          host: "localhost",
          authorization: `Bearer ${"a".repeat(32)}`,
          "content-type": "application/json",
          accept: 'text/plain;q=0.1, application/json; q="0.5"',
        },
        body: "{}",
      }),
    );
    expect(quotedAccept.status).not.toBe(406);
    const badOrigin = await handler.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          host: "localhost",
          origin: "https://evil.invalid",
          authorization: `Bearer ${"a".repeat(32)}`,
          "content-type": "application/json",
        },
        body: "{}",
      }),
    );
    expect(badOrigin.status).toBe(403);
    const chunked = await handler.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          host: "localhost",
          authorization: `Bearer ${"a".repeat(32)}`,
          "content-type": "application/json",
          "transfer-encoding": "chunked",
        },
        body: "{}",
      }),
    );
    expect(chunked.status).toBe(400);
    const limited = createHttpHandler({
      runtime,
      bearerToken: "a".repeat(32),
      maxBodyBytes: 2,
    });
    const oversized = await limited.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          host: "localhost",
          authorization: `Bearer ${"a".repeat(32)}`,
          "content-type": "application/json",
          "content-length": "3",
        },
        body: "{} ",
      }),
    );
    expect(oversized.status).toBe(413);
    await limited.close();
    await handler.close();
  });

  it("keeps HTTP receipts across exchanges but scopes them to authenticated bearer identity", async () => {
    let calls = 0;
    const runtime = {
      evaluate: async () => {
        calls += 1;
        return {
          semantic: {
            status: "decision",
            proposedOutcome: "allow",
            metadata: {},
          },
          receipt: {
            schemaVersion: "1",
            decisionId: "predictable",
            stateHash: "state",
            scopeHash: "scope",
            packVersion: "1",
            policyVersion: "1",
            providerId: "test",
            model: "test",
            probabilitySemantics: "synthetic",
            answers: [],
            outcome: "allow",
            reasonCodes: [],
            cache: "bypass",
            fallback: "none",
            latencyMs: 0,
            redacted: true,
          },
          accounting: {},
        };
      },
    };
    const firstToken = "a".repeat(32);
    const secondToken = "b".repeat(32);
    const handler = createHttpHandler({
      runtime: runtime as never,
      authorization: { authorize: async () => true },
    });
    const call = async (token: string, name: string, arguments_: object) => {
      const response = await handler.fetch(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: {
            host: "localhost",
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            accept: "application/json",
            "mcp-protocol-version": "2026-07-28",
            "mcp-method": "tools/call",
            "mcp-name": name,
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: `${name}-${token.slice(0, 1)}`,
            method: "tools/call",
            params: {
              name,
              arguments: arguments_,
              _meta: {
                "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                "io.modelcontextprotocol/clientCapabilities": {},
              },
            },
          }),
        }),
      );
      return {
        status: response.status,
        body: (await response.json()) as {
          result?: {
            structuredContent?: { receipt?: { decisionId?: string } };
          };
        },
      };
    };
    const evaluated = await call(firstToken, "decision_route", {
      state: {},
      tenantId: "model-supplied-tenant",
      action: "read",
      knownActions: ["read"],
    });
    expect(evaluated.status).toBe(200);
    expect(calls).toBe(1);
    const id = evaluated.body.result?.structuredContent?.receipt?.decisionId;
    expect(id).toMatch(/^receipt_/u);
    expect(
      (await call(firstToken, "decision_explain_receipt", { decisionId: id }))
        .status,
    ).toBe(200);
    const isolated = await call(secondToken, "decision_explain_receipt", {
      decisionId: id,
    });
    expect(isolated.status).toBe(200);
    expect(JSON.stringify(isolated.body)).toContain("RECEIPT_NOT_FOUND");
    await handler.close();
  });

  it("rejects HTTP secret state before the injected runtime receives it", async () => {
    let calls = 0;
    const secret = "opaque-custom-credential";
    const handler = createHttpHandler({
      runtime: {
        evaluate: async () => {
          calls += 1;
          throw new Error("unexpected");
        },
      } as never,
      bearerToken: "a".repeat(32),
    });
    for (const key of [
      "api⁄key",
      "api∕key",
      "api⧸key",
      "client∕secret",
      "ɑpi key",
      "api..__//key",
      "API_KEY",
      "ordinary@value",
      "こんにちは",
      "a".repeat(129),
    ]) {
      const response = await handler.fetch(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: {
            host: "localhost",
            authorization: `Bearer ${"a".repeat(32)}`,
            "content-type": "application/json",
            "mcp-protocol-version": "2026-07-28",
            "mcp-method": "tools/call",
            "mcp-name": "decision_route",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "decision_route",
              arguments: {
                state: { [key]: secret },
                tenantId: "untrusted",
                action: "read",
                knownActions: ["read"],
              },
              _meta: {
                "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                "io.modelcontextprotocol/clientCapabilities": {},
              },
            },
          }),
        }),
      );
      expect(response.status, key).toBe(200);
      const responseText = await response.text();
      expect(responseText, key).not.toContain(secret);
      expect(responseText, key).not.toContain(key);
    }
    expect(calls).toBe(0);
    await handler.close();
  });

  it("returns cancelled and unavailable errors without leaking runtime secrets", async () => {
    const secret = "bearerRuntimeSecret123456";
    const runtime = {
      evaluate: async () => {
        throw new Error(secret);
      },
    };
    const server = createMcpServer({ runtime: runtime as never });
    const client = new Client({ name: "redaction", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    const unavailable = await client.callTool({
      name: "decision_route",
      arguments: {
        state: {},
        tenantId: "tenant",
        action: "read",
        knownActions: ["read"],
      },
    });
    expect(unavailable.isError).toBe(true);
    expect(JSON.stringify(unavailable)).not.toContain(secret);
    await Promise.all([client.close(), server.close()]);
  });

  it("rejects secret-shaped state before the runtime is invoked or an error can echo it", async () => {
    let calls = 0;
    const server = createMcpServer({
      runtime: {
        evaluate: async () => {
          calls += 1;
          throw new Error("must not run");
        },
      } as never,
    });
    const client = new Client({ name: "secret-guard", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    for (const secret of [
      "Bearer attackersecret-123456789",
      "apikey_1234567890abcdef",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature-part",
    ]) {
      const result = await client.callTool({
        name: "decision_route",
        arguments: {
          state: { harmless: secret },
          tenantId: "attacker-supplied-tenant",
          action: "read",
          knownActions: ["read"],
        },
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain(secret);
    }
    for (const key of [
      "api key",
      "api.key",
      "api/key",
      "api..__//key",
      "API_KEY",
      "client.secret",
      "x api key",
      "api⁄key",
      "api∕key",
      "api⧸key",
      "client∕secret",
      "ɑpi key",
      "ＡＰＩ　ＫＥＹ",
      "аpi\u200bkey",
      "ordinary@value",
      "ordinary!value",
      "こんにちは",
      "a".repeat(129),
    ]) {
      const secret = "opaque-custom-credential";
      const result = await client.callTool({
        name: "decision_route",
        arguments: {
          state: { nested: { [key]: secret } },
          tenantId: "attacker-supplied-tenant",
          action: "read",
          knownActions: ["read"],
        },
      });
      expect(result.isError, key).toBe(true);
      expect(JSON.stringify(result), key).not.toContain(secret);
      expect(JSON.stringify(result), key).not.toContain(key);
    }
    expect(calls).toBe(0);
    await Promise.all([client.close(), server.close()]);
  });

  it("uses opaque receipt IDs and isolates a shared store by trusted scope", async () => {
    const store = new ReceiptRepository(10);
    const runtime = {
      evaluate: async () => ({
        semantic: {
          status: "decision",
          proposedOutcome: "allow",
          metadata: {},
        },
        receipt: {
          schemaVersion: "1",
          decisionId: "deterministic-state-id",
          stateHash: "state",
          scopeHash: "scope",
          packVersion: "1",
          policyVersion: "1",
          providerId: "test",
          model: "test",
          probabilitySemantics: "synthetic",
          answers: [],
          outcome: "allow",
          reasonCodes: [],
          cache: "bypass",
          fallback: "none",
          latencyMs: 0,
          redacted: true,
        },
        accounting: {},
      }),
    };
    const first = createMcpServer({
      runtime: runtime as never,
      receiptStore: store,
      receiptScope: "trusted-a",
    });
    const client = new Client({ name: "scope-a", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      first.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    const evaluated = await client.callTool({
      name: "decision_route",
      arguments: {
        state: {},
        tenantId: "untrusted-tenant",
        action: "read",
        knownActions: ["read"],
      },
    });
    const id = (
      evaluated.structuredContent as { receipt: { decisionId: string } }
    ).receipt.decisionId;
    expect(id).toMatch(/^receipt_[A-Za-z0-9_-]{32}$/u);
    expect(id).not.toContain("deterministic");
    const found = await client.callTool({
      name: "decision_explain_receipt",
      arguments: { decisionId: id },
    });
    expect(found.isError).not.toBe(true);
    await Promise.all([client.close(), first.close()]);
    const isolated = createMcpServer({
      runtime: runtime as never,
      receiptStore: store,
      receiptScope: "trusted-b",
    });
    const other = new Client({ name: "scope-b", version: "1" });
    const [otherTransport, isolatedTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      isolated.connect(isolatedTransport),
      other.connect(otherTransport),
    ]);
    expect(
      (
        await other.callTool({
          name: "decision_explain_receipt",
          arguments: { decisionId: id },
        })
      ).isError,
    ).toBe(true);
    await Promise.all([other.close(), isolated.close()]);
  });

  it("rejects bounded-input and oversized-receipt bombs before cache insertion", async () => {
    let calls = 0;
    const runtime = {
      evaluate: async () => {
        calls += 1;
        return {
          semantic: { status: "decision", metadata: {} },
          receipt: {
            decisionId: "oversized",
            payload: "x".repeat(130_000),
          },
          accounting: {},
        };
      },
    };
    const server = createMcpServer({ runtime: runtime as never });
    const client = new Client({ name: "bounds", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    const base = {
      pack: "route",
      tenantId: "tenant",
      action: "read",
      knownActions: ["read"],
    };
    const bomb = await client.callTool({
      name: "decision_evaluate_pack",
      arguments: { ...base, state: { nested: "x".repeat(5_000) } },
    });
    expect(bomb.isError).toBe(true);
    expect(calls).toBe(0);
    const oversized = await client.callTool({
      name: "decision_evaluate_pack",
      arguments: { ...base, state: {} },
    });
    expect(oversized.isError).toBe(true);
    expect(calls).toBe(1);
    const cached = await client.callTool({
      name: "decision_explain_receipt",
      arguments: { decisionId: "oversized" },
    });
    expect(cached.isError).toBe(true);
    await Promise.all([client.close(), server.close()]);
  });

  it("bounds injected authorization with the caller deadline and frees its slot", async () => {
    let calls = 0;
    let authorizationSignal: AbortSignal | undefined;
    const handler = createHttpHandler({
      runtime: {
        evaluate: async () => {
          calls += 1;
          throw new Error("runtime must not run while authorization stalls");
        },
      } as never,
      bearerToken: "a".repeat(32),
      deadlineMs: 20,
      maxConcurrency: 1,
      authorization: {
        authorize: async (_token, _request, signal) => {
          authorizationSignal = signal;
          if (calls === 0) return new Promise<boolean>(() => undefined);
          return true;
        },
      },
    });
    const request = () =>
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          host: "localhost",
          authorization: `Bearer ${"a".repeat(32)}`,
          "content-type": "application/json",
        },
        body: "{}",
      });
    const stalled = await handler.fetch(request());
    expect(stalled.status).toBe(408);
    expect(authorizationSignal?.aborted).toBe(true);
    expect(calls).toBe(0);
    calls = 1;
    const released = await handler.fetch(request());
    expect(released.status).not.toBe(429);
    await handler.close();
  });
});

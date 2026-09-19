import { once } from "node:events";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { builtinPacks } from "@mokimeow/jev-fabric-packs";
import type { DecisionProvider } from "@mokimeow/jev-fabric-protocol";
import {
  createLiveMcpRuntime,
  createNodeHttpServer,
  runCli,
} from "../src/index.js";
import { installShutdownHandlers } from "../src/lifecycle.js";

async function waitFor(predicate: () => boolean, timeoutMs = 1_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
async function loopbackRequest(
  port: number,
  method: string,
  headers: Record<string, string>,
  body = "{}",
  path = "/mcp",
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers,
        setHost: false,
      },
      (response) => {
        let output = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          output += chunk;
        });
        response.once("end", () =>
          resolve({ status: response.statusCode ?? 0, body: output }),
        );
      },
    );
    request.once("error", reject);
    request.end(body);
  });
}
async function rawLoopbackStatus(
  port: number,
  payload: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(port, "127.0.0.1");
    let output = "";
    socket.once("error", reject);
    socket.on("data", (chunk) => {
      output += String(chunk);
      const status = /^HTTP\/1\.1\s+(\d+)/u.exec(output)?.[1];
      if (status) {
        socket.destroy();
        resolve(Number(status));
      }
    });
    socket.once("connect", () => socket.write(payload));
  });
}

describe("CLI", () => {
  it("handles repeated interruption signals once and reports the stable exit code", async () => {
    const target = new EventEmitter();
    let closes = 0;
    const exits: number[] = [];
    installShutdownHandlers({
      target,
      close: async () => {
        closes += 1;
      },
      setExitCode: (code) => exits.push(code),
    });
    target.emit("SIGINT");
    target.emit("SIGTERM");
    await waitFor(() => exits.length === 1);
    expect(closes).toBe(1);
    expect(exits).toEqual([4]);
    expect(target.listenerCount("SIGINT")).toBe(0);
    expect(target.listenerCount("SIGTERM")).toBe(0);
  });

  it("has a stable offline doctor result", async () => {
    const result = await runCli(["doctor", "--json"], { env: {} });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ command: "doctor" });
  });

  it("rejects incomplete live budgets before any operation", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("network trap reached");
    };
    try {
      const result = await runCli(["evaluate", "--live", "--json"], {
        env: { API_KEY: "not-to-be-shown" },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toContain("INVALID_ARGUMENT");
      expect(result.stdout).not.toContain("not-to-be-shown");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("admits live stdio only with a pinned native model, bounded price ceiling, and direct flag", async () => {
    const args = [
      "serve",
      "--transport",
      "stdio",
      "--live",
      "--provider",
      "typesafe-native",
      "--model",
      "jev-1.13.0",
      "--credential-env",
      "LIVE_NATIVE_KEY",
      "--tenant-id",
      "operator-tenant",
      "--action",
      "operator-route",
      "--max-calls",
      "2",
      "--max-input-tokens",
      "1000",
      "--max-dollars",
      "1.00",
      "--input-price-per-million",
      "100.00",
      "--deadline-ms",
      "1000",
      "--json",
    ];
    const result = await runCli(args, { env: { LIVE_NATIVE_KEY: "not-read" } });
    expect(result.exitCode).toBe(0);
    expect(result.serve?.live).toMatchObject({
      provider: "typesafe-native",
      model: "jev-1.13.0",
      credentialEnv: "LIVE_NATIVE_KEY",
    });
    expect(result.stdout).not.toContain("not-read");
    const missingDirectFlag = await runCli(
      args.filter((value) => value !== "--live"),
      {
        env: { LIVE_NATIVE_KEY: "not-read" },
      },
    );
    expect(missingDirectFlag.serve?.live).toBeUndefined();
    const overCost = await runCli(
      args.map((value) => (value === "100.00" ? "1000000" : value)),
      { env: {} },
    );
    expect(overCost.exitCode).toBe(2);
    const httpArgs = [...args];
    httpArgs[2] = "http";
    const http = await runCli(httpArgs, { env: {} });
    expect(http.stdout).toContain("LIVE_HTTP_FORBIDDEN");
  });

  it("uses one injected native-shaped provider call and overrides tool identity/policy", async () => {
    let calls = 0;
    let seenTenant = "";
    let seenAction = "";
    const provider: DecisionProvider = {
      id: "typesafe-native",
      capabilities: {
        questionTypes: ["choice"],
        probabilitySemantics: ["native_calibrated"],
        maxQuestions: 100,
      },
      evaluate: async (request) => {
        calls += 1;
        const question = request.questions[0];
        if (question?.type !== "choice") throw new Error("expected choice");
        const selected = question.options[0] ?? "no_match";
        return {
          requestId: request.id,
          providerId: "typesafe-native",
          model: "jev-1.13.0",
          probabilitySemantics: "native_calibrated",
          answers: [
            {
              questionId: question.id,
              type: "choice",
              selected,
              probabilities: Object.fromEntries(
                question.options.map((value) => [
                  value,
                  value === selected ? 1 : 0,
                ]),
              ),
            },
          ],
        };
      },
    };
    const runtime = createLiveMcpRuntime(
      {
        provider: "typesafe-native",
        model: "jev-1.13.0",
        credentialEnv: "LIVE_NATIVE_KEY",
        tenantId: "fixed-tenant",
        action: "fixed-route",
        maxCalls: 1,
        maxInputTokens: 100,
        maxDollarsMicros: 1_000_000n,
        inputPricePerMillionMicros: 1_000_000n,
        deadlineMs: 1000,
      },
      "fake-secret",
      { create: () => provider },
    );
    const pack = builtinPacks.find((entry) => entry.manifest.id === "route");
    if (!pack) throw new Error("route pack missing");
    const result = await runtime.evaluate({
      pack,
      state: {
        candidates: [
          { id: "a", description: "A" },
          { id: "b", description: "B" },
        ],
      },
      tenantId: "agent-tenant",
      action: "agent-action",
      knownActions: ["agent-action"],
      trustedRisk: 100,
    });
    seenTenant = result.receipt.scopeHash;
    seenAction = result.receipt.reasonCodes.join(",");
    expect(calls).toBe(1);
    expect(result.receipt.providerId).toBe("typesafe-native");
    expect(result.receipt.probabilitySemantics).toBe("native_calibrated");
    expect(result.semantic.proposedOutcome).toBe("route");
    // The live wrapper intentionally supplies no authorization, so policy
    // fails closed even when the advisory semantic answer selects a route.
    expect(result.receipt.outcome).toBe("deny");
    expect(seenTenant).not.toContain("agent-tenant");
    expect(seenAction).not.toContain("agent-action");
  });

  it("resolves HTTP token references once with flag, config, environment precedence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jev-cli-config-"));
    try {
      await writeFile(
        join(directory, "jev-fabric.json"),
        JSON.stringify({
          tokenEnv: "CONFIG_TOKEN",
          bind: "loopback",
          port: 43123,
        }),
      );
      const environment = {
        CONFIG_TOKEN: "a".repeat(32),
        ENV_TOKEN: "b".repeat(32),
        FLAG_TOKEN: "c".repeat(32),
        JEV_FABRIC_TOKEN_ENV: "ENV_TOKEN",
      };
      const configured = await runCli(["serve", "--transport", "http"], {
        cwd: directory,
        env: environment,
      });
      expect(configured.serve).toEqual({
        transport: "http",
        tokenEnv: "CONFIG_TOKEN",
        port: 43123,
      });
      const flagged = await runCli(
        ["serve", "--transport", "http", "--token-env", "FLAG_TOKEN"],
        { cwd: directory, env: environment },
      );
      expect(flagged.serve?.tokenEnv).toBe("FLAG_TOKEN");
      await rm(join(directory, "jev-fabric.json"));
      const environmentOnly = await runCli(["serve", "--transport", "http"], {
        cwd: directory,
        env: environment,
      });
      expect(environmentOnly.serve?.tokenEnv).toBe("ENV_TOKEN");
      expect(environmentOnly.serve?.port).toBe(0);
      const invalidPort = await runCli(
        ["serve", "--transport", "http", "--port", "70000", "--json"],
        { cwd: directory, env: environment },
      );
      expect(invalidPort.stdout).toContain("INVALID_ARGUMENT");
      const publicBind = await runCli(
        ["serve", "--transport", "http", "--public", "--secure-mode", "--json"],
        { cwd: directory, env: environment },
      );
      expect(publicBind.stdout).toContain("PUBLIC_BIND_UNSUPPORTED");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("aborts slow loopback work after a fully uploaded client disconnect", async () => {
    let signal: AbortSignal | undefined;
    let started = false;
    const server = createNodeHttpServer({
      handler: {
        fetch: async (request) => {
          signal = request.signal;
          started = true;
          await new Promise<void>((resolve) =>
            request.signal.addEventListener("abort", () => resolve(), {
              once: true,
            }),
          );
          return new Response("cancelled", { status: 408 });
        },
      },
    });
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("no port");
      const socket = createConnection(address.port, "127.0.0.1");
      await once(socket, "connect");
      socket.write(
        "POST /mcp HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}",
      );
      await waitFor(() => started);
      socket.destroy();
      await waitFor(() => signal?.aborted === true);
      expect(signal?.aborted).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("enforces one deadline from listener entry through a slow handler", async () => {
    let observed: AbortSignal | undefined;
    const server = createNodeHttpServer({
      deadlineMs: 20,
      handler: {
        fetch: async (request) => {
          observed = request.signal;
          await new Promise((resolve) => setTimeout(resolve, 50));
          return new Response("late", { status: 299 });
        },
      },
    });
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("no port");
      const response = await loopbackRequest(address.port, "POST", {
        host: "localhost",
        "content-type": "application/json",
        "content-length": "2",
      });
      expect(response.status).toBe(408);
      expect(observed?.aborted).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("bounds a non-cooperative handler, observes late rejection, and releases admission", async () => {
    let observed: AbortSignal | undefined;
    let calls = 0;
    let rejectLate: ((error: Error) => void) | undefined;
    let unhandled = 0;
    const onUnhandled = () => {
      unhandled += 1;
    };
    process.on("unhandledRejection", onUnhandled);
    const server = createNodeHttpServer({
      deadlineMs: 20,
      maxConcurrency: 1,
      handler: {
        fetch: async (request) => {
          calls += 1;
          if (calls > 1) return new Response("admitted", { status: 299 });
          observed = request.signal;
          return new Promise<Response>((_resolve, reject) => {
            rejectLate = reject;
          });
        },
      },
    });
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("no port");
      const startedAt = Date.now();
      const expired = await loopbackRequest(address.port, "POST", {
        host: "localhost",
        "content-type": "application/json",
        "content-length": "2",
      });
      expect(expired.status).toBe(408);
      expect(Date.now() - startedAt).toBeLessThan(200);
      expect(observed?.aborted).toBe(true);
      rejectLate?.(new Error("late handler failure"));
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(unhandled).toBe(0);
      const admitted = await loopbackRequest(address.port, "POST", {
        host: "localhost",
        "content-type": "application/json",
        "content-length": "2",
      });
      expect(admitted.status).toBe(299);
      expect(calls).toBe(2);
    } finally {
      process.removeListener("unhandledRejection", onUnhandled);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("releases admission when a disconnected client leaves a handler unsettled", async () => {
    let calls = 0;
    let observed: AbortSignal | undefined;
    const server = createNodeHttpServer({
      maxConcurrency: 1,
      handler: {
        fetch: async (request) => {
          calls += 1;
          if (calls > 1) return new Response("admitted", { status: 299 });
          observed = request.signal;
          return new Promise<Response>(() => undefined);
        },
      },
    });
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("no port");
      const socket = createConnection(address.port, "127.0.0.1");
      await once(socket, "connect");
      socket.write(
        "POST /mcp HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}",
      );
      await waitFor(() => observed !== undefined);
      socket.destroy();
      await waitFor(() => observed?.aborted === true);
      const admitted = await loopbackRequest(address.port, "POST", {
        host: "localhost",
        "content-type": "application/json",
        "content-length": "2",
      });
      expect(admitted.status).toBe(299);
      expect(calls).toBe(2);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("admits before upload and exposes only the exact /mcp endpoint", async () => {
    let calls = 0;
    const server = createNodeHttpServer({
      maxConcurrency: 1,
      handler: {
        fetch: async () => {
          calls += 1;
          return new Response("ok");
        },
      },
    });
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("no port");
      const held = createConnection(address.port, "127.0.0.1");
      await once(held, "connect");
      held.write(
        "POST /mcp HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n",
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      const saturated = await loopbackRequest(address.port, "POST", {
        host: "localhost",
        "content-type": "application/json",
        "content-length": "2",
      });
      expect(saturated.status).toBe(429);
      expect(calls).toBe(0);
      held.destroy();
      await new Promise((resolve) => setTimeout(resolve, 10));
      for (const path of ["/", "/not-mcp", "/%6dcp", "/mcp?unexpected=1"]) {
        const result = await loopbackRequest(
          address.port,
          "POST",
          {
            host: "localhost",
            "content-type": "application/json",
            "content-length": "2",
          },
          "{}",
          path,
        );
        expect(result.status).toBe(404);
      }
      expect(calls).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("enforces listener method, early body limit, and version boundaries", async () => {
    const token = "t".repeat(32);
    const server = createNodeHttpServer({ bearerToken: token });
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("no port");
      const common = {
        host: "localhost",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "content-length": "2",
      };
      expect(
        (await loopbackRequest(address.port, "GET", common, "")).status,
      ).toBe(405);
      await expect(
        loopbackRequest(
          address.port,
          "POST",
          { ...common, "content-length": "262145" },
          "x".repeat(262_145),
        ),
      ).rejects.toMatchObject({ code: "ECONNRESET" });
      const rawHeaders = [
        "POST /mcp HTTP/1.1",
        "Host: localhost",
        `Authorization: Bearer ${token}`,
        `Authorization: Bearer ${token}`,
        "Content-Type: application/json",
        "Content-Length: 2",
        "",
        "{}",
      ].join("\r\n");
      expect(await rawLoopbackStatus(address.port, rawHeaders)).toBe(400);
      const chunked = [
        "POST /mcp HTTP/1.1",
        "Host: localhost",
        `Authorization: Bearer ${token}`,
        "Content-Type: application/json",
        "Transfer-Encoding: chunked",
        "",
        "0",
        "",
      ].join("\r\n");
      expect(await rawLoopbackStatus(address.port, chunked)).toBe(400);
      const wrongVersion = await loopbackRequest(address.port, "POST", {
        ...common,
        "mcp-protocol-version": "not-a-version",
      });
      expect(wrongVersion.status).toBeGreaterThanOrEqual(400);
      expect(wrongVersion.body).not.toContain(token);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("uses the configured node preflight body cap before buffering", async () => {
    const server = createNodeHttpServer({
      maxBodyBytes: 1,
      handler: { fetch: async () => new Response("unexpected") },
    });
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("no port");
      const response = await loopbackRequest(address.port, "POST", {
        host: "localhost",
        authorization: "Bearer aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "content-type": "application/json",
        "content-length": "2",
      });
      expect(response.status).toBe(413);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

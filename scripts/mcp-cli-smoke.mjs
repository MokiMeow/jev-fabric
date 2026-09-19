import { once } from "node:events";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// With an installed-root argument this smoke never reads mutable workspace
// dist output. That is essential when concurrent `pnpm pack` processes clean
// package dist directories while staging archives.
const installedRoot = process.argv[2];
const root = installedRoot ? resolve(installedRoot) : process.cwd();
const cli = installedRoot
  ? resolve(root, "node_modules/@mokimeow/jev-fabric-cli/dist/bin.js")
  : resolve(root, "packages/cli/dist/bin.js");
if (!existsSync(cli))
  throw new Error(
    installedRoot
      ? "installed CLI is missing from packed consumer"
      : "build the CLI before its MCP smoke test",
  );
// Keep this smoke dependency-free: an artifact consumer should not need the
// MCP client SDK just to prove the CLI's stdio wire protocol. JSON-RPC over
// stdio is newline-delimited, so this tiny harness also ensures a packed
// consumer can be tested while concurrent `pnpm pack` runs mutate workspace
// dist directories.
function startStdioRpc() {
  const child = spawn(
    process.execPath,
    [cli, "serve", "--transport", "stdio"],
    {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let buffer = "";
  let stderr = "";
  let nextId = 1;
  const pending = new Map();
  const failPending = (error) => {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    pending.clear();
  };
  child.stdout.on("data", (chunk) => {
    buffer += String(chunk);
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        failPending(new Error("stdio server emitted invalid JSON-RPC"));
        return;
      }
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  child.once("error", failPending);
  child.once("exit", (code) =>
    failPending(new Error(`stdio server exited ${code}: ${stderr}`)),
  );
  return {
    request(method, params) {
      const id = nextId++;
      return new Promise((resolve_, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`stdio ${method} timed out`));
        }, 5_000);
        pending.set(id, { resolve: resolve_, reject, timer });
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
        );
      });
    },
    notify(method, params) {
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`,
      );
    },
    async close() {
      child.stdin.end();
      await Promise.race([
        once(child, "close"),
        new Promise((resolve_) => setTimeout(resolve_, 1_000)),
      ]);
      if (child.exitCode === null) child.kill();
    },
  };
}

const rpc = startStdioRpc();
try {
  const initialized = await rpc.request("initialize", {
    protocolVersion: "2025-01-01",
    capabilities: {},
    clientInfo: { name: "jev-fabric-smoke", version: "1" },
  });
  if (!initialized.result) throw new Error("stdio server did not initialize");
  rpc.notify("notifications/initialized", {});
  const tools = await rpc.request("tools/list", {});
  const expected = [
    "decision_evaluate_pack",
    "decision_route",
    "decision_rank",
    "decision_verify",
    "decision_explain_receipt",
  ];
  if (
    tools.result?.tools
      .map((tool) => tool.name)
      .sort()
      .join(",") !== expected.sort().join(",")
  )
    throw new Error(
      "stdio server did not expose the exact five advisory tools",
    );
  const input = {
    state: {},
    tenantId: "smoke",
    action: "read",
    knownActions: ["read"],
  };
  const successful = async (name, arguments_) => {
    const response = await rpc.request("tools/call", {
      name,
      arguments: arguments_,
    });
    const result = response.result;
    if (
      response.error ||
      result?.isError ||
      result?.structuredContent?.advisory !== true
    )
      throw new Error(`${name} did not return structured advisory success`);
    return result;
  };
  const evaluated = await successful("decision_evaluate_pack", {
    ...input,
    pack: "route",
  });
  const decisionId = evaluated.structuredContent.receipt?.decisionId;
  if (typeof decisionId !== "string")
    throw new Error("evaluation did not produce a receipt id");
  for (const name of ["decision_route", "decision_rank", "decision_verify"]) {
    await successful(name, input);
  }
  await successful("decision_explain_receipt", { decisionId });
  for (const key of [
    "authorization",
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
    const malformedSecret = "opaque-custom-credential";
    const malformed = await rpc.request("tools/call", {
      name: "decision_route",
      arguments: { ...input, state: { nested: { [key]: malformedSecret } } },
    });
    if (
      !malformed.result?.isError ||
      JSON.stringify(malformed).includes(malformedSecret) ||
      JSON.stringify(malformed).includes(key)
    )
      throw new Error("malformed request was not safely redacted");
  }
} finally {
  await rpc.close();
}

const cleanEnvironment = {
  ...(process.platform === "win32"
    ? { SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec }
    : {}),
  PATH: process.env.PATH,
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
};
async function assertHttpStarts(label, cwd, args, env) {
  const child = spawn(process.execPath, [cli, ...args, "--json"], {
    cwd,
    env: { ...cleanEnvironment, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  let closeCode;
  try {
    const endpoint = await new Promise((resolve_, reject) => {
      const finish = (error) => {
        clearInterval(interval);
        clearTimeout(timeout);
        error ? reject(error) : resolve_();
      };
      const interval = setInterval(() => {
        const line = stderr
          .split("\n")
          .map((value) => value.trim())
          .find((value) =>
            value.includes('"event":"jev-fabric-http-listening"'),
          );
        if (line) {
          try {
            const parsed = JSON.parse(line);
            if (typeof parsed.endpoint === "string") {
              clearInterval(interval);
              clearTimeout(timeout);
              resolve_(parsed.endpoint);
            }
          } catch {
            finish(new Error(`${label} emitted an invalid endpoint`));
          }
        }
      }, 10);
      const timeout = setTimeout(
        () => finish(new Error(`${label} did not start`)),
        2_000,
      );
      child.once("exit", (code) =>
        finish(new Error(`${label} exited ${code}: ${stdout}${stderr}`)),
      );
    });
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${Object.values(env)[0]}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    if (response.status < 400 || response.status > 499)
      throw new Error(`${label} endpoint was not reachable`);
  } finally {
    child.kill(process.platform === "win32" ? "SIGINT" : "SIGTERM");
    [closeCode] = await once(child, "close");
  }
  // Windows cannot reliably deliver POSIX signals to a detached child. The
  // cross-platform lifecycle unit covers handler semantics; POSIX CI also
  // proves the executable returns the declared interrupted exit code.
  if (process.platform !== "win32" && closeCode !== 4)
    throw new Error(`${label} did not exit with the interrupted code`);
}
const configDirectory = mkdtempSync(join(tmpdir(), "jev-fabric-serve-"));
try {
  writeFileSync(
    join(configDirectory, "jev-fabric.json"),
    JSON.stringify({ tokenEnv: "CONFIG_TOKEN", bind: "loopback" }),
  );
  await assertHttpStarts(
    "config token reference",
    configDirectory,
    ["serve", "--transport", "http"],
    { CONFIG_TOKEN: "a".repeat(32), JEV_FABRIC_TOKEN_ENV: "ENV_TOKEN" },
  );
  await assertHttpStarts(
    "flag token reference",
    configDirectory,
    ["serve", "--transport", "http", "--token-env", "FLAG_TOKEN"],
    { FLAG_TOKEN: "b".repeat(32) },
  );
  rmSync(join(configDirectory, "jev-fabric.json"));
  await assertHttpStarts(
    "environment token reference",
    configDirectory,
    ["serve", "--transport", "http"],
    { ENV_TOKEN: "c".repeat(32), JEV_FABRIC_TOKEN_ENV: "ENV_TOKEN" },
  );
} finally {
  rmSync(configDirectory, { recursive: true, force: true });
}

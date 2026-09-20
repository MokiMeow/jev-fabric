import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pinnedTypeSafeFetch } from "../src/transport.js";

describe("pinned TypeSafe transport", () => {
  it("performs a normal loopback request through the pinned implementation", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("healthy");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new Error("loopback server address unavailable");
      const response = await pinnedTypeSafeFetch(
        `http://127.0.0.1:${address.port}`,
      );
      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe("healthy");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("keeps a handled post-header cancellation from terminating the process", () => {
    const fixture = fileURLToPath(
      new URL("./fixtures/cancellation-probe.mts", import.meta.url),
    );
    const result = spawnSync(process.execPath, ["--import", "tsx", fixture], {
      cwd: fileURLToPath(new URL("../../..", import.meta.url)),
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("PASS cancellation remained handled");
    expect(result.stderr).toBe("");
  });
});

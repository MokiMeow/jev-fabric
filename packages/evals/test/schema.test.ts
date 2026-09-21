import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { parseManifest, replayArtifacts } from "../src/index.js";

const run = promisify(execFile);
const Ajv = Ajv2020 as unknown as new (
  options?: object,
) => {
  compile: (schema: unknown) => (value: unknown) => boolean;
};
const schemaDirectory = "../../benchmarks/schema";
const historicalDirectory = "../../benchmarks/historical/v0";
const schemaFor = (file: string) =>
  file === "cases.jsonl" || file === "golden-cases.jsonl"
    ? "case.schema.json"
    : file === "attempts.jsonl"
      ? "attempt.schema.json"
      : file === "decisions.jsonl"
        ? "decision.schema.json"
        : file === "outcomes.jsonl"
          ? "outcome.schema.json"
          : file.replace(/\.jsonl$/, "").replace(/\.json$/, "") +
            ".schema.json";
function makeAjv() {
  const ajv = new Ajv({ strict: true, allErrors: true });
  (addFormats as unknown as (instance: unknown) => void)(ajv);
  return ajv;
}

describe("published JSON Schema contracts", () => {
  it("compiles every committed schema and accepts every checked historical JSON artifact", async () => {
    const ajv = makeAjv();
    const schemas = await readdir(schemaDirectory);
    const validators = new Map<string, ReturnType<typeof ajv.compile>>();
    for (const name of schemas) {
      const schema = JSON.parse(
        await readFile(join(schemaDirectory, name), "utf8"),
      );
      validators.set(name, ajv.compile(schema));
    }
    for (const file of await readdir(historicalDirectory)) {
      if (file === "report.md") continue;
      const validator = validators.get(
        file === "manifest.json" ? "manifest.schema.json" : schemaFor(file),
      );
      expect(validator, file).toBeDefined();
      if (validator === undefined)
        throw new TypeError(`missing schema: ${file}`);
      const text = await readFile(join(historicalDirectory, file), "utf8");
      for (const row of file.endsWith(".jsonl")
        ? text.split("\n").filter(Boolean)
        : [text])
        expect(validator(JSON.parse(row)), file).toBe(true);
    }
  });
  it("validates every committed benchmark JSON and nonempty JSONL row", async () => {
    const ajv = makeAjv();
    const validators = new Map<string, ReturnType<typeof ajv.compile>>();
    for (const name of await readdir(schemaDirectory))
      validators.set(
        name,
        ajv.compile(
          JSON.parse(await readFile(join(schemaDirectory, name), "utf8")),
        ),
      );
    for (const relative of await readdir("../../benchmarks", {
      recursive: true,
    })) {
      const file = String(relative).replace(/\\/g, "/");
      const base = file.split("/").at(-1) ?? "";
      if (
        !/\.(?:json|jsonl)$/.test(file) ||
        /^tsconfig(?:\.[^.]+)*\.json$/u.test(base) ||
        file.startsWith("finance/builders/") ||
        file.startsWith("schema/") ||
        file.includes("/schema/")
      )
        continue;
      const validator = validators.get(
        base === "manifest.json" ? "manifest.schema.json" : schemaFor(base),
      );
      if (validator === undefined)
        throw new TypeError(`missing schema for benchmark artifact: ${base}`);
      const text = await readFile(join("../../benchmarks", file), "utf8");
      for (const row of base.endsWith(".jsonl")
        ? text.split("\n").filter(Boolean)
        : [text])
        expect(validator(JSON.parse(row)), file).toBe(true);
    }
    for (const schema of ["case", "attempt", "decision", "outcome"])
      expect(
        validators.get(`${schema}.schema.json`)?.({
          schemaVersion: "1",
          id: "x",
          unexpected: true,
        }),
      ).toBe(false);
    expect(() => {
      const validator = validators.get(schemaFor("unmapped-sentinel.jsonl"));
      if (validator === undefined)
        throw new TypeError("missing schema for benchmark artifact");
    }).toThrow(/missing schema/);
  });
  it("has representative runtime/JSON-schema parity and rejects unknown fields", async () => {
    const manifest = JSON.parse(
      await readFile(join(historicalDirectory, "manifest.json"), "utf8"),
    );
    const validator = makeAjv().compile(
      JSON.parse(
        await readFile(join(schemaDirectory, "manifest.schema.json"), "utf8"),
      ),
    );
    expect(validator(manifest)).toBe(true);
    expect(() => parseManifest(manifest)).not.toThrow();
    for (const invalid of [
      { ...manifest, unexpected: true },
      { ...manifest, runId: "" },
      { ...manifest, splitRule: "" },
      { ...manifest, startedAt: "not-a-timestamp" },
    ]) {
      expect(validator(invalid)).toBe(false);
      expect(() => parseManifest(invalid)).toThrow();
    }
    for (const startedAt of [
      "2024-01-01T00:00:00+05:30",
      "2024-01-01t00:00:00z",
      "2024-13-01T00:00:00Z",
      "2024-01-01T25:00:00Z",
      "2024-01-01T00:00:60Z",
      "2023-02-30T00:00:00Z",
      "2024-02-30T00:00:00Z",
      "2024-01-01T00:00:00",
    ]) {
      const candidate = { ...manifest, startedAt };
      expect(validator(candidate)).toBe(false);
      expect(() => parseManifest(candidate)).toThrow();
    }
    for (const startedAt of [
      "2024-02-29T00:00:00Z",
      "2024-01-01T00:00:00.123Z",
      "2024-01-01T00:00:00.1Z",
    ]) {
      const candidate = { ...manifest, startedAt };
      expect(validator(candidate)).toBe(true);
      expect(() => parseManifest(candidate)).not.toThrow();
    }
  });
});

it("replay and the actual importer make zero network attempts", async () => {
  const input = await mkdtemp(join(tmpdir(), "jev-network-source-"));
  const output = await mkdtemp(join(tmpdir(), "jev-network-output-"));
  await Promise.all([
    writeFile(
      join(input, "DEEP_REGRESSION_RESULTS.json"),
      JSON.stringify({ batch_curve: {} }),
    ),
    writeFile(
      join(input, "ADVANCED_PATTERN_RESULTS.json"),
      JSON.stringify({ performance: {} }),
    ),
  ]);
  const blocked = () => {
    throw new Error("network attempt trapped");
  };
  const original = {
    fetch: globalThis.fetch,
    request: http.request,
    get: http.get,
    httpsRequest: https.request,
    httpsGet: https.get,
    connect: net.connect,
    createConnection: net.createConnection,
  };
  globalThis.fetch = blocked;
  http.request = blocked as typeof http.request;
  http.get = blocked as typeof http.get;
  https.request = blocked as typeof https.request;
  https.get = blocked as typeof https.get;
  net.connect = blocked as typeof net.connect;
  net.createConnection = blocked as typeof net.createConnection;
  try {
    await expect(replayArtifacts(historicalDirectory)).resolves.toBeDefined();
    await expect(
      run(
        process.execPath,
        [
          "node_modules/tsx/dist/cli.mjs",
          "scripts/import-historical.mts",
          "--source",
          input,
          "--output",
          output,
        ],
        {
          cwd: "../..",
          env: {
            ...process.env,
            NODE_OPTIONS: "--require=./packages/evals/test/network-trap.cjs",
          },
        },
      ),
    ).resolves.toBeDefined();
  } finally {
    globalThis.fetch = original.fetch;
    http.request = original.request;
    http.get = original.get;
    https.request = original.httpsRequest;
    https.get = original.httpsGet;
    net.connect = original.connect;
    net.createConnection = original.createConnection;
    await Promise.all([
      rm(input, { recursive: true, force: true }),
      rm(output, { recursive: true, force: true }),
    ]);
  }
});

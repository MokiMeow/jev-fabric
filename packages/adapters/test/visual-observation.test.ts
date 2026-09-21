import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bindToolEnvironmentVisualObservation,
  validateToolEnvironmentVisualObservation,
} from "../src/visual-observation.js";

const hash = (letter: string) => `sha256:${letter.repeat(64)}`;
const binding = {
  environment: "browser",
  adapterId: "browser-bridge",
  adapterVersion: "1.0.0",
  sessionRef: "ref:session-1",
  workspaceRef: "ref:frame-main",
  stateHash: hash("a"),
  capabilityManifestHash: hash("b"),
  observedAt: "2026-09-20T10:00:00.000+00:00",
  observationFreshnessMs: 500,
} as const;
const capture = {
  modality: "browser_viewport",
  artifactHash: hash("c"),
  extractorId: "bounded-ocr",
  extractorVersion: "1.0.0",
  schemaVersion: "1",
  capturedAt: "2026-09-20T10:00:00.100+00:00",
  maxAgeMs: 500,
} as const;
const now = Date.parse("2026-09-20T10:00:00.250+00:00");

describe("tool-environment visual observation", () => {
  it.each([
    ["chart", "generic"],
    ["browser_viewport", "browser"],
    ["dcc_viewport", "blender"],
  ] as const)("binds bounded %s annotations", (modality, environment) => {
    const observation = bindToolEnvironmentVisualObservation(
      { ...binding, environment },
      { ...capture, modality },
      { annotations: ["Visible label is bounded evidence only"] },
      now,
    );
    expect(observation.artifactHash).toBe(hash("c"));
    expect(observation.trust).toBe("untrusted_data_only");
    expect(JSON.stringify(observation)).not.toContain("ref:session-1");
  });

  it("is deterministic and rejects state, capture, and annotation binding drift", () => {
    const first = bindToolEnvironmentVisualObservation(
      binding,
      capture,
      { annotations: ["Visible label"] },
      now,
    );
    const second = bindToolEnvironmentVisualObservation(
      binding,
      capture,
      { annotations: ["Visible label"] },
      now,
    );
    expect(first).toEqual(second);
    expect(() =>
      validateToolEnvironmentVisualObservation(
        first,
        { ...binding, stateHash: hash("d") },
        now,
      ),
    ).toThrow(/capture binding/u);
    expect(() =>
      validateToolEnvironmentVisualObservation(
        { ...first, artifactHash: hash("e") },
        binding,
        now,
      ),
    ).toThrow(/capture binding/u);
    expect(() =>
      validateToolEnvironmentVisualObservation(
        { ...first, annotations: ["Changed annotation"] },
        binding,
        now,
      ),
    ).toThrow(/annotation binding/u);
  });

  it("rejects captures outside trusted freshness and capture freshness", () => {
    expect(() =>
      bindToolEnvironmentVisualObservation(
        binding,
        { ...capture, capturedAt: "2026-09-20T09:59:59.999+00:00" },
        { annotations: ["label"] },
        now,
      ),
    ).toThrow(/predates/u);
    expect(() =>
      bindToolEnvironmentVisualObservation(
        binding,
        { ...capture, capturedAt: "2026-09-20T10:00:00.501+00:00" },
        { annotations: ["label"] },
        Date.parse("2026-09-20T10:00:00.600+00:00"),
      ),
    ).toThrow(/freshness window/u);
    expect(() =>
      bindToolEnvironmentVisualObservation(
        binding,
        capture,
        { annotations: ["label"] },
        Date.parse("2026-09-20T10:00:00.601+00:00"),
      ),
    ).toThrow(/stale/u);
  });

  it("rejects hostile annotations and untrusted authority/action fields", () => {
    let getterCalls = 0;
    const accessor = Object.defineProperty({}, "annotations", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return ["label"];
      },
    });
    expect(() =>
      bindToolEnvironmentVisualObservation(
        binding,
        capture,
        accessor as unknown as { readonly annotations: unknown },
        now,
      ),
    ).toThrow(/data properties/u);
    expect(getterCalls).toBe(0);
    expect(() =>
      bindToolEnvironmentVisualObservation(
        binding,
        capture,
        new Proxy({ annotations: ["label"] }, {}),
        now,
      ),
    ).toThrow(/plain object/u);
    expect(() =>
      bindToolEnvironmentVisualObservation(
        binding,
        capture,
        { annotations: ["label"], actionId: "submit-form" } as never,
        now,
      ),
    ).toThrow(/only annotations/u);
    expect(() =>
      bindToolEnvironmentVisualObservation(
        binding,
        capture,
        { annotations: ["unsafe\nannotation"] },
        now,
      ),
    ).toThrow(/one line/u);
    expect(() =>
      bindToolEnvironmentVisualObservation(
        binding,
        capture,
        { annotations: new Proxy(["label"], {}) },
        now,
      ),
    ).toThrow(/proxy/u);
  });

  it("has no visual capture, browser, or execution dependency", async () => {
    const source = await readFile(
      resolve(import.meta.dirname, "../src/visual-observation.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/\bfetch\s*\(|\bexecuteTool\b|\bplaywright\b/u);
    expect(source).not.toMatch(/\bchild_process\b|\bspawn\b|\bexec\b/u);
  });
});

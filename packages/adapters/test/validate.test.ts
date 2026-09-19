import { describe, expect, it } from "vitest";
import {
  canonicalAdapterModel,
  parseAdapterModel,
  validateAdapterModel,
} from "../src/index.js";

describe("adapter model validation", () => {
  it("rejects unknown event mappings and machine paths", () => {
    expect(() =>
      parseAdapterModel({
        ...canonicalAdapterModel,
        hosts: canonicalAdapterModel.hosts.map((host) =>
          host.id === "codex"
            ? { ...host, hooks: { imaginary: "before-tool" } }
            : host,
        ),
      }),
    ).toThrow();
    expect(() =>
      parseAdapterModel({
        ...canonicalAdapterModel,
        installationRoot: "C:\\Users\\unsafe",
      }),
    ).toThrow(/relative/u);
  });

  it("rejects credential values, unknown keys, and unsafe interpolation", () => {
    expect(() =>
      parseAdapterModel({
        ...canonicalAdapterModel,
        bearerToken: "secret-value",
      }),
    ).toThrow();
    expect(() =>
      parseAdapterModel({ ...canonicalAdapterModel, unknown: true }),
    ).toThrow();
    expect(() =>
      parseAdapterModel({
        ...canonicalAdapterModel,
        mcp: { ...canonicalAdapterModel.mcp, command: "jev-fabric; rm -rf /" },
      }),
    ).toThrow(/jev-fabric/u);
    expect(validateAdapterModel(canonicalAdapterModel)).toEqual({ ok: true });
  });
});

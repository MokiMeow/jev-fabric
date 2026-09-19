import { describe, expect, it } from "vitest";
import { definePack, definePackRegistry } from "../src/pack.js";

const manifest = {
  id: "route",
  version: "1.0.0",
  riskTier: "low",
  limits: {
    maxStateBytes: 1024,
    maxStateDepth: 4,
    maxStateItems: 10,
    maxStringBytes: 128,
    maxCandidates: 3,
    maxCandidateIdLength: 20,
    maxCandidateDescriptionBytes: 128,
  },
  candidateBehavior: "no_match",
  failure: { outage: "unavailable", providerFailure: "abstain" },
  requiredCapabilities: {
    questionTypes: ["choice"],
    probabilitySemantics: ["synthetic"],
  },
  evidence: { projectorId: "route-state", revision: "1" },
} as const;

describe("definePack", () => {
  it("rejects invalid semantic versions and external executable definitions", () => {
    expect(() => definePack({ ...manifest, version: "v1" })).toThrow(
      "semantic version",
    );
    expect(() =>
      definePack({
        ...manifest,
        evidence: { ...manifest.evidence, url: "x" },
      } as unknown as typeof manifest),
    ).toThrow("external pack definitions");
  });

  it("requires declared no-match behavior when a candidate provider may be empty", () => {
    expect(() =>
      definePack({
        ...manifest,
        candidateBehavior: undefined,
      } as unknown as typeof manifest),
    ).toThrow("candidateBehavior");
  });

  it("rejects executable-looking strings in external definitions", () => {
    expect(() =>
      definePack({
        ...manifest,
        evidence: { ...manifest.evidence, revision: "function run() {}" },
      }),
    ).toThrow("executable");
  });

  it("rejects duplicate stable IDs in a registry", () => {
    const pack = definePack(manifest);
    expect(() => definePackRegistry([pack, pack])).toThrow("duplicate pack id");
  });

  it("accepts SemVer 2 build metadata and rejects leading-zero prereleases", () => {
    expect(() =>
      definePack({ ...manifest, version: "1.0.0+build.1" }),
    ).not.toThrow();
    expect(() => definePack({ ...manifest, version: "1.0.0-01" })).toThrow(
      "semantic version",
    );
  });

  it("requires the exact named limit schema and rejects nested extras", () => {
    expect(() =>
      definePack({
        ...manifest,
        limits: { ...manifest.limits, maxStateBytes: undefined, arbitrary: 1 },
      } as unknown as typeof manifest),
    ).toThrow("limits");
    expect(() =>
      definePack({
        ...manifest,
        failure: { ...manifest.failure, extra: "deny" },
      } as unknown as typeof manifest),
    ).toThrow("failure");
  });
});

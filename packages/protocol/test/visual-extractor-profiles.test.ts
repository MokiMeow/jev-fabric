import { describe, expect, it } from "vitest";
import { toolEnvironmentVisualAnnotationHash } from "../src/tool-environments.js";
import {
  toolEnvironmentProfiledVisualCaptureBindingHash,
  toolEnvironmentProfiledVisualFindingsBindingHash,
  toolEnvironmentVisualExtractorProfileHash,
  validateToolEnvironmentProfiledVisualFindings,
  validateToolEnvironmentProfiledVisualObservation,
} from "../src/visual-extractor-profiles.js";

const hash = (letter: string) => `sha256:${letter.repeat(64)}`;
const snapshot = {
  contractVersion: "1",
  environment: "browser",
  adapterId: "browser-bridge",
  adapterVersion: "1.0.0",
  sessionRef: "ref:session-1",
  workspaceRef: "ref:frame-main",
  stateHash: hash("a"),
  capabilityManifestHash: hash("b"),
  observedAt: "2026-09-20T10:00:00.000+00:00",
  observationFreshnessMs: 500,
  selectedRefs: [],
  dirty: false,
  undoAvailable: false,
  actions: [
    {
      id: "inspect-surface",
      title: "Inspect declared surface",
      sideEffect: "read_only",
      transport: "browser_webmcp",
      parameters: [],
      preconditions: [],
      postconditions: [{ id: "observed", description: "State is observed" }],
      requiresApproval: false,
      supportsUndo: false,
    },
  ],
} as const;
const profile = {
  profileVersion: "1",
  extractorId: "fixed-visual-extractor",
  extractorVersion: "1.0.0",
  schemaVersion: "1",
  modalities: ["browser_viewport", "chart", "dcc_viewport"],
  maxFindingCount: 1,
  findings: [
    { id: "need-human-review", disposition: "requires_human_review" },
    {
      id: "request-structured-state",
      disposition: "requires_structured_state",
    },
  ],
} as const;
const canonicalProfileHash =
  "sha256:9ff2882287678c4f2013dd4c8c9d358c9cf81855bfe691e9a4c8de75521c4b41";
const canonicalCaptureHash =
  "sha256:6cbfedb72b6b1e0b18f01f021ffe49f8cf2d5fb81c3d875fa556d2a5ab0bc9bb";
const canonicalFindingsHash =
  "sha256:f5142beee4298ba0c31d9144415d3a97244771c9602f8f7b3531a930549ca2b7";

const profiledObservation = () => {
  const extractorProfileHash =
    toolEnvironmentVisualExtractorProfileHash(profile);
  const capture = {
    modality: "browser_viewport",
    artifactHash: hash("c"),
    extractorId: "fixed-visual-extractor",
    extractorVersion: "1.0.0",
    schemaVersion: "1",
    capturedAt: "2026-09-20T10:00:00.100+00:00",
    maxAgeMs: 500,
    extractorProfileHash,
  } as const;
  const annotations = ["Legacy bounded annotation"];
  return {
    ...capture,
    captureBindingHash: toolEnvironmentProfiledVisualCaptureBindingHash(
      snapshot,
      capture,
    ),
    annotationHash: toolEnvironmentVisualAnnotationHash(annotations),
    annotations,
    trust: "untrusted_data_only",
  } as const;
};

const trustedCapture = () => {
  const { captureBindingHash, annotationHash, annotations, trust, ...capture } =
    profiledObservation();
  return capture;
};

const boundFindings = () => {
  const observation = profiledObservation();
  const findingIds = ["request-structured-state"];
  return {
    observationCaptureBindingHash: observation.captureBindingHash,
    observationAnnotationHash: observation.annotationHash,
    extractorProfileHash: observation.extractorProfileHash,
    findingIds,
    findingBindingHash: toolEnvironmentProfiledVisualFindingsBindingHash(
      observation,
      observation.extractorProfileHash,
      findingIds,
    ),
    trust: "untrusted_data_only",
  } as const;
};

describe("trusted visual extractor profiles", () => {
  it("matches the shared adapter canonical digest vectors", () => {
    const binding = {
      environment: "blender",
      adapterId: "dcc-bridge",
      adapterVersion: "1.0.0",
      sessionRef: "ref:session-1",
      workspaceRef: "ref:scene-main",
      stateHash: hash("a"),
      capabilityManifestHash: hash("b"),
      observedAt: "2026-09-20T10:00:00.000+00:00",
      observationFreshnessMs: 500,
    } as const;
    const profileHash = toolEnvironmentVisualExtractorProfileHash(profile);
    const capture = {
      modality: "dcc_viewport",
      artifactHash: hash("c"),
      extractorId: "fixed-visual-extractor",
      extractorVersion: "1.0.0",
      schemaVersion: "1",
      capturedAt: "2026-09-20T10:00:00.100+00:00",
      maxAgeMs: 500,
      extractorProfileHash: profileHash,
    } as const;
    const captureBindingHash = toolEnvironmentProfiledVisualCaptureBindingHash(
      binding,
      capture,
    );
    const annotations = ["Bounded advisory detail"];
    const observation = {
      ...capture,
      captureBindingHash,
      annotationHash: toolEnvironmentVisualAnnotationHash(annotations),
      annotations,
      trust: "untrusted_data_only",
    } as const;
    expect(profileHash).toBe(canonicalProfileHash);
    expect(captureBindingHash).toBe(canonicalCaptureHash);
    expect(
      toolEnvironmentProfiledVisualFindingsBindingHash(
        observation,
        profileHash,
        ["request-structured-state"],
      ),
    ).toBe(canonicalFindingsHash);
  });

  it("requires a profile-bound capture before binding fixed finding ids", () => {
    const observation = validateToolEnvironmentProfiledVisualObservation(
      profiledObservation(),
      snapshot,
      trustedCapture(),
      profile,
      Date.parse("2026-09-20T10:00:00.200+00:00"),
    );
    const findings = validateToolEnvironmentProfiledVisualFindings(
      boundFindings(),
      profile,
      observation,
    );
    expect(findings.findingIds).toEqual(["request-structured-state"]);
    expect(findings.trust).toBe("untrusted_data_only");
  });

  it("rejects a profile swap even when artifact, state, and extractor match", () => {
    expect(() =>
      validateToolEnvironmentProfiledVisualObservation(
        profiledObservation(),
        snapshot,
        trustedCapture(),
        { ...profile, maxFindingCount: 2 },
        Date.parse("2026-09-20T10:00:00.200+00:00"),
      ),
    ).toThrow(/trusted extractor profile/u);

    const observation = profiledObservation();
    const swappedProfile = { ...profile, maxFindingCount: 2 };
    const swappedProfileHash =
      toolEnvironmentVisualExtractorProfileHash(swappedProfile);
    const findingIds = ["request-structured-state"];
    expect(() =>
      validateToolEnvironmentProfiledVisualFindings(
        {
          observationCaptureBindingHash: observation.captureBindingHash,
          observationAnnotationHash: observation.annotationHash,
          extractorProfileHash: swappedProfileHash,
          findingIds,
          findingBindingHash: toolEnvironmentProfiledVisualFindingsBindingHash(
            observation,
            swappedProfileHash,
            findingIds,
          ),
          trust: "untrusted_data_only",
        },
        swappedProfile,
        observation,
      ),
    ).toThrow(/wrong extractor profile/u);
  });

  it("rejects unknown, over-limit, forged, and authority-shaped findings", () => {
    const observation = profiledObservation();
    const findings = boundFindings();
    expect(() =>
      validateToolEnvironmentProfiledVisualFindings(
        { ...findings, findingIds: ["unknown-finding"] },
        profile,
        observation,
      ),
    ).toThrow(/unknown finding/u);
    expect(() =>
      validateToolEnvironmentProfiledVisualFindings(
        {
          ...findings,
          findingIds: ["need-human-review", "request-structured-state"],
        },
        profile,
        observation,
      ),
    ).toThrow(/profile limit/u);
    expect(() =>
      validateToolEnvironmentProfiledVisualFindings(
        { ...findings, findingBindingHash: hash("d") },
        profile,
        observation,
      ),
    ).toThrow(/binding is invalid/u);
    expect(() =>
      validateToolEnvironmentProfiledVisualFindings(
        { ...findings, actionId: "save-scene" },
        profile,
        observation,
      ),
    ).toThrow();
  });

  it("does not invoke profile accessors and rejects proxies or extra fields", () => {
    let getterCalls = 0;
    const accessorProfile = Object.defineProperty({}, "profileVersion", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "1";
      },
    });
    expect(() =>
      toolEnvironmentVisualExtractorProfileHash(accessorProfile),
    ).toThrow(/plain enumerable data/u);
    expect(getterCalls).toBe(0);
    expect(() =>
      toolEnvironmentVisualExtractorProfileHash(new Proxy(profile, {})),
    ).toThrow(/proxies/u);
    expect(() =>
      toolEnvironmentVisualExtractorProfileHash({
        ...profile,
        hostHandle: "not-permitted",
      }),
    ).toThrow();
  });
});

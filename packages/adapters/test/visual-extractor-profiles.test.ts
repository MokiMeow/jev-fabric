import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bindToolEnvironmentProfiledVisualFindings,
  bindToolEnvironmentProfiledVisualObservation,
  bindToolEnvironmentVisualTextBridgeState,
  toolEnvironmentProfiledVisualCaptureBindingHash,
  toolEnvironmentProfiledVisualFindingsBindingHash,
  toolEnvironmentVisualExtractorProfileHash,
  validateToolEnvironmentProfiledVisualFindings,
  validateToolEnvironmentProfiledVisualObservation,
  validateToolEnvironmentVisualTextBridgeState,
} from "../src/visual-extractor-profiles.js";

// Canonical vectors are also asserted by the protocol package without a
// cross-package source import, so package-local typechecking stays hermetic.
const expectedProfileHash =
  "sha256:9ff2882287678c4f2013dd4c8c9d358c9cf81855bfe691e9a4c8de75521c4b41";
const expectedCaptureHash =
  "sha256:6cbfedb72b6b1e0b18f01f021ffe49f8cf2d5fb81c3d875fa556d2a5ab0bc9bb";
const expectedFindingsHash =
  "sha256:f5142beee4298ba0c31d9144415d3a97244771c9602f8f7b3531a930549ca2b7";

const hash = (letter: string) => `sha256:${letter.repeat(64)}`;
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
const capture = () => ({
  modality: "dcc_viewport" as const,
  artifactHash: hash("c"),
  extractorId: "fixed-visual-extractor",
  extractorVersion: "1.0.0",
  schemaVersion: "1" as const,
  capturedAt: "2026-09-20T10:00:00.100+00:00",
  maxAgeMs: 500,
  extractorProfileHash: toolEnvironmentVisualExtractorProfileHash(profile),
});
const now = Date.parse("2026-09-20T10:00:00.200+00:00");

describe("offline visual extractor profile binder", () => {
  it("binds strict profile observations and fixed findings across modalities", () => {
    for (const modality of [
      "browser_viewport",
      "chart",
      "dcc_viewport",
    ] as const) {
      const observation = bindToolEnvironmentProfiledVisualObservation(
        binding,
        { ...capture(), modality },
        profile,
        { annotations: ["Bounded advisory detail"] },
        now,
      );
      const findings = bindToolEnvironmentProfiledVisualFindings(
        observation,
        profile,
        { findingIds: ["request-structured-state"] },
      );
      expect(findings.findingIds).toEqual(["request-structured-state"]);
    }
  });

  it("matches the canonical profile, capture, and finding digest vectors", () => {
    const profileHash = toolEnvironmentVisualExtractorProfileHash(profile);
    const profiledCapture = capture();
    const observation = bindToolEnvironmentProfiledVisualObservation(
      binding,
      profiledCapture,
      profile,
      { annotations: ["Bounded advisory detail"] },
      now,
    );
    expect(profileHash).toBe(expectedProfileHash);
    expect(
      toolEnvironmentProfiledVisualCaptureBindingHash(binding, profiledCapture),
    ).toBe(expectedCaptureHash);
    expect(
      toolEnvironmentProfiledVisualFindingsBindingHash(
        observation,
        profileHash,
        ["request-structured-state"],
      ),
    ).toBe(expectedFindingsHash);
  });

  it("rejects profile swap, excess findings, and hostile profile evidence", () => {
    const profiledCapture = capture();
    const observation = bindToolEnvironmentProfiledVisualObservation(
      binding,
      profiledCapture,
      profile,
      { annotations: ["Bounded advisory detail"] },
      now,
    );
    expect(() =>
      validateToolEnvironmentProfiledVisualObservation(
        observation,
        binding,
        profiledCapture,
        { ...profile, maxFindingCount: 2 },
        now,
      ),
    ).toThrow(/trusted extractor profile/u);
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
    expect(() =>
      bindToolEnvironmentProfiledVisualFindings(observation, profile, {
        findingIds: ["need-human-review", "request-structured-state"],
      }),
    ).toThrow(/profile limit/u);
    expect(() =>
      bindToolEnvironmentProfiledVisualFindings(observation, profile, {
        findingIds: ["request-structured-state"],
        actionId: "save-scene",
      } as never),
    ).toThrow(/only findingIds/u);
    expect(() =>
      bindToolEnvironmentProfiledVisualObservation(
        binding,
        profiledCapture,
        profile,
        { annotations: ["unsafe\u202Eannotation"] },
        now,
      ),
    ).toThrow(/control characters/u);
    expect(() =>
      bindToolEnvironmentProfiledVisualObservation(
        binding,
        profiledCapture,
        profile,
        new Proxy({ annotations: ["safe"] }, {}),
        now,
      ),
    ).toThrow(/proxies/u);
  });

  it("contains no visual capture, browser, DCC, or execution dependency", async () => {
    const source = await readFile(
      resolve(import.meta.dirname, "../src/visual-extractor-profiles.ts"),
      "utf8",
    );
    for (const forbidden of [
      "fetch(",
      "playwright",
      "puppeteer",
      "child_process",
      "spawn(",
      "exec(",
      "actionId",
      "confidence",
    ])
      expect(source.toLocaleLowerCase("en-US")).not.toContain(
        forbidden.toLocaleLowerCase("en-US"),
      );
  });

  it("builds a source-bound text-only provider state without image or execution data", () => {
    const state = bindToolEnvironmentVisualTextBridgeState(
      binding,
      capture(),
      profile,
      { annotations: ["A small viewport detail remains visually ambiguous"] },
      { findingIds: ["request-structured-state"] },
      now,
    );
    expect(state).toMatchObject({
      schemaVersion: "1",
      purpose: "visual_evidence_triage_only",
      advisoryOnly: true,
      execution: "NOT_SUPPORTED",
      inputModality: "extractor_text_only",
      providerReceivesImage: false,
      evidence: {
        trust: "untrusted_data_only",
        findings: [
          {
            id: "request-structured-state",
            disposition: "requires_structured_state",
          },
        ],
      },
    });
    expect(state.evidence.annotations).toEqual([
      "A small viewport detail remains visually ambiguous",
    ]);
    expect(state.stateBindingHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(state)).not.toMatch(
      /imageBytes|data:image|filePath|selector|coordinates|actionId|authority/iu,
    );
    expect(() =>
      validateToolEnvironmentVisualTextBridgeState(
        state,
        binding,
        capture(),
        profile,
        now,
      ),
    ).not.toThrow();
  });

  it("rejects stale, rebound, tampered, credentialed, and URL-bearing bridge state", () => {
    const state = bindToolEnvironmentVisualTextBridgeState(
      binding,
      capture(),
      profile,
      { annotations: ["A small viewport detail remains visually ambiguous"] },
      { findingIds: ["request-structured-state"] },
      now,
    );
    const tampered = structuredClone(state);
    tampered.evidence.annotations[0] = "Different extracted description";
    expect(() =>
      validateToolEnvironmentVisualTextBridgeState(
        tampered,
        binding,
        capture(),
        profile,
        now,
      ),
    ).toThrow(/bridge state binding/u);
    expect(() =>
      validateToolEnvironmentVisualTextBridgeState(
        state,
        { ...binding, stateHash: hash("f") },
        capture(),
        profile,
        now,
      ),
    ).toThrow(/trusted snapshot|capture binding/u);
    expect(() =>
      validateToolEnvironmentVisualTextBridgeState(
        state,
        binding,
        capture(),
        profile,
        now + 1_000,
      ),
    ).toThrow(/stale/u);
    expect(() =>
      bindToolEnvironmentVisualTextBridgeState(
        binding,
        capture(),
        profile,
        { annotations: ["Bearer synthetic_credential_value_12345"] },
        { findingIds: ["request-structured-state"] },
        now,
      ),
    ).toThrow(/credential-shaped/u);
    expect(() =>
      bindToolEnvironmentVisualTextBridgeState(
        binding,
        capture(),
        profile,
        { annotations: ["Inspect https://example.test/screenshot.png"] },
        { findingIds: ["request-structured-state"] },
        now,
      ),
    ).toThrow(/URL-shaped/u);
  });
});

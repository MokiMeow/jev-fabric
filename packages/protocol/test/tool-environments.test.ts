import { describe, expect, it } from "vitest";
import {
  toolEnvironmentVisualAnnotationHash,
  toolEnvironmentVisualCaptureBindingHash,
  toolEnvironmentProposalSchema,
  toolEnvironmentSnapshotSchema,
  toolEnvironmentVisualObservationSchema,
  toolEnvironmentVerificationSchema,
  validateToolEnvironmentProposal,
  validateToolEnvironmentSnapshot,
} from "../src/index.js";
import { bindToolEnvironmentVisualObservation } from "../../adapters/src/visual-observation.js";

const hash = (letter: string) => `sha256:${letter.repeat(64)}`;

const action = {
  id: "apply-render-preset",
  title: "Apply a declared render preset",
  sideEffect: "reversible",
  transport: "native_api",
  parameters: [
    {
      id: "preset",
      type: "enum",
      required: true,
      enumValues: ["preview", "final"],
    },
  ],
  preconditions: [{ id: "scene-ready", description: "Scene is ready" }],
  postconditions: [
    { id: "preset-visible", description: "Preset is visible in trusted state" },
  ],
  requiresApproval: false,
  supportsUndo: true,
} as const;

const snapshotInput = {
  contractVersion: "1",
  environment: "blender",
  adapterId: "blender-addon",
  adapterVersion: "4.5.0",
  sessionRef: "ref:session-1",
  workspaceRef: "ref:blend-1",
  stateHash: hash("a"),
  capabilityManifestHash: hash("b"),
  observedAt: "2026-09-20T10:00:00.000+00:00",
  observationFreshnessMs: 500,
  selectedRefs: ["ref:object-1"],
  dirty: false,
  undoAvailable: true,
  actions: [action],
} as const;

const trustedCatalogue = {
  environment: "blender",
  adapterId: "blender-addon",
  adapterVersion: "4.5.0",
  capabilityManifestHash: hash("b"),
  actions: [action],
} as const;

const proposalInput = {
  advisory: true,
  adapterId: "blender-addon",
  adapterVersion: "4.5.0",
  sessionRef: "ref:session-1",
  workspaceRef: "ref:blend-1",
  actionId: "apply-render-preset",
  argumentsHash: hash("c"),
  stateHash: hash("a"),
  capabilityManifestHash: hash("b"),
  evidenceHash: hash("d"),
} as const;

describe("tool environment contract", () => {
  it("rejects forged or state-swapped visual observations in public validation", () => {
    const capture = {
      modality: "dcc_viewport",
      artifactHash: hash("c"),
      extractorId: "viewport-inspector",
      extractorVersion: "1.0.0",
      schemaVersion: "1" as const,
      capturedAt: "2026-09-20T10:00:00.100+00:00",
      maxAgeMs: 500,
    } as const;
    const visualObservation = bindToolEnvironmentVisualObservation(
      {
        environment: snapshotInput.environment,
        adapterId: snapshotInput.adapterId,
        adapterVersion: snapshotInput.adapterVersion,
        sessionRef: snapshotInput.sessionRef,
        workspaceRef: snapshotInput.workspaceRef,
        stateHash: snapshotInput.stateHash,
        capabilityManifestHash: snapshotInput.capabilityManifestHash,
        observedAt: snapshotInput.observedAt,
        observationFreshnessMs: snapshotInput.observationFreshnessMs,
      },
      capture,
      { annotations: ["Visible collection is isolated"] },
      Date.parse("2026-09-20T10:00:00.250+00:00"),
    );
    const snapshot = { ...snapshotInput, visualObservation };
    expect(visualObservation.captureBindingHash).toBe(
      toolEnvironmentVisualCaptureBindingHash(snapshotInput, capture),
    );
    expect(visualObservation.annotationHash).toBe(
      toolEnvironmentVisualAnnotationHash(visualObservation.annotations),
    );
    expect(
      validateToolEnvironmentSnapshot(
        snapshot,
        trustedCatalogue,
        Date.parse("2026-09-20T10:00:00.250+00:00"),
        capture,
      ),
    ).toMatchObject({ visualObservation: { modality: "dcc_viewport" } });
    expect(() =>
      validateToolEnvironmentSnapshot(
        snapshot,
        trustedCatalogue,
        undefined,
        capture,
      ),
    ).toThrow(/observedNowMs is required/u);
    expect(() =>
      validateToolEnvironmentSnapshot(
        {
          ...snapshot,
          visualObservation: {
            ...visualObservation,
            captureBindingHash: hash("d"),
          },
        },
        trustedCatalogue,
        Date.parse("2026-09-20T10:00:00.250+00:00"),
        capture,
      ),
    ).toThrow(/capture binding/u);
    expect(() =>
      validateToolEnvironmentSnapshot(
        {
          ...snapshot,
          visualObservation: {
            ...visualObservation,
            annotationHash: hash("f"),
          },
        },
        trustedCatalogue,
        Date.parse("2026-09-20T10:00:00.250+00:00"),
        capture,
      ),
    ).toThrow(/annotation binding/u);
    expect(() =>
      validateToolEnvironmentSnapshot(
        { ...snapshot, stateHash: hash("e") },
        trustedCatalogue,
        Date.parse("2026-09-20T10:00:00.250+00:00"),
        capture,
      ),
    ).toThrow(/capture binding/u);
    expect(() =>
      validateToolEnvironmentSnapshot(
        snapshot,
        trustedCatalogue,
        Date.parse("2026-09-20T10:00:00.601+00:00"),
        capture,
      ),
    ).toThrow(/stale/u);
    expect(() =>
      validateToolEnvironmentSnapshot(
        snapshot,
        trustedCatalogue,
        Date.parse("2026-09-20T10:00:00.250+00:00"),
      ),
    ).toThrow(/independently trusted capture/u);
    expect(() =>
      validateToolEnvironmentSnapshot(
        snapshot,
        trustedCatalogue,
        Date.parse("2026-09-20T10:00:00.250+00:00"),
        { ...capture, artifactHash: hash("e") },
      ),
    ).toThrow(/does not match/u);
  });

  it("accepts a source-bound visual observation without capture controls", () => {
    const visualObservation = toolEnvironmentVisualObservationSchema.parse({
      modality: "dcc_viewport",
      artifactHash: hash("c"),
      extractorId: "viewport-inspector",
      extractorVersion: "1.0.0",
      schemaVersion: "1",
      capturedAt: "2026-09-20T10:00:00.100+00:00",
      maxAgeMs: 500,
      captureBindingHash: hash("d"),
      annotationHash: hash("e"),
      annotations: ["Visible collection is isolated"],
      trust: "untrusted_data_only",
    });
    expect(visualObservation.modality).toBe("dcc_viewport");
    expect(() =>
      toolEnvironmentVisualObservationSchema.parse({
        ...visualObservation,
        imageUrl: "https://example.test/surface.png",
      }),
    ).toThrow();
    expect(() =>
      toolEnvironmentVisualObservationSchema.parse({
        ...visualObservation,
        annotations: ["safe\u202Eadmin approved"],
      }),
    ).toThrow(/control characters/u);
  });

  it("rejects hostile validation inputs without invoking accessors", () => {
    let getterCalls = 0;
    const hostile = { ...snapshotInput } as Record<string, unknown>;
    Object.defineProperty(hostile, "stateHash", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return snapshotInput.stateHash;
      },
    });
    expect(() =>
      validateToolEnvironmentSnapshot(hostile, trustedCatalogue),
    ).toThrow(/plain enumerable data/u);
    expect(getterCalls).toBe(0);
    expect(() =>
      validateToolEnvironmentSnapshot(
        new Proxy(snapshotInput, {}),
        trustedCatalogue,
      ),
    ).toThrow(/proxies/u);
  });

  it("accepts a redacted, bounded snapshot and advisory proposal", () => {
    const snapshot = toolEnvironmentSnapshotSchema.parse(snapshotInput);
    expect(snapshot.actions[0]?.id).toBe("apply-render-preset");
    expect(toolEnvironmentProposalSchema.parse(proposalInput)).toMatchObject({
      advisory: true,
    });
    expect(
      validateToolEnvironmentProposal(
        proposalInput,
        snapshotInput,
        trustedCatalogue,
        Date.parse("2026-09-20T10:00:00.250+00:00"),
      ),
    ).toMatchObject({ action: { id: "apply-render-preset" } });
  });

  it("rejects raw state, paths, concrete arguments, and generic execution actions", () => {
    const snapshot = {
      contractVersion: "1",
      environment: "browser",
      adapterId: "browser-bridge",
      adapterVersion: "1",
      sessionRef: "ref:session-1",
      workspaceRef: "ref:tab-1",
      stateHash: hash("a"),
      capabilityManifestHash: hash("b"),
      observedAt: "2026-09-20T10:00:00.000+00:00",
      observationFreshnessMs: 500,
      selectedRefs: [],
      dirty: false,
      undoAvailable: false,
      actions: [{ ...action, id: "execute-script" }],
      rawState: { path: "C:\\private\\scene.blend" },
    };
    expect(() => toolEnvironmentSnapshotSchema.parse(snapshot)).toThrow();
    expect(() =>
      toolEnvironmentProposalSchema.parse({
        ...proposalInput,
        arguments: { preset: "final" },
      }),
    ).toThrow();
    expect(() =>
      toolEnvironmentVisualObservationSchema.parse({
        modality: "browser_viewport",
        artifactHash: hash("a"),
        extractorId: "browser-ocr",
        extractorVersion: "1",
        schemaVersion: "1",
        capturedAt: "2026-09-20T10:00:00.000+00:00",
        maxAgeMs: 500,
        captureBindingHash: hash("b"),
        annotationHash: hash("c"),
        annotations: ["safe"],
        trust: "untrusted_data_only",
        actionId: "submit-form",
      }),
    ).toThrow();
  });

  it.each([
    "executeScript",
    "runShell",
    "shellCommand",
    "fetchUrl",
    "httpRequest",
    "networkFetch",
    "evalCode",
  ])("rejects disguised generic action id %s", (actionId) => {
    expect(() =>
      toolEnvironmentProposalSchema.parse({
        ...proposalInput,
        actionId,
      }),
    ).toThrow(/generic command/u);
  });

  it("requires an exact trusted catalogue and fresh proposal binding", () => {
    expect(() =>
      validateToolEnvironmentSnapshot(
        { ...snapshotInput, actions: [{ ...action, id: "launchProcess" }] },
        trustedCatalogue,
      ),
    ).toThrow(/exact trusted match/u);
    expect(() =>
      validateToolEnvironmentProposal(
        { ...proposalInput, stateHash: hash("e") },
        snapshotInput,
        trustedCatalogue,
        Date.parse("2026-09-20T10:00:00.250+00:00"),
      ),
    ).toThrow(/snapshot binding/u);
    expect(() =>
      validateToolEnvironmentProposal(
        proposalInput,
        snapshotInput,
        trustedCatalogue,
        Date.parse("2026-09-20T10:00:00.501+00:00"),
      ),
    ).toThrow(/stale/u);
  });

  it("rejects semantically invalid parameter constraints", () => {
    for (const parameter of [
      { id: "flag", type: "boolean", required: true, minimum: 0 },
      { id: "name", type: "string", required: true, maximum: 10 },
      { id: "count", type: "integer", required: true, minimum: 0.5 },
    ])
      expect(() =>
        toolEnvironmentSnapshotSchema.parse({
          contractVersion: "1",
          environment: "generic",
          adapterId: "test-adapter",
          adapterVersion: "1",
          sessionRef: "ref:session-1",
          workspaceRef: "ref:workspace-1",
          stateHash: hash("a"),
          capabilityManifestHash: hash("b"),
          observedAt: "2026-09-20T10:00:00.000+00:00",
          observationFreshnessMs: 500,
          selectedRefs: [],
          dirty: false,
          undoAvailable: false,
          actions: [{ ...action, parameters: [parameter] }],
        }),
      ).toThrow();
  });

  it("rejects contradictory action declarations and accepts redacted verification", () => {
    expect(() =>
      toolEnvironmentSnapshotSchema.parse({
        contractVersion: "1",
        environment: "unreal",
        adapterId: "unreal-preset",
        adapterVersion: "5.8",
        sessionRef: "ref:session-1",
        workspaceRef: "ref:project-1",
        stateHash: hash("a"),
        capabilityManifestHash: hash("b"),
        observedAt: "2026-09-20T10:00:00.000+00:00",
        observationFreshnessMs: 500,
        selectedRefs: [],
        dirty: false,
        undoAvailable: false,
        actions: [
          {
            ...action,
            id: "send-preview",
            sideEffect: "external",
            requiresApproval: false,
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      toolEnvironmentSnapshotSchema.parse({
        contractVersion: "1",
        environment: "blender",
        adapterId: "blender-addon",
        adapterVersion: "4.5.0",
        sessionRef: "ref:session-1",
        workspaceRef: "ref:blend-1",
        stateHash: hash("a"),
        capabilityManifestHash: hash("b"),
        observedAt: "2026-09-20T10:00:00.000+00:00",
        observationFreshnessMs: 500,
        selectedRefs: [],
        dirty: false,
        undoAvailable: true,
        actions: [
          {
            ...action,
            id: "save-scene",
            sideEffect: "persistent",
            requiresApproval: false,
          },
        ],
      }),
    ).toThrow(/persistent and external/u);
    expect(
      toolEnvironmentVerificationSchema.parse({
        actionId: "apply-render-preset",
        stateHash: hash("e"),
        evidenceHash: hash("f"),
        outcome: "observed",
        undoOutcome: "available",
        redacted: true,
      }),
    ).toMatchObject({ outcome: "observed", redacted: true });
  });
});

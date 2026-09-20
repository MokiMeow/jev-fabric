# Tool environments

Jev Fabric can advise a bounded choice inside a browser, DCC tool, game engine,
CAD application, or similar environment. It is not an automation layer. It does
not control a browser, call a native API, evaluate a script, send a command, or
connect to an application.

Use the protocol contract to project a small, redacted snapshot into an advisory
decision. A trusted environment adapter keeps the raw document, scene, page,
project, selectors, files, credentials, and concrete argument values private.
The projection contains opaque references, hashes, freshness metadata, and a
finite allowlist of native operations. A proposal carries hashes for its
arguments and evidence, never the arguments themselves.

When a decision needs a chart, browser viewport, or DCC viewport observation,
bind a compact visual observation to the same trusted snapshot. The contract
contains only an artifact hash, capture/extractor provenance, freshness, a
snapshot-binding hash, and bounded annotations marked `untrusted_data_only`.
It contains no image bytes, paths, URLs, selectors, coordinates, or action
fields. A visual extractor stays outside Fabric; use its annotations only to
request structured evidence or human review, never as authorization.
Validation also requires the host to pass the extractor's trusted capture
projection separately from the snapshot. The public hashes detect mismatch;
they do not authenticate a caller-supplied capture by themselves.

## Fixed visual extractor profiles

Use a `ToolEnvironmentVisualExtractorProfile` when an extractor must report a
finite, code-reviewed vocabulary rather than free-form advisory annotations. A
profile fixes its extractor id/version, schema version, supported visual
modalities, and sorted finding identifiers. The only permitted dispositions are
`visual_ambiguity`, `requires_structured_state`, and `requires_human_review`.
They are advisory classifications, not actions, permissions, confidence scores,
or approval signals.

First validate the visual observation against its exact snapshot, trusted
capture, and clock. For strict profile mode, use a separate profiled capture:
its independently trusted equality projection and canonical snapshot binding
both include the extractor profile hash. Then validate the fixed finding-ID
attachment against that already-validated profiled observation and a separately
trusted profile. Its binding commits to the observation's capture and
annotation hashes, profile hash, and sorted finding IDs. Reject a profile,
capture, observation, or finding-id swap. No profile may carry text prompts,
pixels, file paths, URLs, DOM selectors, coordinates, host handles, action IDs,
arguments, or executable data.

This works for browser viewports and DCC viewports alike, including Blender,
Unreal, Unity, Godot, and FreeCAD, because it describes evidence vocabulary
only. It does not standardize rendering, screenshotting, OCR, scene inspection,
or host invocation. For browsers, prefer a page's structured WebMCP/DOM state;
use a visual profile only to request structured state or human review.

## Text-only visual bridge

Jev 1.13.0 is a text-only model: the official model documentation does not
accept image, audio, or video input. Do not pass an image URL and describe that
as visual understanding. Run a separately reviewed visual extractor first,
then call `bindToolEnvironmentVisualTextBridgeState` with its bounded text and
fixed finding IDs.

The resulting state declares `inputModality: "extractor_text_only"`,
`providerReceivesImage: false`, `advisoryOnly: true`, and
`execution: "NOT_SUPPORTED"`. It binds the exact trusted environment snapshot,
capture, artifact, annotation, extractor profile, finding vocabulary, and
expiry. Annotation values containing credential-shaped data or URL schemes are
rejected. Revalidate retained state with
`validateToolEnvironmentVisualTextBridgeState` immediately before provider use.

This bridge proves provenance and conformance, not that the extractor correctly
understood the image. Measure extractor quality separately from Jev routing,
and never infer OCR, vision, latency, accuracy, or cost from a passing binding.
See TypeSafe's current [model documentation](https://docs.typesafe.ai/models).

The exported Zod schemas validate structure; they are deliberately not an
authorization allowlist. A host must keep a code-reviewed
`TrustedToolEnvironmentCatalogue` outside page, model, project, and request
data. Call `validateToolEnvironmentSnapshot` to require an exact descriptor
match and, for visual snapshots, an independently trusted capture projection;
then call `validateToolEnvironmentProposal` with the same capture and an
explicit trusted clock observation to bind adapter/session/workspace identity,
state, capability manifest, freshness, and the exact catalogue action. Only
then may the host
continue to its separate policy, approval, ticket, and native-operation gates.

## Recommended flow

```text
trusted adapter observes native state
  -> deterministic capability, version, freshness, and precondition checks
  -> exact match against code-reviewed TrustedToolEnvironmentCatalogue
  -> bounded snapshot and declared action candidates
  -> host reasoning plans; Jev returns advisory route/risk/verify result
  -> host policy and any user approval
  -> action ticket bound to state, evidence, audience, and arguments hash
  -> trusted adapter re-observes and validates before its own native operation
  -> deterministic postcondition / undo observation and redacted receipt
```

Only the trusted adapter may know how a declared operation maps to a host API.
It must reject state, capability, target, policy-epoch, approval, argument-hash,
or ticket mismatch immediately before doing anything. A decision receipt is
evidence, not an authority to act.

## Choosing the control surface

Prefer each product's narrow, structured API over GUI imitation. GUI driving is
the least reliable fallback and must remain outside Jev Fabric.

| Environment | Preferred bounded surface | Do not expose |
| --- | --- | --- |
| Browser | Site-owned WebMCP tools, then a pinned DevTools Protocol adapter | raw page text as instructions, generic JavaScript evaluation, coordinates, passwords, submit/purchase without approval |
| Blender | add-on-defined actions and direct data API; use operators only after `poll()` | `bpy.ops` chosen from arbitrary text, arbitrary Python, paths, context-dependent operation without preflight |
| Unreal | a small Remote Control Preset and project-defined Blueprint/Python functions | generic object paths, arbitrary function invocation, internet-exposed Remote Control |
| Unity | project-defined Editor actions and version-pinned batch jobs | arbitrary `-executeMethod`, generated C#, unbounded asset mutation |
| Godot | registered EditorPlugin actions and version-pinned headless scripts | arbitrary GDScript, arbitrary project files, unknown export presets |
| FreeCAD | document transactions and known Python workbench operations | arbitrary macros, unrestricted console, raw geometry/document paths |

The same pattern applies to additional tools: model a versioned, finite action
catalogue in an adapter, retain raw state in that adapter, and use host-owned
native validation for every mutation.

## Browser and WebMCP

[WebMCP](https://developer.chrome.com/docs/ai/webmcp) is a proposed Chrome web
standard for pages to declare structured tools, schemas, and state for agents.
It can make an instrumented site more reliable than DOM or visual actuation, but
it does not make a provider decision, an HTTP request, or a page operation faster
by itself. It is currently under active discussion, requires origin isolation and
the `tools` Permissions Policy, and Chrome documents it primarily for local,
human-in-the-loop workflows. Treat availability as experimental and version-pin
the browser/protocol in any evaluation.

WebMCP tool metadata and tool output are page-controlled input, not policy. Its
[security guidance](https://developer.chrome.com/docs/ai/webmcp)
recommends marking untrusted output, consequential tools, and read-only tools.
Adapters should honor those signals conservatively, but must independently apply
their own policy and user approval. For non-WebMCP sites, pin a stable
[Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/1-3/)
version; never use its general runtime-evaluation capability as an action
candidate.

For screenshot or viewport fallback, hash-bind the capture to the trusted
origin/frame-derived state projection before using an annotation. If the browser
state, frame binding, capture, extractor version, or freshness changes, reject
the observation and rediscover structured state rather than attempting a visual
action.

## Product-specific notes

### Blender

Blender's [operator guidance](https://docs.blender.org/api/main/info_gotchas_operators.html)
notes that operators depend on UI context and can fail `poll()`. An adapter should
snapshot mode, active object, selection, and relevant editor context; call the
native preflight; and then validate the postcondition. Prefer direct data changes
for deterministic work. A user-facing add-on should register only specific,
reviewable operations.

### Unreal Engine

Unreal's [Remote Control](https://dev.epicgames.com/documentation/unreal-engine/remote-control-for-unreal-engine)
serves HTTP and WebSocket requests and can access functions and properties exposed
to Blueprint/Python. That breadth is exactly why the adapter should use a small
Remote Control Preset rather than accepting a generic object path. Epic marks the
feature Beta and its [quick start](https://dev.epicgames.com/documentation/unreal-engine/remote-control-quick-start-for-unreal-engine)
warns not to expose it to the public internet; keep it local, on a LAN, or behind
a private VPN as appropriate.

### Unity

Unity supports [Editor command-line arguments](https://docs.unity3d.com/Manual/EditorCommandLineArguments.html)
for known unattended work. An adapter must bind a declared operation to a known
project-side method; it must not select arbitrary methods or flags. For batched
asset changes, Unity documents that `StartAssetEditing`/`StopAssetEditing` need a
`try`/`finally` or equivalent scope to avoid leaving the Asset Database in an
unresponsive state: [AssetDatabase reference](https://docs.unity3d.com/ScriptReference/AssetDatabase.StartAssetEditing.html).

### Godot

Use registered editor plugins for interactive work and known command-line scripts
or export presets for batch jobs. Godot's [command-line documentation](https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html)
covers headless export and scripts; it also provides recovery mode that disables
tool scripts, editor plugins, and GDExtension add-ons. Treat recovery mode,
project/version mismatch, or missing declared capability as an abstention.

### FreeCAD and comparable CAD/DCC tools

FreeCAD's [source documentation](https://freecad.github.io/SourceDoc/) covers
both C++ and Python components, including a GUI-independent App core; its
[module reference](https://freecad.github.io/API/modules.html) describes document,
property, and unit facilities. Build a bounded adapter around document
transactions, recompute/error checks, explicit units, and known workbench
operations. Do not use a generic Python console/macro interface as an agent tool.

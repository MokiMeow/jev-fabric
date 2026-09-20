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

The exported Zod schemas validate structure; they are deliberately not an
authorization allowlist. A host must keep a code-reviewed
`TrustedToolEnvironmentCatalogue` outside page, model, project, and request
data. Call `validateToolEnvironmentSnapshot` to require an exact descriptor
match, then `validateToolEnvironmentProposal` with an explicit trusted clock
observation to bind adapter/session/workspace identity, state, capability
manifest, freshness, and the exact catalogue action. Only then may the host
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

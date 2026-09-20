# Tool-environment security boundary

Tool environments contain high-value state: authenticated browser sessions,
files, scenes, assets, project settings, local network access, and potentially
expensive renders or builds. Jev Fabric is advisory at this boundary.

## What crosses into Jev Fabric

Only a trusted adapter may construct a tool-environment snapshot. It may send:

- opaque session, workspace, and selected-object references;
- hashes of state, capability manifest, action arguments, and evidence;
- bounded freshness and dirty/undo metadata; and
- a finite, versioned catalogue of static action descriptors.

It must not send raw DOM/scene/project state, selectors, object paths, local
paths, commands, source code, macros, credentials, or page/tool output as a
privileged instruction. Treat all content originating outside the trusted adapter
as advisory data, including WebMCP metadata and returned page content.

Visual annotations are also untrusted data. A visual observation may carry only
its artifact hash, bounded extractor provenance, capture time/freshness, a hash
binding it to the exact adapter/session/workspace/state/capability projection,
and bounded one-line annotations. Never put pixels, paths, URLs, DOM selectors,
coordinates, tool IDs, action arguments, or approval claims in this envelope.

A fixed visual extractor profile may further limit output to a trusted,
versioned list of finding IDs and only the non-authorizing dispositions
`visual_ambiguity`, `requires_structured_state`, and `requires_human_review`.
Profile validation proves the reported ID was in that configured vocabulary and
bound to a prior visual observation. In strict profile mode, the profile digest
is also part of the independently trusted capture equality check and capture
binding tuple, so a profile swap fails before findings are considered. None of
this proves that an extractor's visual conclusion is true. Never add action
IDs, target IDs, confidence values, coordinates, prompts, commands, approval
claims, or host handles to a profile or its finding attachment.

## What Jev Fabric may do

It may advise which declared candidate fits a bounded question, signal a risk,
ask for escalation, or abstain. It cannot authorize, execute, mint an action
ticket, broaden an action catalogue, or turn a failed precondition into success.
The action proposal schema intentionally contains only an action identifier and
hashes; it has no code, URI, selector, machine path, or concrete arguments.

## What the trusted host and adapter must do

Before a mutation, the trusted host must apply identity, policy, budget, and
approval requirements. It may then issue a short-lived, one-use action ticket
bound to principal, tenant, workspace, adapter audience, exact action,
argument-or-scope hash, state hash, evidence hash, and policy/permission epochs.

The protocol schemas validate shape only. They must never be used as an action
allowlist. The adapter owns a code-reviewed positive catalogue unavailable to
the model/page/request, and must call `validateToolEnvironmentSnapshot` plus
`validateToolEnvironmentProposal` before policy or ticket processing.

Immediately before performing its own predeclared native operation, the adapter
must re-observe and reject all of the following:

- expired, replayed, wrong-audience, or invalid tickets;
- changed state, target, capability manifest, app version, or action descriptor;
- stale observations, unmet preconditions, or argument-hash mismatch;
- a visual capture that predates, outlives, or is not hash-bound to the exact
  trusted state projection, or that does not exactly match the capture supplied
  independently by the trusted extractor;
- missing approval for persistent or external work; and
- any request to use a generic command, script, network, evaluation, or shell
  interface.

Afterward, it must use deterministic native checks to observe the declared
postconditions and whether an undo is available or succeeded. Store redacted,
hash-based receipts only. A successful model answer, receipt, or page statement
does not certify that an operation occurred.

## Browser-specific cautions

WebMCP is useful structured input, not an authorization mechanism. Chrome notes
that LLM agents remain susceptible to indirect prompt injection and recommends
untrusted-content and consequential-action hints in its
[WebMCP tool security guidance](https://developer.chrome.com/docs/ai/webmcp).
Honor consequential actions with a user confirmation and keep browser automation
out of this package. Never use arbitrary DevTools `Runtime.evaluate`, page
scripts, selectors from untrusted pages, or visual coordinates as Jev candidates.
Visual fallback can at most justify an advisory request for structured evidence
or a human review; it must never invoke a browser or desktop action directly.

Vercel's experimental [`mcp-handler` WebMCP bridge](https://github.com/vercel-labs/mcp-handler/blob/main/docs/WEBMCP.md) can forward calls with the
signed-in user's cookies. Its tool allowlist limits page registration but does
not restrict the underlying MCP endpoint, and its `readOnlyHint` is not an
authorization fact. Use the stricter bridge binding only for an exact
same-origin script URL and a host-reviewed allowlist whose entire exposed
surface is read-only. The server must separately require same-origin
cookie-authenticated fetches, authenticate every protocol request, validate the
current session and arguments, and keep cancellation distinct from rollback.
Tool output remains untrusted and is excluded from the binding.

# Jev Fabric v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish the first production-quality alpha of Jev Fabric: a provider-neutral, policy-governed decision runtime with Jev and OpenAI-compatible providers, MCP/CLI/agent integrations, evaluation tooling, security controls, documentation, and release automation.

**Architecture:** A strict protocol package defines questions, answers, events, receipts, and provider capabilities. The core compiles state and decision graphs, caches judgments, schedules bounded calls, applies deterministic policy, and optionally issues execution tickets. Providers, packs, evals, MCP, CLI, and host adapters depend inward on those contracts; no provider or model owns authorization or execution.

**Tech Stack:** Node.js 22.14+/24 LTS, TypeScript 7, pnpm 12.4.2 workspaces, tsdown, Zod 4, Vitest 5, fast-check 4, Biome 2, TypeSafe SDK 0.6, MCP TypeScript SDK v2, Changesets 3, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-19-jev-fabric-design.md`

## Global Constraints

- Repository and public product name: `jev-fabric` / “Jev Fabric”; organization: `MokiMeow`.
- License: Apache-2.0. Initial version: `0.1.0-alpha.1`.
- Runtime support: `>=22.14 <25`; CI must test Node 22 and 24; release runs Node 24.
- Package manager: exact `pnpm@12.4.2`; lockfile is committed.
- TypeScript strict mode; ESM package output; CJS only where a host requires it.
- Core and tests perform no network calls by default. Live calls require `--live`, an allowlisted provider, explicit budgets, and credentials.
- A model answer never grants authority or weakens a static denial.
- Generic-provider probability semantics are never labeled `native_calibrated`.
- Raw state, credentials, bearer/action tickets, and authorization tokens are not logged or persisted by default.
- Every externally visible claim must be evidence-labeled and link to a raw or reproducible artifact.
- No downloaded decision pack may execute code. Built-in TypeScript packs are shipped code; external packs are declarative validated data.
- Use test-first red-green-refactor for production behavior. Configuration, documentation, fixtures, and generated manifests are reviewed but exempt from the production-code red-first rule.

---

### Task 1: Repository foundation and protocol contracts

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.npmrc`, `tsconfig.base.json`, `biome.json`, `vitest.workspace.ts`, `.gitignore`, `.gitattributes`
- Create: `packages/protocol/package.json`, `packages/protocol/tsconfig.json`, `packages/protocol/tsdown.config.ts`
- Create: `packages/protocol/src/{json,questions,answers,events,receipts,provider,index}.ts`
- Test: `packages/protocol/test/{questions,answers,events,receipts,provider}.test.ts`
- Create: `LICENSE`

**Interfaces:**
- Produces: `JsonValue`, `DecisionQuestion`, `DecisionAnswer`, `DecisionRequest`, `DecisionResponse`, `DecisionProvider`, `ProviderCapabilities`, `NormalizedEvent`, `AuthorizationContext`, `DecisionReceipt`, and all corresponding Zod schemas.
- Consumes: no project package.

- [ ] **Step 1: Add workspace/toolchain configuration and exact package metadata**

The root is private, uses `pnpm@12.4.2`, declares `engines.node: ">=22.14 <25"`, and exposes `format`, `lint`, `typecheck`, `test`, `build`, `pack:test`, and `verify`. Protocol exports use `./dist/index.js` and `./dist/index.d.ts` and publish under `@mokimeow/jev-fabric-protocol`.

- [ ] **Step 2: Write failing protocol schema tests**

```ts
it("rejects non-finite and out-of-range probabilities", () => {
  expect(() => decisionResponseSchema.parse(responseWithProbability(Number.NaN))).toThrow();
  expect(() => decisionResponseSchema.parse(responseWithProbability(1.01))).toThrow();
});

it("keeps authorization outside generic events", () => {
  expect(() => normalizedEventSchema.parse({ ...event, tenantId: "forged" })).toThrow();
});
```

- [ ] **Step 3: Run protocol tests and verify RED**

Run: `pnpm --filter @mokimeow/jev-fabric-protocol test`
Expected: FAIL because schema modules do not exist.

- [ ] **Step 4: Implement strict protocol schemas and canonical types**

`DecisionProvider` has this public shape:

```ts
export interface DecisionProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  evaluate(request: DecisionRequest, options?: EvaluateOptions): Promise<DecisionResponse>;
}
```

Choice validation requires exact option membership and an argmax selection; all distributions are finite, within `[0,1]`, and sum within `1e-6`. TypeSafe confidence is optional metadata separate from class probability. Unknown object keys are rejected at trust boundaries.

- [ ] **Step 5: Run tests, typecheck, build, and package smoke test**

Run: `pnpm --filter @mokimeow/jev-fabric-protocol test && pnpm --filter @mokimeow/jev-fabric-protocol typecheck && pnpm --filter @mokimeow/jev-fabric-protocol build && pnpm pack:test`
Expected: all commands exit 0 and an isolated Node process imports the packed protocol tarball.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: establish protocol and repository foundation"
```

### Task 2: Core runtime—hashing, cache, graph, scheduler, and accounting

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/tsdown.config.ts`
- Create: `packages/core/src/{canonical,cache,graph,scheduler,budget,retry,accounting,errors,index}.ts`
- Test: `packages/core/test/{canonical,cache,graph,scheduler,budget,retry,accounting}.test.ts`

**Interfaces:**
- Consumes: all Task 1 protocol contracts.
- Produces: `canonicalize`, `sha256Digest`, `DecisionCache`, `MemoryDecisionCache`, `FileDecisionCache`, `DecisionGraph`, `DecisionPlanner`, `DecisionScheduler`, `BudgetLedger`, and attempt-accounting types.

- [ ] **Step 1: Write failing canonicalization and tenant-cache tests**

```ts
it("hashes object keys canonically but preserves candidate order", () => {
  expect(hash({ b: 2, a: 1 })).toBe(hash({ a: 1, b: 2 }));
  expect(hash({ candidates: ["a", "b"] })).not.toBe(hash({ candidates: ["b", "a"] }));
});

it("never returns another tenant's judgment", async () => {
  await cache.set(key({ tenant: "one" }), result);
  expect(await cache.get(key({ tenant: "two" }))).toBeUndefined();
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @mokimeow/jev-fabric-core test -- canonical cache`
Expected: FAIL because core exports do not exist.

- [ ] **Step 3: Implement canonical hashing and bounded caches**

Use deterministic JSON serialization with sorted object keys and preserved array order. Memory cache is size/TTL bounded. Filesystem cache writes a versioned metadata envelope atomically, scopes paths with tenant-keyed digests, stores no raw state, validates integrity, and rejects corrupt or incompatible entries.

- [ ] **Step 4: Write failing graph, retry, and accounting tests**

Tests prove cycle rejection, batching only for equivalent state/provider/options, dependent-stage ordering, cancellation, Retry-After, bounded retries, budget reservation before dispatch, correct logical-request versus transport-attempt counts, and overlapping child spans not being summed as wall time.

- [ ] **Step 5: Implement planner, scheduler, retry, budgets, and accounting**

The scheduler uses a bounded semaphore per provider/tenant, monotonic time, injected clock/randomness in tests, total deadlines, exponential backoff with jitter, circuit-breaker states, and abort signals. No call starts when budget reservation fails.

- [ ] **Step 6: Run full core verification and commit**

Run: `pnpm --filter @mokimeow/jev-fabric-core verify`
Expected: tests, typecheck, lint, and build all pass.

```bash
git add packages/core pnpm-lock.yaml
git commit -m "feat: add bounded decision runtime"
```

### Task 3: Deterministic policy, receipts, telemetry, and execution tickets

**Files:**
- Create: `packages/core/src/{policy,receipt,telemetry,redaction,ticket,authorization}.ts`
- Test: `packages/core/test/{policy,receipt,redaction,ticket,authorization}.test.ts`

**Interfaces:**
- Consumes: Task 1 contracts and Task 2 canonical/accounting primitives.
- Produces: `PolicyRule`, `PolicyOutcome`, `evaluatePolicy`, `ReceiptBuilder`, `TelemetrySink`, `JsonlTelemetrySink`, `Redactor`, `ActionTicketIssuer`, and `ActionTicketVerifier`.

- [ ] **Step 1: Write failing authority and policy property tests**

Use fast-check to prove a static deny remains deny for every model answer, evidence fields cannot create `AuthorizationContext`, unknown actions cannot produce an executable outcome, and increased risk cannot weaken an outcome under the default policy order.

- [ ] **Step 2: Run policy tests and verify RED**

Run: `pnpm --filter @mokimeow/jev-fabric-core test -- policy authorization`
Expected: FAIL because policy and authorization modules do not exist.

- [ ] **Step 3: Implement pure policy evaluation and redacted receipts**

Policy result values are `allow`, `deny`, `ask`, `route`, `retry`, `escalate`, `abstain`, and `unavailable`. Static rules run before semantic rules. Receipts store hashes and metadata, not raw state. JSONL output sanitizes line breaks/control sequences and applies structural secret redaction.

- [ ] **Step 4: Write failing action-ticket tests**

Tests cover signature tampering, audience mismatch, principal/tenant/action mismatch, expiry, policy/permission epoch change, replay, concurrent claim, and key rotation by key id.

- [ ] **Step 5: Implement HMAC action tickets and one-use replay store**

Tickets use HMAC-SHA-256, random 256-bit keys supplied by the host, 128-bit nonces, absolute expiry, canonical claims, constant-time verification, explicit audience, and an injected atomic `ReplayStore`. Ticket material is never included in ordinary receipts.

- [ ] **Step 6: Verify and commit**

Run: `pnpm --filter @mokimeow/jev-fabric-core verify`

```bash
git add packages/core
git commit -m "feat: enforce deterministic policy and action tickets"
```

### Task 4: Native TypeSafe, OpenAI-compatible, and scripted providers

**Files:**
- Create: `packages/provider-typesafe/{package.json,tsconfig.json,tsdown.config.ts}`
- Create: `packages/provider-typesafe/src/{adapter,mapping,errors,index}.ts`
- Test: `packages/provider-typesafe/test/{mapping,adapter,errors}.test.ts`
- Create: `packages/provider-openai-compatible/{package.json,tsconfig.json,tsdown.config.ts}`
- Create: `packages/provider-openai-compatible/src/{adapter,prompt,response,endpoint-policy,index}.ts`
- Test: `packages/provider-openai-compatible/test/{adapter,response,endpoint-policy}.test.ts`
- Create: `packages/core/src/testing/scripted-provider.ts`
- Test: `packages/core/test/scripted-provider.test.ts`

**Interfaces:**
- Consumes: `DecisionProvider` protocol and scheduler retry/attempt hooks.
- Produces: `TypeSafeProvider`, `OpenAICompatibleProvider`, `EndpointPolicy`, and `ScriptedProvider`.

- [ ] **Step 1: Write failing TypeSafe mapping tests from recorded response fixtures**

Tests compile Choice/Noul/Score—including structured instructions—to official SDK request objects and map answer distributions, returned model, usage, and confidence without equating confidence to correctness probability.

- [ ] **Step 2: Run provider tests and verify RED**

Run: `pnpm --filter @mokimeow/jev-fabric-provider-typesafe test`
Expected: FAIL because the adapter is absent.

- [ ] **Step 3: Implement native TypeSafe adapter**

Use `@typesafe-ai/sdk@0.6.0`. Read `TYPESAFE_API_KEY` only when the host did not inject a client/key. Support model pinning, abort/deadline mapping where supported, and sanitized errors. Emit `native_calibrated` only for direct validated Jev answers.

- [ ] **Step 4: Write failing generic-provider and SSRF-policy tests**

Tests reject request-provided base URLs, non-HTTPS remote endpoints unless explicitly local, URL credentials, redirects to private/reserved addresses, unknown answer IDs, markdown-wrapped JSON, invalid probabilities, and `native_calibrated` labeling.

- [ ] **Step 5: Implement OpenAI-compatible strict JSON adapter**

Administrator configuration supplies endpoint, model, headers, capability flags, deadline, and repair count. The adapter uses injected `fetch`, strict JSON-only instructions, local schema validation, bounded repair, no automatic arbitrary-provider failover, and `self_reported` semantics.

- [ ] **Step 6: Add deterministic scripted provider and run all provider verification**

Run: `pnpm --filter @mokimeow/jev-fabric-core test -- scripted-provider && pnpm --filter @mokimeow/jev-fabric-provider-typesafe verify && pnpm --filter @mokimeow/jev-fabric-provider-openai-compatible verify`

- [ ] **Step 7: Commit**

```bash
git add packages/provider-* packages/core pnpm-lock.yaml
git commit -m "feat: add Jev and compatible model providers"
```

### Task 5: Pack SDK, context compiler, and seven built-in packs

**Files:**
- Create: `packages/core/src/{pack,context,candidates,runtime}.ts`
- Test: `packages/core/test/{pack,context,candidates,runtime}.test.ts`
- Create: `packs/{route,screen,rank,verify,risk,progress,completion}/{pack.ts,fixtures.jsonl,README.md}`
- Create: `packs/index.ts`, `packs/package.json`, `packs/tsconfig.json`, `packs/tsdown.config.ts`
- Test: `packs/test/{route,screen,rank,verify,risk,progress,completion}.test.ts`

**Interfaces:**
- Consumes: protocol questions, providers, planner, cache, policy, receipts.
- Produces: `definePack`, `DecisionPack`, `FabricRuntime`, `StateProjector`, `CandidateProvider`, `builtinPacks`.

- [ ] **Step 1: Write failing pack-definition and runtime tests**

Tests reject duplicate IDs, invalid semantic versions, executable fields in external definitions, missing no-match behavior where candidates may be empty, unsupported provider capabilities, and state/candidate limits. Runtime tests prove deterministic bypass and cache hits produce zero provider calls.

- [ ] **Step 2: Verify RED and implement pack/runtime contracts**

Run: `pnpm --filter @mokimeow/jev-fabric-core test -- pack runtime`
Expected: FAIL before implementation; PASS after `definePack` and `FabricRuntime` are minimal and strict.

- [ ] **Step 3: Write failing fixture tests for all seven packs**

Each pack receives normal, no-match/abstain, ambiguous, adversarial, stale/unavailable, and provider-failure fixtures. Risk fixtures prove model output cannot override a static deny. Completion fixtures reject unsupported test claims. Route/rank fixtures preserve candidate coverage failures separately from selection errors.

- [ ] **Step 4: Implement the seven packs with one shared-state request per stage**

Packs declare capability requirements, risk-tier defaults, failure behavior, and evidence projection. `rank` uses relative Choice plus optional absolute fit; `risk` emits independent risk/authorization/untrusted-influence signals; deterministic policy chooses the action.

- [ ] **Step 5: Verify packs and commit**

Run: `pnpm --filter @mokimeow/jev-fabric-core verify && pnpm --filter @mokimeow/jev-fabric-packs verify`

```bash
git add packages/core packs pnpm-lock.yaml
git commit -m "feat: ship composable decision packs"
```

### Task 6: Evaluation, calibration, replay, and benchmark artifacts

**Files:**
- Create: `packages/evals/{package.json,tsconfig.json,tsdown.config.ts}`
- Create: `packages/evals/src/{metrics,calibration,selective,thresholds,bootstrap,manifest,replay,report,index}.ts`
- Test: `packages/evals/test/{metrics,calibration,selective,thresholds,bootstrap,manifest,replay}.test.ts`
- Create: `benchmarks/schema/*.json`, `benchmarks/fixtures/*.jsonl`, `benchmarks/historical/README.md`
- Create: `scripts/import-historical.mts`

**Interfaces:**
- Consumes: protocol receipts/responses and core accounting traces.
- Produces: `evaluateCases`, Brier/NLL/ECE/RPS/risk-coverage metrics, threshold sweep, cluster bootstrap, run manifest, replay report, and JSON/Markdown report renderers.

- [ ] **Step 1: Write golden failing metric tests**

Include hand-computed binary and categorical Brier, NLL with zero-probability diagnostics, top-label ECE using `max(probabilities)` rather than TypeSafe confidence, Noul reliability, ordinal MAE/RPS, selective risk with `NA` at zero coverage, and cost-per-success including failed attempts.

- [ ] **Step 2: Run metrics tests and verify RED**

Run: `pnpm --filter @mokimeow/jev-fabric-evals test -- metrics calibration selective`
Expected: FAIL because metrics are absent.

- [ ] **Step 3: Implement pure metrics and threshold selection**

Thresholds are fit only on a declared calibration split. Test groups never cross family/session/repository/source boundaries. Reports include independent group counts, prevalence, invalid responses, abstentions, confidence intervals, and evidence labels.

- [ ] **Step 4: Write failing manifest, replay, and historical-import tests**

The importer copies approved raw artifacts from the old lab, strips secrets/absolute user paths, labels them `local_exploratory`, and records the prior confidence/ECE semantic correction. Replay is deterministic and never opens the network.

- [ ] **Step 5: Implement manifest/replay/report/import pipeline**

Artifacts are `manifest.json`, `cases.jsonl`, `attempts.jsonl`, `decisions.jsonl`, `outcomes.jsonl`, `metrics.json`, `calibration.json`, `conformance.json`, and `report.md`.

- [ ] **Step 6: Verify and commit**

Run: `pnpm --filter @mokimeow/jev-fabric-evals verify && pnpm exec tsx scripts/import-historical.mts --source .. --output benchmarks/historical/v0`

```bash
git add packages/evals benchmarks scripts pnpm-lock.yaml
git commit -m "feat: add reproducible evaluation and replay"
```

### Task 7: MCP v2 server and production CLI

**Files:**
- Create: `packages/mcp/{package.json,tsconfig.json,tsdown.config.ts}`
- Create: `packages/mcp/src/{server,tools,stdio,http,auth,errors,index}.ts`
- Test: `packages/mcp/test/{tools,stdio,http,auth}.test.ts`
- Create: `packages/cli/{package.json,tsconfig.json,tsdown.config.ts}`
- Create: `packages/cli/src/{main,config,output,doctor,evaluate,replay,benchmark,serve,adapters}.ts`
- Test: `packages/cli/test/{doctor,evaluate,replay,benchmark,serve,adapters}.test.ts`

**Interfaces:**
- Consumes: FabricRuntime, built-in packs, provider adapters, eval reports.
- Produces: `createMcpServer`, `createHttpHandler`, `serveStdio`, and `jev-fabric` binary.

- [ ] **Step 1: Write failing MCP tool-contract tests**

Use the MCP v2 in-process HTTP handler and a spawned stdio child for conformance. Assert exact five-tool discovery, strict schemas, structured content, cancellation, redacted errors, and no execution side effects.

- [ ] **Step 2: Verify RED and implement MCP server**

Run: `pnpm --filter @mokimeow/jev-fabric-mcp test`
Expected: FAIL before server modules; PASS after stdio and stateless HTTP handler work.

- [ ] **Step 3: Write failing HTTP authorization tests**

Reject missing/wrong bearer token, non-loopback public bind without secure mode, disallowed Host/Origin, oversized body, wrong content type, and credential reflection. The handler accepts injected auth for operator-provided OAuth gateways.

- [ ] **Step 4: Write failing CLI end-to-end tests**

Spawn packed CLI against temporary config and scripted provider. Assert stable JSON output/exit codes for doctor, evaluate, replay, benchmark, serve startup errors, and adapter generation. Verify credentials alone do not trigger live calls.

- [ ] **Step 5: Implement CLI with explicit live budgets and redaction**

`--live` additionally requires provider, maximum calls, maximum input tokens, maximum dollars, and deadline. `doctor` reports capabilities without printing secret values. Config uses environment-variable names, not embedded credentials.

- [ ] **Step 6: Verify and commit**

Run: `pnpm --filter @mokimeow/jev-fabric-mcp verify && pnpm --filter @mokimeow/jev-fabric-cli verify`

```bash
git add packages/mcp packages/cli pnpm-lock.yaml
git commit -m "feat: expose MCP and CLI interfaces"
```

### Task 8: Agent skill, Codex plugin, and cross-host adapter generator

**Files:**
- Create: `packages/adapters/{package.json,tsconfig.json,tsdown.config.ts}`
- Create: `packages/adapters/src/{model,generate,validate,codex,claude,gemini,qwen,kimi,index}.ts`
- Test: `packages/adapters/test/{generate,validate,codex,claude,gemini,qwen,kimi}.test.ts`
- Create: `skills/jev-fabric/SKILL.md`, `skills/jev-fabric/references/{pack-selection,security-boundary}.md`
- Create: `integrations/*` host files generated from committed canonical templates
- Create: `.agents/plugins/marketplace.json`, `plugins/jev-fabric/**`

**Interfaces:**
- Consumes: CLI/MCP installation contract and normalized events.
- Produces: deterministic host manifests, event mapping tables, shared skill, repo marketplace, and validated Codex plugin.

- [ ] **Step 1: Use the official plugin scaffold for the Codex source tree**

Run the installed plugin-creator script with repo/team marketplace, skills, hooks, scripts, MCP, and marketplace flags. Keep unsupported fields out of the manifest and validate after edits.

- [ ] **Step 2: Write failing adapter generation and validation tests**

Golden tests cover deterministic output, no secrets, relative paths, exact package command, declared environment names, host-specific hook semantics, idempotent regeneration, and rejection of unknown event mappings.

- [ ] **Step 3: Verify RED and implement host generators**

Run: `pnpm --filter @mokimeow/jev-fabric-adapters test`
Expected: FAIL before generators; PASS after five native layouts validate against project schemas.

- [ ] **Step 4: Write and validate the universal skill**

The skill teaches deterministic-first selection, route/rank/screen/verify/risk/progress/completion pack choice, batching, abstention, provenance/freshness, and security boundaries. It instructs agents never to execute a model-selected command directly and never to treat confidence as permission.

- [ ] **Step 5: Generate integrations and run host/plugin validation**

Run: `pnpm --filter @mokimeow/jev-fabric-adapters generate && pnpm --filter @mokimeow/jev-fabric-adapters validate`
Run the plugin-creator `validate_plugin.py` and skill-creator `quick_validate.py` on generated Codex assets.

- [ ] **Step 6: Commit**

```bash
git add packages/adapters integrations skills plugins .agents pnpm-lock.yaml
git commit -m "feat: add agent skills and host adapters"
```

### Task 9: Examples, documentation, public evidence, and AI-readable maps

**Files:**
- Create: `README.md`, `ARCHITECTURE.md`, `COMPATIBILITY.md`, `ROADMAP.md`, `SUPPORT.md`, `CHANGELOG.md`, `AGENTS.md`, `llms.txt`, `CITATION.cff`
- Create: `docs/{index,quickstart,concepts,packs,adapters,recipes,security,evidence,reference}/*.md`
- Create: `examples/{route-skills,gate-tool-action,rerank-evidence,ci-triage,support-triage,browser-action,completion-check,evaluate-pack}/**`
- Test: `examples/test/examples.test.ts`, `docs/test/{links,snippets,claims}.test.ts`
- Create: `assets/architecture.svg` only if generated source and accessible text alternative are committed.

**Interfaces:**
- Consumes: all public packages, CLI, adapters, benchmark artifacts.
- Produces: the complete human/AI onboarding and operating surface.

- [ ] **Step 1: Write failing executable-example tests**

Each example runs offline with ScriptedProvider, emits a validated receipt, asserts its essential negative case, and exits 0. README/quickstart command snippets are extracted and executed in a clean temporary directory.

- [ ] **Step 2: Verify RED and implement eight examples**

Run: `pnpm test --filter examples`
Expected: FAIL before examples; PASS after all offline examples and negative cases are present.

- [ ] **Step 3: Write public documentation**

Use outcome-first prose, decision-boundary tables, text alternatives for diagrams, provider/data/cost prerequisites before commands, and direct links to official sources. Mark compatibility cells `SUPPORTED`, `EXPERIMENTAL`, `ADVISORY`, `UNSUPPORTED`, or `NOT RUN` with dates/versions.

- [ ] **Step 4: Add failing link/snippet/claim-label tests, then satisfy them**

Claim tests reject unqualified `production-ready`, `secure`, `100x`, `verified`, or percentage performance language outside explicitly labeled evidence blocks. Link tests check local paths and selected external canonical URLs.

- [ ] **Step 5: Run docs/examples verification and commit**

Run: `pnpm test --filter examples && pnpm test --filter docs && pnpm verify`

```bash
git add README.md ARCHITECTURE.md COMPATIBILITY.md ROADMAP.md SUPPORT.md CHANGELOG.md AGENTS.md llms.txt CITATION.cff docs examples assets
git commit -m "docs: publish the Jev Fabric developer experience"
```

### Task 10: Community health, CI, security scanning, release, and repository publication

**Files:**
- Create: `CONTRIBUTING.md`, `GOVERNANCE.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`
- Create: `.github/{CODEOWNERS,PULL_REQUEST_TEMPLATE.md,dependabot.yml}`
- Create: `.github/ISSUE_TEMPLATE/{bug.yml,feature.yml,security.yml,config.yml}`
- Create: `.github/workflows/{verify,codeql,dependency-review,scorecard,release}.yml`
- Create: `.changeset/{config.json,README.md}`
- Create: `scripts/{pack-smoke,generate-sbom,verify-workflows}.mts`
- Test: `scripts/test/{pack-smoke,verify-workflows}.test.ts`

**Interfaces:**
- Consumes: the full repository and package graph.
- Produces: contributor contract, secure CI/release automation, package/SBOM artifacts, public GitHub repository.

- [ ] **Step 1: Write failing workflow and package-integrity tests**

Tests require top-level `permissions: {}`, per-job least privilege, SHA-pinned external actions, no `pull_request_target`, timeouts/concurrency, no npm write token, release `id-token: write`, Node 22/24 verification, frozen lockfile, package tarball smoke tests, and SPDX SBOM generation.

- [ ] **Step 2: Verify RED and implement community/security files and workflows**

Release uses Changesets and npm trusted publishing from GitHub-hosted Node 24. It remains inactive until npm trusted publishers exist. Security policy documents private GitHub reporting and does not publish a personal email address.

- [ ] **Step 3: Run fresh full verification**

Run: `pnpm install --frozen-lockfile && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test --coverage && pnpm build && pnpm pack:test && pnpm docs:check && pnpm security:check`
Expected: every command exits 0 with no warnings treated as ignored failures.

- [ ] **Step 4: Run live-safe conformance checks**

Run: `pnpm jev-fabric doctor --json`, offline MCP stdio/HTTP conformance, all adapter validators, secret-pattern scan, dependency license audit, and historical replay. If `TYPESAFE_API_KEY` is absent, record T3 live TypeSafe as `NOT RUN`; do not substitute the exposed key.

- [ ] **Step 5: Independent whole-repository reviews and one fix wave**

Commission architecture/spec, security, code-quality, documentation, and release-readiness reviews. Fix all critical/important findings, re-run scoped verification, then run the complete suite again.

- [ ] **Step 6: Merge the reviewed build branch to local main**

Use the finishing-development-branch workflow. Preserve the committed spec, plan, benchmark evidence, and review report. Do not squash away security/evidence corrections that need audit history.

- [ ] **Step 7: Create and push the public GitHub repository**

Create `MokiMeow/jev-fabric` as public with the verified description, Apache-2.0 license metadata from the existing repo, issues enabled, and no autogenerated README/license/gitignore. Add `origin`, push `main`, attach the repository URL, then configure topics and available security/settings controls. Attempt branch rules after the first push; document controls unavailable under current organization permissions/plan.

- [ ] **Step 8: Final publication verification and commit any factual status corrections**

Verify the public URL, default branch, Actions parsing, community profile, security policy visibility, release workflow disabled/pending trusted publisher as documented, and clone/install/test from a fresh temporary directory. If publication changes compatibility/status facts, update and commit them before the final push.

```bash
git add .
git commit -m "chore: prepare public alpha release"
```

# Server-side provider composition

These are server-only integrations. Project state and candidates must already
be projected and bounded; identity, authorization, action policy, credentials,
and execution remain trusted host concerns. Provider output is advisory, not
authorization. The two complete, copyable files below are executed offline in
the public examples test with injected I/O, so they never make a provider or
DNS request.

## Native TypeSafe Jev

Copy [the native injected-client example](../../examples/provider-native-fake/index.ts).
It constructs `TypeSafeProvider` with the exact `jev-1.13.0` model and an
injected `systemOne` client. In production, resolve the server-side credential
once at startup and pass it to `createNativeJevProvider({ apiKey })`; do not
place it in a config object, a browser, a receipt, or logs. The complete file
also creates `FabricRuntime` with an explicit `BudgetLedger`, one-attempt retry
policy, trusted authorization, and `deadlineMs`.

```ts
const controller = new AbortController();
const result = await runtime.evaluate({
  pack: routePack, state, tenantId, action, knownActions,
  authorization: trustedAuthorization,
  signal: controller.signal, deadlineMs: 1_000,
});
if (result.receipt.outcome !== "route") {
  // Fail closed: escalate, abstain, or apply host policy; do not execute.
  return { next: "review", receipt: result.receipt };
}
return { next: result.semantic.selectedId, receipt: result.receipt };
```

The native adapter validates typed answers, pins the requested model, and sets
SDK retries to zero. Its `native_calibrated` receipt label is provider-declared
semantics, not individual correctness or permission; validate locally on held
out data before operational thresholds.

## OpenAI-compatible provider

Copy [the compatible injected-transport example](../../examples/provider-compatible-fake/index.ts).
It pins an HTTPS endpoint and model, passes a trusted DNS resolver, uses an
injected transport in tests, disables repair/redirect retries, and composes the
same budget/deadline/fail-closed runtime. For a real deployment, resolve a
credential only in trusted server startup and attach it to headers there; never
serialize it into config or telemetry.

```ts
const provider = new OpenAICompatibleProvider({
  id: "compatible-server",
  endpoint: "https://models.example.test/v1/chat/completions",
  model: "pinned-compatible-model",
  resolve: trustedDnsResolver,
  transport: trustedPinnedTransport,
  repairAttempts: 0,
  maxRedirects: 0,
});
```

The adapter uses endpoint/address planning and rejects private, unpinned, and
unsafe redirect destinations. Keep the resolver and transport in trusted server
code; do not accept endpoint/model/header values from an agent or browser.
`self_reported` probability semantics do not mean calibration, correctness, or
authority.

## Evidence and failures

Both examples are integration-shape evidence only, not latency, price,
accuracy, safety-certification, or provider-performance evidence. Handle a
provider failure, cancellation, deadline, or invalid output as a fail-closed
application state. Preserve the redacted receipt for diagnosis and let the host
re-check current authorization before any action.

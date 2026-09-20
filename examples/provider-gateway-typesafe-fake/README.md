# Vercel AI Gateway Jev composition

This offline example composes the fixed `typesafe-ai/jev` Gateway provider with
`FabricRuntime`, an explicit budget ledger, one provider attempt, trusted
authorization, and a deadline. Its injected `systemOne` client makes no network
request and the placeholder credential is never used.

Run from a built checkout:

```sh
pnpm exec tsx examples/provider-gateway-typesafe-fake/index.ts
```

For a live server deployment, resolve the credential through the trusted host
and use [`createVercelGatewayJevProvider`](../../docs/providers/vercel-ai-gateway.md).
The returned decision remains advisory; host policy and current authorization
still control any action.

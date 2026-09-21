# Vercel AI Gateway Jev composition

This offline example simulates the response-mapping and runtime shape used by
the fixed `typesafe-ai/jev` Gateway provider. It uses the generic provider's
injected `systemOne` client, an explicit budget ledger, one provider attempt,
trusted authorization, and a deadline. It makes no network request and contains
no credential. The production Gateway factory intentionally accepts neither a
client nor an endpoint override.

Run from a built checkout:

```sh
pnpm exec tsx examples/provider-gateway-typesafe-fake/index.ts
```

For a live server deployment, resolve the credential through the trusted host
and use [`createVercelGatewayJevProvider`](../../docs/providers/vercel-ai-gateway.md).
The returned decision remains advisory; host policy and current authorization
still control any action.

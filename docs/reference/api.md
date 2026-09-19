# API reference
Public packages:

| Package | Responsibility |
| --- | --- |
| `@mokimeow/jev-fabric-protocol` | strict question, answer, response, receipt, and provider contracts |
| `@mokimeow/jev-fabric-core` | runtime, cache, scheduler, policy, redaction, receipts, tickets, scripted provider |
| `@mokimeow/jev-fabric-packs` | seven trusted built-in packs and fixtures |
| `@mokimeow/jev-fabric-provider-typesafe` | native TypeSafe adapter |
| `@mokimeow/jev-fabric-provider-openai-compatible` | administrator-configured compatible adapter |
| `@mokimeow/jev-fabric-evals` | offline evaluation, manifests, replay, and reports |
| `@mokimeow/jev-fabric-mcp` | advisory MCP server and bounded loopback handler |
| `@mokimeow/jev-fabric-cli` | terminal commands and adapter contract |
| `@mokimeow/jev-fabric-adapters` | canonical host layouts and validators |

The core entry point is `new FabricRuntime(options).evaluate(input)`. Inputs require a trusted `pack`, `tenantId`, `action`, `knownActions`, state, and optionally trusted authorization/risk/policy/signal/deadline. Outputs include semantic data, a redacted receipt, and accounting. `createNativeJevProvider` exports the pinned native model factory; it requires an explicit server-side key or injected test client and does not read ambient credentials. The compatible adapter remains a trusted-host programmatic integration, not a CLI live option. Read the TypeScript declarations as the exact alpha API; semver pre-1.0 changes may occur.

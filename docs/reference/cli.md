# CLI reference
`jev-fabric` is offline by default.

| Command | Result | Network |
| --- | --- | --- |
| `doctor --json` | capability and environment-name presence report | not used |
| `evaluate --json` | scripted offline evaluation report | not used |
| `benchmark --json` | scripted offline benchmark report | not used |
| `replay --directory <dir>` | validates retained evaluation artifacts | not used |
| `serve --transport stdio` | advisory MCP stdio server | not used by default runtime |
| `serve --transport stdio --live …` | explicit pinned native TypeSafe Jev MCP server | provider call only after all gates |
| `serve --transport http --token-env NAME` | bounded loopback HTTP configuration | loopback only |
| `adapters generate\|validate` | generated integration contract | not used |

Precedence is flag, then relative config file, then environment, then default.
Config may contain environment-variable names, never credential values. `--live`
is invocation-only: config/environment cannot enable it. Live is stdio-only and
requires exact `typesafe-native`/`jev-1.13.0`, credential environment name,
operator tenant/action, maximum calls/input tokens/dollars, input-price ceiling,
and deadline. See [native live operation](../providers/typesafe-native.md).

`adapters generate` is a dry-run contract inspection; it does not write files.
Repository maintainers regenerate committed layouts with
`pnpm --filter @mokimeow/jev-fabric-adapters generate` and validate with
`pnpm adapters:check`.

# Agent hosts and adapters

Generated host layouts live in `integrations/` and are derived from canonical adapter models. They configure the offline advisory stdio MCP process; they do not grant permissions, run actions, install the CLI, or install credentials. Before copying one, install `@mokimeow/jev-fabric-cli` so `jev-fabric` is on the host `PATH`, then run `jev-fabric doctor --json`. The listed artifact statuses are dated 2026-09-19 local-shape evidence, not tested host-version claims.

| Host | Generated location | Artifact status | Installed-host status |
| --- | --- | --- | --- |
| Codex | `integrations/codex/config.toml` | ADVISORY | NOT RUN |
| Claude Code | `integrations/claude-code/.mcp.json` | ADVISORY | NOT RUN |
| Gemini CLI | `integrations/gemini-cli/gemini-extension.json` | ADVISORY | NOT RUN |
| Qwen Code | `integrations/qwen-code/qwen-extension.json` | ADVISORY | NOT RUN |
| Kimi Code | `integrations/kimi-code/.kimi-code/mcp.json` | ADVISORY | NOT RUN |

`jev-fabric adapters generate` is a read-only dry-run contract inspection;
`jev-fabric adapters validate` validates that contract. Repository maintainers
regenerate committed layouts with `pnpm --filter @mokimeow/jev-fabric-adapters
generate`. Generated layouts remain offline. The separate operator-only native
live overlay is [documented here](../providers/typesafe-native.md); never add
credentials to generated files. Consult [Compatibility](../../COMPATIBILITY.md)
for exact vocabulary.

Read [official Codex MCP guidance](https://developers.openai.com/codex/mcp/) (accessed 2026-09-19) and each host’s current documentation before applying a generated layout. External host behavior changes independently of this repository.

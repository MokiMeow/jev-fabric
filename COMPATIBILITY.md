# Compatibility

Compatibility is an observed integration status, not a vendor endorsement. Last reviewed 2026-09-20 against generated adapter artifacts in `integrations/`; no live provider or installed creative-tool sessions were run for this alpha.

Jev Fabric is not affiliated with or endorsed by TypeSafe AI.

| Host / provider | Generated artifact | MCP server contract | Installed host | Live | Evidence / date |
| --- | --- | --- | --- | --- | --- |
| Codex | ADVISORY | SUPPORTED | NOT RUN | NOT RUN | adapter v1 local contract; MCP local conformance, 2026-09-19 |
| Claude Code | ADVISORY | SUPPORTED | NOT RUN | NOT RUN | adapter v1 local contract; MCP local conformance, 2026-09-19 |
| Gemini CLI | ADVISORY | SUPPORTED | NOT RUN | NOT RUN | adapter v1 local contract; MCP local conformance, 2026-09-19 |
| Qwen Code | ADVISORY | SUPPORTED | NOT RUN | NOT RUN | adapter v1 local contract; MCP local conformance, 2026-09-19 |
| Kimi Code | ADVISORY | SUPPORTED | NOT RUN | NOT RUN | adapter v1 local contract; MCP local conformance, 2026-09-19 |
| TypeSafe provider | SUPPORTED | ADVISORY | NOT RUN | NOT RUN | SDK adapter unit contract 0.6, 2026-09-19 |
| Vercel Gateway Jev | SUPPORTED | ADVISORY | NOT RUN | NOT RUN | fixed TypeSafe-compatible endpoint/model contract, 2026-09-20 |
| OpenAI-compatible provider | SUPPORTED | ADVISORY | NOT RUN | NOT RUN | adapter unit contract, 2026-09-19 |
| WebMCP | EXPERIMENTAL | ADVISORY | NOT RUN | NOT RUN | offline origin/tool/schema binding; draft Chrome surface, 2026-09-20 |
| Blender / Unreal / Unity / Godot / FreeCAD | EXPERIMENTAL | ADVISORY | NOT RUN | NOT RUN | protocol and design contracts only, 2026-09-20 |

`SUPPORTED` means a committed, automated local contract exists only for the named column. `EXPERIMENTAL` means bounded local evidence exists but the surface needs targeted validation. `ADVISORY` means the surface returns guidance only. `UNSUPPORTED` means the alpha intentionally has no such feature. `NOT RUN` means no installed-host or live evidence is committed. A generated artifact and local MCP-server conformance are not installed-host evidence.

See [host installation](docs/adapters/hosts.md) and [evidence taxonomy](docs/evidence/README.md).

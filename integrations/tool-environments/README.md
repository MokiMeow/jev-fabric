# Tool-environment integration contracts

These are design-only integration contracts. They contain no executable adapter,
network client, browser driver, native API client, command runner, script runner,
or credentials. Each host integration must remain an independently reviewed,
trusted adapter that implements the advisory protocol boundary in
[`docs/integrations/tool-environments.md`](../../docs/integrations/tool-environments.md).

The host directories document a deliberately small first action catalogue. They
are not compatibility claims and must not be treated as install instructions.

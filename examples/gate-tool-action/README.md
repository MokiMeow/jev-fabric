# Gate a tool action
Uses `risk` to return an advisory low-risk signal for a read-only request. The negative case sets a trusted static denial, which returns `deny` without a provider call. It does not run a tool. Run `pnpm exec tsx examples/gate-tool-action/index.ts`.

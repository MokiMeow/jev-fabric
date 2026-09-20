# WebMCP transport smoke observation — 2026-09-20

Evidence: `local_exploratory`, single read-only smoke observation.

This is not a benchmark result, a Jev measurement, a DOM/CDP comparison, or a
browser-performance claim. It is retained only to show that the WebMCP
transport was reachable in one Codex in-app browser session.

| Target | Operation | Observed elapsed time | Scope |
| --- | --- | --- | --- |
| Third-party [WebMCP demo](https://webmcp-demo-sdras.netlify.app/) | `fetchTools` (3 tools) | 8.1452 ms | One discovery call. |
| Same demo | `getAvailability` (2026-09-20 through 2026-09-22) | 29.1413 ms | One read-only tool call. |
| [Chrome WebMCP documentation](https://developer.chrome.com/docs/ai/webmcp/) | `fetchTools` (0 tools) | 21.2877 ms | One discovery call with no registered tools. |

There is one observation per operation. Do not calculate p50/p95/p99,
throughput, success rate, costs, confidence intervals, or an advantage from
these values. The observations include client and transport overhead in an
unspecified live environment and are not comparable to a DOM/CDP action or a
Jev evaluation.

## Blender availability check

A read-only Blender MCP probe did not connect after 2,090 ms because Blender
was not running or listening at `127.0.0.1:9876`. This is an unmet host
precondition, not a Blender benchmark failure. No Blender result is recorded;
the Blender matrix cell remains `NOT RUN`.

## What a comparative run still needs

Use the task corpus and validator in the parent directory with a controlled
browser/engine version, machine profile, fixture digest, process warm/cold
state, concurrency, identical candidate sets, explicit action and provider
budgets, retained redacted traces, and enough independent task groups for the
declared confidence-interval method. The only valid comparison is one that
records all three architectures under the same conditions.

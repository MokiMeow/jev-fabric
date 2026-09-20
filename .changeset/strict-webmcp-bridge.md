---
"@mokimeow/jev-fabric-adapters": patch
---

Add an advisory-only binding for Vercel's experimental `mcp-handler` WebMCP
bridge. It pins the exact same-origin script asset, requires a sorted
read-only-only tool allowlist, rejects credential and path drift, binds host
policy and page state, and returns fingerprints without cookies, output, or an
execution capability.

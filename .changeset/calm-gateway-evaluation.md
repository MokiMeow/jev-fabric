---
"@mokimeow/jev-fabric-provider-typesafe": minor
---

Add a fixed Vercel AI Gateway Evaluation provider for Jev. It requests zero
data retention, no prompt training, and a TypeSafe-only provider route; maps
Choice, Boolean, and Score output into Fabric decisions; validates model,
provider, confidence, distribution, usage, and route provenance; and discards
raw generation IDs and provider cost strings.

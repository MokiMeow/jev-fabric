---
"@mokimeow/jev-fabric-provider-typesafe": patch
---

Retain a domain-separated SHA-256 digest of the official TypeSafe SDK request
ID in `evaluateWithMetadata` results while never returning the raw upstream
identifier. Obtain response data and provenance from one SDK API promise and
fail closed when an exposed request ID is malformed.

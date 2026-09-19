# RAG evidence reranking
Retrieve documents deterministically, preserve stable source identifiers, then use `rank` only to choose among the retrieved candidates. Show the chosen source and its provenance to the caller. If the corpus is stale, incomplete, or empty, abstain rather than manufacture a citation.

See [rerank-evidence](../../examples/rerank-evidence/README.md). TypeSafe’s [reranking cookbook](https://docs.typesafe.ai/cookbooks/rerank_typesafe) is a provider-specific pattern source accessed 2026-09-19.

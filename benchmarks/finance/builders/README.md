# Finance dataset builders

This directory contains the offline trust boundary for future retained finance
datasets. It does not download SEC data, install or execute ABIDES, call a model,
or grant authority to provider output.

## What is implemented

`scripts/verify.mts` verifies a prepared dataset directory against a separate,
content-addressed source cache. The directory must contain:

- `source-lock.json`, described by `schema/source-lock.schema.json`;
- `build-manifest.json`, described by `schema/build-manifest.schema.json`;
- canonical `cases.jsonl` and `provenance.jsonl` files; and
- any declared, content-addressed assets.

The verifier rejects unsafe or mutable inputs before reading benchmark evidence.
It requires exact source and artifact sizes and SHA-256 hashes, regular files with
no symlink in their path, same-handle file reads with identity checks before and
after, chunked positioned reads capped at the declared maximum plus a one-byte
overflow sentinel, credential-free canonical HTTPS source and rights URLs, resolved
redistribution rights for retained-public evidence, a full Git commit for Git
sources, canonical UTF-8 JSONL with LF endings, and a deterministic build digest.
A source lock may contain multiple immutable sources per track, up to the bounded
limit in the schema, but must cover every track and keep source IDs sorted and
unique. It also enforces issuer isolation for SEC tracks, scenario-family
isolation for ABIDES, a minimum 30-day forward embargo, and a modality-specific
hash binding between every lookahead probe, its later evidence, its late signal,
and the case projection.

Before provenance or rights classification, every `cases.jsonl` record must pass
the repository's canonical finance case schema with strict additional-property
rejection. A generated-output rights declaration therefore cannot conceal raw
source material in an extra case field.

The build manifest retains the exact builder config, label policy, and split
policy as hashed input files. Claimed generator hashes must equal those bytes.
Every output artifact also declares each source it uses and whether it retains
metadata, generated output, a source excerpt, or raw source bytes. A
`generated_output_only` source is accepted for a retained-public build only when
all declared uses are metadata or generated output; the verifier derives the
required `cases.jsonl` retention class from the actual case shape so a filing
excerpt cannot be hidden behind a metadata declaration. Unresolved and forbidden
rights always fail closed.

Run the bounded verifier directly:

```sh
tsx benchmarks/finance/builders/scripts/verify.mts \
  --dataset path/to/prepared-dataset \
  --cache path/to/read-only-source-cache
```

Compare two independently rebuilt directories with `--compare path/to/rebuild`.
Both directories must verify independently and must have the same rebuild digest.

The benchmark loader separately verifies the retained builder closure without
requiring the raw source cache. Retained-public `dataset-manifest.json` files
must include `buildManifestHash`, the SHA-256 of the exact
`build-manifest.json` bytes. The loader follows that manifest's hashes through
the source lock, cases, provenance, configuration, label and split policies,
and every visual asset, then cross-checks dataset identity, evidence class,
case set, and split dates. It returns exact verified byte snapshots so the
artifact writer cannot silently publish files changed after loading.
Visual retention is capped at 10,000 flat SVGs, 2 MiB per SVG, and 100 MiB in
aggregate; all declared limits are checked before asset bytes are retained.

This retained verification is an integrity check, not a signature. Only the
cache-backed verifier above proves that filing excerpts and source spans match
the locked source bytes; neither path authenticates who published the bundle.
Keep signing or organizational trust policy outside this hash chain.

The files in `fixtures/tiny` contain invented identifiers and values only. The
tests construct a complete three-track dataset around those bytes:

```sh
tsx --test benchmarks/finance/builders/test/verify.test.mts
```

## Deterministic visual compiler

`visual/render.mts` compiles strict structured finance series into inert,
canonical SVG and returns exact image, source-binding, and versioned artifact
binding hashes. The artifact binding seals the image and source to the declared
mutation and expected route. All date, number, scale, axis, legend, mutation,
and routing work is deterministic code; there is no network or model call. It
implements the five mutations declared by
`policies/visual-mutations.v1.json` and keeps annotations bounded and explicitly
untrusted. See [the visual compiler contract](visual/README.md) for the accepted
shape, limits, hash meanings, mutation semantics, and focused test command.

Every visual case must also retain its complete versioned compiler input and a
unique `assets/*.svg` path. The manifest must declare that SVG as a generated
asset. Verification bounded-reads the exact bytes, reruns the compiler, and
compares the SVG, image hash, source-binding hash, renderer, mutation, expected
route, and artifact seal. Undeclared, reused, missing, or consistently forged
hash tuples therefore cannot support a visual label.

## Policies

The versioned policies are inputs to a future generator. Their byte hashes must
be recorded in `build-manifest.json`; they are not suggestions for a model.

- `labels.v1.json` defines narrow operational routing labels and exclusions.
- `split.v1.json` defines the forward split and isolation units.
- `features.v1.json` forbids post-cutoff market feature inputs.
- `visual-mutations.v1.json` defines deterministic chart mutations.
- `abides-scenarios.v1.json` pins the archived ABIDES-JPMC revision and claim
  boundary.

These labels measure bounded analyst-routing behavior. They are not trading
signals, investment recommendations, findings of manipulation, or legal
conclusions.

## Explicitly future, networked steps

No command in this directory currently performs these steps. A later change may
add them only behind an explicit `--network` flag, with a reviewed candidate lock
promoted before an offline build:

1. Fetch the SEC submissions bulk archive and selected filing bodies while using
   a declared contact User-Agent, a conservative rate below the SEC's current
   maximum, bounded redirects, size limits, and atomic cache writes.
2. Fetch a fixed SEC Financial Statement Data Sets quarterly ZIP and retain only
   the declared `SUB`, `NUM`, `TAG`, and `PRE` rows needed for deterministic SVG
   fixtures.
3. Fetch ABIDES-JPMC at the full commit in `abides-scenarios.v1.json`, verify its
   BSD-3-Clause license and archive hash, and run it only in an isolated,
   hash-locked Python 3.9 environment with networking disabled and explicit
   seeds. The repository is archived; that maintenance and dependency risk must
   remain visible.
4. Build twice in fresh directories, verify both offline with the same source
   lock, and compare their rebuild digests before retaining evidence.

Raw SEC archives, filing corpora, ABIDES checkouts, environments, simulator logs,
caches, API keys, personal/contact fields, CUSIPs, and artifacts with unresolved
rights must not be committed. A future retained slice may commit only bounded
public excerpts/rows, generated SVGs, synthetic cases, provenance, rights
evidence, attribution, and required upstream notices.

Primary source references:

- SEC EDGAR APIs: <https://www.sec.gov/search-filings/edgar-application-programming-interfaces>
- SEC access and reuse policy: <https://www.sec.gov/about/privacy-information>
- SEC Financial Statement Data Sets: <https://www.sec.gov/data-research/sec-markets-data/financial-statement-data-sets>
- ABIDES-JPMC pinned license: <https://raw.githubusercontent.com/jpmorganchase/abides-jpmc-public/f9cbe51342b7dedd9587e4e069040d68a5c6477f/LICENSE>

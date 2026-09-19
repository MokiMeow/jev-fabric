# Task 6 report — evaluation, calibration, replay, and historical import

## Scope and interfaces

Added `@mokimeow/jev-fabric-evals`, exporting strict pure metrics, calibration-only threshold selection, selective risk/coverage, deterministic cluster-percentile bootstrap, run-manifest validation, deterministic reports, and read-only artifact replay. Metrics treat provider confidence as metadata: top-label ECE uses `max(distribution)` only.

The benchmark directory supplies strict versioned schemas and a historical `v0` artifact set. `scripts/import-historical.mts` parses exactly `DEEP_REGRESSION_RESULTS.json` and `ADVANCED_PATTERN_RESULTS.json` from an explicit source directory. It fails closed on secret-like text, absolute paths, and hostnames; it emits provenance hashes only and never copies raw source content.

## Evidence and verification

- RED/GREEN coverage includes hand-computed probability metrics, quantile zero, zero bootstrap seed, public threshold split leakage, incomplete manifests, tampered attempts, and the historical correction/rejection paths. Final tests cover binary/categorical Brier, NLL zero diagnostics, top-label ECE, Noul reliability, ordinal MAE/RPS, zero coverage, retry-inclusive cost, calibration-only thresholds, grouped split leakage, deterministic cluster bootstrap, digest tampering, and byte-stable replay.
- `npm exec --yes pnpm@12.4.2 -- --filter @mokimeow/jev-fabric-evals verify` — pass.
- `npm exec --yes pnpm@12.4.2 -- typecheck` — pass.
- Historical importer runs through the pinned `tsx@4.23.13` runtime: `pnpm exec tsx scripts/import-historical.mts --source .. --output benchmarks/historical/v0`. The root `import:historical` script makes that dependency an executable regression boundary; replay digest was verified from built artifacts.
- `git diff --check` — pass.

## Historical correction

All imported evidence is `local_exploratory`. Its former ECE based on TypeSafe `confidence` is explicitly marked invalid as probability calibration. Corrected ECE is `NOT RUN` because the importer deliberately does not copy raw distributions/outcomes.

## Self-review and concerns

No network/provider transport is present in replay or metrics. Artifact ordering is deterministic and replay validates the dataset digest before rendering. `tsx@4.23.13` is pinned as a root development dependency, so the documented importer command is Node 22-compatible and works from the workspace without Node 24 experimental type stripping.

## Review remediation

`evaluateCases` now returns class prevalence, denominator/outcome counts, independent groups, and deterministic seed/replicate-labelled cluster-percentile accuracy and coverage intervals. Reports render run/environment/evidence metadata, versions, denominators, group and outcome counts, prevalence, intervals, limitations, and `NA / NOT RUN`, while escaping untrusted Markdown.

The importer is invoked through the actual `tsx` CLI in temporary-directory tests. It allowlists only the two reviewed filenames and their known top-level fields; ignores unapproved neighboring files; rejects malformed/unknown JSON, secret-like values, Windows/POSIX absolute paths, hostnames, and symlink escapes (the symlink assertion is platform-skipped only when Windows denies symlink creation). It preserves only source digests/provenance, never raw content. Historical artifacts have per-file digests, byte sizes, content types, and schema versions. Corrected historical ECE remains `NOT RUN`; this importer does not claim to recompute it.

Final remediation made published manifest/calibration/conformance schemas accept the same strict fields as runtime validation and regenerated the historical report from replay metadata. Recursive importer inspection normalizes property names, rejects secret/host keys and bare host values, while allowing numeric probability labels such as `authorization` only as classification outcomes. Evaluation accounting joins decimal micro-costs to each stable transport-attempt index, so a failed `5` retry and successful `10` retry total `15`; missing any individual cost remains explicit unknown. Zero-coverage accuracy intervals now render `NA` with a `zero_coverage` reason.

The final verification dependency fetch was intentionally limited to `ajv@8.20.0` plus its normal transitive dependencies. Ajv 2020 tests compile every committed schema, validate the checked historical JSON artifacts and every JSONL row, and compare representative runtime/JSON-schema acceptance including unknown-field rejection. Replay runs with `fetch`, `http`, `https`, and `net` entry points trapped; the actual importer CLI inherits `fetch`/`http`/`https` traps (its `tsx` launcher needs local `net` IPC) and completes without network attempts.

Final schema-parity coverage recursively validates every committed benchmark JSON and every nonempty JSONL row. Golden cases now use the canonical versioned case row schema; fixtures provide nonempty valid attempt/decision/outcome rows and explicit unknown-field failures. Manifest JSON Schema now mirrors runtime minimum string constraints and ISO date-time shape, with valid/invalid run ID, split rule, timestamp, and unknown-field parity checks.

`ajv-formats@3.0.1` was added as the final authorized build-only dependency. Recursive schema validation now fails closed for an unmapped artifact (including a sentinel assertion), explicitly maps golden cases to the canonical case schema, and uses full `date-time` validation plus a required UTC `Z`. Timestamp parity covers offsets, invalid month/hour/dates, leap-day handling, missing `Z`, fractions, and valid UTC values.

The UTC timestamp pattern was tightened to exactly the runtime surface grammar: uppercase `T`/`Z`, hours 00–23, minutes/seconds 00–59, and optional one-or-more fractional digits. Ajv format validation still supplies calendar/leap-date validation. Parity probes cover lowercase separators, leap seconds, offsets, overflows, fractions, and valid uppercase UTC timestamps.

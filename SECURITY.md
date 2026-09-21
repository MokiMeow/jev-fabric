# Security policy

## Reporting a vulnerability

Use GitHub's **Report a vulnerability** button in this repository's Security tab to
create a private vulnerability report. Do not open a public issue for a suspected
vulnerability, and do not send credentials, live-provider keys, customer state, or a
personal email address.

Treat any credential pasted into chat, an issue, a pull request, logs, or a
terminal transcript as compromised: revoke or rotate it before use. The local
security gate detects labeled SDK-style values and standalone TypeSafe
`apikey_…` credential shapes without printing the matched value, but pattern
scanning is defense in depth rather than a substitute for a secret manager and
provider-side revocation. The historical-evidence importer applies the same
standalone credential-shape rejection before it writes sanitized artifacts.

Include affected version(s), a minimal safe reproduction, impact, and suggested
mitigations if known. Reports are handled on a best-effort basis by the initial
maintainer; no response-time guarantee is made during alpha.

## Supported versions

Only the current `0.1.x-alpha` line is maintained while the project is pre-1.0.

## Supply chain and publishing

Packages are released only by a GitHub-hosted workflow using npm trusted publishing and
provenance. The release job intentionally does not publish until package ownership and
npm trusted-publisher configuration are verified. It never uses an npm automation token.
The trusted publisher must be bound to this repository and the exact
`.github/workflows/release.yml` filename before the `NPM_PUBLISH_ENABLED` repository
variable is enabled. Before enabling it, create the protected `npm-production` GitHub
Environment with required reviewers and protected-`main` deployment scope. The release
job binds its SPDX source revision and real archive SHA-256/SHA-512 values, uploads the
evidence bundle, and creates an artifact attestation before it attempts npm trusted
publication. See the exact [release operations checklist](docs/release.md).

# Release operations

This document is an operator checklist. It does not enable publication and no local
command should publish a package.

## One-time external setup

1. Create the public `MokiMeow/jev-fabric` repository, set `main` as its default
   branch, and protect it with required pull requests, an independent review,
   CODEOWNERS review, resolved conversations, up-to-date commits, and the checks
   `verify-node-22.14`, `verify-node-24`, and `windows-cli-and-packaging`. Disable
   force pushes and deletion, including for administrators except through a defined
   emergency process.
2. In repository Actions settings, retain read-only default permissions and prevent
   Actions from approving pull requests. Restrict edits to workflows and release
   configuration through the ruleset/CODEOWNERS.
3. Create a GitHub Environment named exactly `npm-production`. Add required
   reviewers, restrict deployment branches to protected `main`, and allow only the
   release maintainers to administer it. Do not set `NPM_PUBLISH_ENABLED=true` yet.
4. In npm, reserve all nine `@mokimeow/jev-fabric-*` names, make them public, require
   maintainer 2FA, and configure a trusted publisher for **each package**. The trusted
   publisher must identify this repository and exactly
   `.github/workflows/release.yml`; use no automation token.
5. Enable GitHub dependency graph, Dependabot alerts/security updates, secret scanning
   and push protection, private vulnerability reporting, CodeQL, dependency review,
   and Scorecard results. Confirm the private reporting route referenced by
   [SECURITY.md](../SECURITY.md) works after the repository exists.

## Reviewed release preparation

1. Merge a normal pull request with a real pending Changeset. Package changes cannot
   merge through repository CI without one. Docs/tests-only work is exempt; the only
   release-preparation exception is the constrained, maintainer-reviewed
   `changeset-release/<name>` branch described in [.changeset/README.md](../.changeset/README.md).
   `pnpm pack:test` verifies already-built public payloads and fails clearly if a
   declared `dist` entrypoint is absent; run `pnpm build` first outside `pnpm verify`.
   The release workflow does this explicitly.
2. Run `pnpm changeset version` only in that dedicated version-preparation pull
   request, review every package version and generated changelog, and merge it to
   protected `main`. Do not run it in a local unreviewed checkout.
3. Before a first dispatch, verify all nine npm trusted-publisher bindings and the
   protected environment. Then set the repository variable `NPM_PUBLISH_ENABLED` to
   exactly `true`; retain the variable at `false` otherwise.
4. Manually dispatch the Release workflow from the reviewed `main` commit and select
   its confirmation. It verifies the already-versioned Changeset state (and fails if
   any pending Changeset remains), builds and
   packs real archives, generates SHA-256/SHA-512-bound SPDX evidence,
   uploads the SBOM/archive/checksum bundle, creates GitHub artifact attestations, and
   only then invokes npm trusted publication. The environment reviewer must approve
   the job. npm provenance is npm's separate package-publishing control.
5. Verify the downloaded `SHA256SUMS`, inspect the SPDX document's source revision and
   archive bindings, and use `gh attestation verify` against the downloaded artifacts.
   Check npm provenance and registry tarball integrity for every package before
   announcing a release.

The release workflow is intentionally unavailable until both the repository variable
and GitHub Environment gate are satisfied. Artifact attestation requires public GitHub
repository support or an eligible GitHub plan; a dispatch that cannot create evidence
must fail rather than silently publish without it.

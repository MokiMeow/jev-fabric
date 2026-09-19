# Changesets

Changesets record the user-facing version impact of a merged change. Add one with
`pnpm changeset`, commit it with the implementation, and review it as part of the
pull request.

## Deliberate alpha release process

This repository does **not** automatically open version pull requests or publish on
push. That is intentional while the public alpha is being established. A maintainer
first reviews merged Changesets and runs `pnpm changeset version` in a dedicated
version-preparation branch or pull request. After that version pull request is
merged, a maintainer may manually dispatch `.github/workflows/release.yml`.

The dispatch remains non-publishing unless the repository variable
`NPM_PUBLISH_ENABLED` is exactly `true`, its boolean confirmation is selected, npm
package ownership is configured, and npm has a trusted publisher bound to that exact
workflow file. The workflow uses OIDC and intentionally accepts no npm automation
token. Do not set the variable merely to prepare a version pull request.

Jev Fabric uses Changesets v3 for coordinated package versions and changelog entries.

Run `pnpm changeset` for a user-visible change and commit the generated markdown
file. Pull-request CI runs `pnpm changeset:check`: a change under `packages/` or
`packs/` needs a pending Changeset. Documentation and test-only changes are exempt
because they do not touch those package roots. A version-preparation branch is the
only other exemption: it must be named `changeset-release/<lowercase-name>` and may
contain only package metadata, changelogs, the lockfile, and Changesets material.
It must be maintainer-created and reviewed; it is not a contributor bypass.

Before enabling publication, run `pnpm changeset status` and review the result. The
release workflow performs the same check before it versions, packs, records SBOM
evidence, attests artifacts, and attempts trusted publication. Do not publish from a
local machine. The workflow is intentionally gated until
npm trusted publishers and package ownership are configured; see `SECURITY.md` and
the release workflow comments.

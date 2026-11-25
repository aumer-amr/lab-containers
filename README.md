# Definitely not production ready
This means any of them

## Paseo releases

Renovate proposes stable Paseo versions in `apps/paseo-codex/Dockerfile.upstream`.
After you merge an update, Release Please opens or updates the Paseo release PR.
That PR updates the build Dockerfile, `version.txt`, and the Paseo entry in `.release-please-manifest.json` together.
Merge the release PR to publish the image with the upstream version tag.
Changes to the wrapper alone produce a commit-specific image tag.

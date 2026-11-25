# Definitely not production ready
This means any of them

## Paseo releases

Renovate tracks the stable Paseo image and the stable Codex npm package in `apps/paseo-codex/Dockerfile.upstream`.
After you merge an update, Release Please opens or updates the Paseo release PR.
That PR updates the build Dockerfile, `version.txt`, and the Paseo entry in `.release-please-manifest.json` together.
The release version uses `<Paseo>+<Codex>`, for example `0.17.4+0.172.0`.
Docker image tags use a dot in place of the plus sign, for example `ghcr.io/aumer-amr/paseo-codex:0.17.4.0.172.0`.
Pin the six-part tag once in a deployment so Renovate can track updates to either dependency.
Merge the release PR to publish the image and update the stable aliases.
Changes to the wrapper alone produce a commit-specific image tag.

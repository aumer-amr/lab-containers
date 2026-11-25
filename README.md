# Definitely not production ready
This means any of them

## Paseo releases

Renovate tracks the stable Paseo image and the stable Codex npm package in `apps/paseo-codex/Dockerfile.upstream`.
After you merge an update, Release Please opens or updates the Paseo release PR.
That PR updates the build Dockerfile, `version.txt`, and the Paseo entry in `.release-please-manifest.json` together.
The GitHub release and Docker image use the same `<Paseo>-<Codex>` version, for example `0.17.4-0.172.0`.
Merge the release PR to publish the full version tag and update `ghcr.io/aumer-amr/paseo-codex:latest`.
Changes to the wrapper alone produce a commit-specific image tag.

Use `latest` to follow stable releases. If you want Renovate to propose each upgrade, pin the full tag and add this rule.
The rule lets Renovate compare both versions.

```json
{
  "packageRules": [
    {
      "matchDatasources": ["docker"],
      "matchPackageNames": ["ghcr.io/aumer-amr/paseo-codex"],
      "versioning": "loose",
      "allowedVersions": "/^\\d+\\.\\d+\\.\\d+-\\d+\\.\\d+\\.\\d+$/"
    }
  ]
}
```

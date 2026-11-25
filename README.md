# Definitely not production ready
This means any of them

## Paseo releases

Renovate tracks the stable Paseo image and the stable Codex npm package in `apps/paseo-codex/Dockerfile.upstream`.
After you merge an update, Release Please opens or updates the Paseo release PR.
That PR updates the build Dockerfile, `version.txt`, and the Paseo entry in `.release-please-manifest.json` together.
The GitHub release and Docker image use the same `<Paseo>-<Codex>` version, for example `0.17.4-0.172.0`.
Merge the release PR to publish the image and update the stable aliases.
Changes to the wrapper alone produce a commit-specific image tag.

To track the image in a deployment repository, pin the full tag and add this rule to its Renovate configuration.
The rule lets Renovate compare both versions and excludes floating tags such as `latest` and `0.17`.

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

# Project Instructions

## Repository layout

- Keep each container application in one immediate child directory: `apps/<app>`.
- An app is buildable when `apps/<app>/Dockerfile` exists. GitHub Actions discovers these Dockerfiles automatically; do not add apps to the workflow matrix.
- The Docker build context is `apps/<app>`. A Dockerfile cannot copy files from elsewhere in the repository.
- Use a lowercase app directory name suitable for the GHCR image `ghcr.io/aumer-amr/<app>`.

## Add an application

1. Create `apps/<app>/Dockerfile` and all files needed by its build context.
2. Verify it locally:

   ```sh
   docker build -f apps/<app>/Dockerfile apps/<app>
   ```

3. Register the app in `release-please-config.json`. Release registration is explicit because each app needs its own versioning strategy:

   ```json
   "apps/<app>": {
     "component": "<app>",
     "release-type": "go",
     "skip-changelog": true
   }
   ```

4. Bootstrap its version in `.release-please-manifest.json`:

   ```json
   "apps/<app>": "0.0.0"
   ```

5. Keep both JSON files valid and preserve existing app entries.

Choose `release-type` per app, not globally:

- Go: `go`; no version file required unless the app explicitly embeds one.
- Node.js: `node`; Release Please updates `package.json`.
- Python: use the matching Python strategy and existing project version metadata.
- Generic Docker app: `simple`; add `apps/<app>/version.txt` because that strategy updates it.

Use `skip-changelog: true` when the app should not maintain a generated changelog. Otherwise omit it.

## Builds

- A push to `main` finds changed immediate directories under `apps/` and builds only those containing a Dockerfile.
- Normal builds publish only a commit-specific `sha-<commit>` image tag.
- Removing an app or its Dockerfile does not trigger a build for that deleted app.
- Changes outside `apps/<app>` are not treated as app changes. Keep shared build inputs out of the repository root unless the workflow is updated with an explicit rebuild-all rule.
- `workflow_dispatch` discovers all buildable apps when no release is pending.

## Releases

- Use Conventional Commits for changes inside an app:
  - `fix:` requests a patch release.
  - `feat:` requests a minor release.
  - `feat!:`, `fix!:`, or a `BREAKING CHANGE:` footer requests a major release.
- Release Please creates a separate release PR for each changed app.
- Repository Actions settings must allow workflows to create pull requests.
- Review and merge that release PR to publish. Do not manually edit an established app version in `.release-please-manifest.json`; Release Please owns it after bootstrap.
- Merging a release PR creates the component tag and GitHub Release, then builds only released apps in the same workflow.
- Component tags use `<app>-v<version>`, for example `arma3-tac-map-v1.2.3`.
- Stable images receive `1.2.3`, `1.2`, `1`, and `latest`. Major tag `0` is intentionally omitted during initial `0.x` development.
- Prereleases publish only their full version and do not move `latest` or major/minor aliases.
- Never publish `latest` from an ordinary `main` build; only a stable release may move it.

## Workflow maintenance

- Keep dynamic discovery in `.github/workflows/action-build.yaml`; do not restore a hardcoded app matrix.
- Build release images in the Release Please workflow. Tags created with the default `GITHUB_TOKEN` do not trigger a second workflow.
- Preserve least-privilege job permissions: release preparation needs `contents: write` and `pull-requests: write`; image jobs need `contents: read` and `packages: write`.
- Validate workflow edits with `actionlint`, validate both Release Please files as JSON, and run `git diff --check`.
- Do not stage, commit, or modify unrelated app files or plans.

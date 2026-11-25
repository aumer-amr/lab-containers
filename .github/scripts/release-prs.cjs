const { GitHub, Manifest, registerReleaseType } = require('release-please');
const { Simple } = require('release-please/build/src/strategies/simple');
const { Version } = require('release-please/build/src/version');

const paseo = 'apps/paseo-codex';
const imageLine = /^FROM ghcr\.io\/getpaseo\/paseo:(\d+\.\d+\.\d+)@sha256:[a-f0-9]{64}$/gm;

function readPin(dockerfile) {
  const matches = [...dockerfile.matchAll(imageLine)];
  if (matches.length !== 1) throw new Error('Expected one pinned stable Paseo base image');
  return { line: matches[0][0], version: Version.parse(matches[0][1]) };
}

function configurePaseo(manifest, pin) {
  const change = pin.version.compare(manifest.releasedVersions[paseo]);
  if (change < 0) throw new Error('The upstream Paseo version is older than the release manifest');
  if (change === 0) {
    // Wrapper-only changes still get SHA images. A stable tag belongs to one upstream release.
    delete manifest.repositoryConfig[paseo];
    return;
  }

  class PaseoRelease extends Simple {
    buildReleasePullRequest(commits, latest, draft, labels) {
      return super.buildReleasePullRequest(commits, latest, draft, labels, { newVersion: pin.version });
    }

    async buildUpdates(options) {
      const updates = await super.buildUpdates(options);
      updates.push({
        path: `${paseo}/Dockerfile`,
        createIfMissing: false,
        updater: {
          updateContent(content) {
            return content.replace(readPin(content).line, pin.line);
          },
        },
      });
      return updates;
    }
  }

  registerReleaseType('paseo-upstream', options => new PaseoRelease(options));
  manifest.repositoryConfig[paseo].releaseType = 'paseo-upstream';
}

async function main() {
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
  const branch = process.env.TARGET_BRANCH;
  const github = await GitHub.create({ owner, repo, token: process.env.GITHUB_TOKEN });
  const manifest = await Manifest.fromManifest(github, branch);
  if (manifest.repositoryConfig[paseo]) {
    const file = await github.getFileContentsOnBranch(`${paseo}/Dockerfile.upstream`, branch);
    configurePaseo(manifest, readPin(file.parsedContent));
  }
  await manifest.createPullRequests();
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
module.exports = { configurePaseo, readPin };

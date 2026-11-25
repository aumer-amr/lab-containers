const { GitHub, Manifest, registerReleaseType } = require('release-please');
const { Simple } = require('release-please/build/src/strategies/simple');
const { Version } = require('release-please/build/src/version');

const paseo = 'apps/paseo-codex';
const imageLine = /^FROM ghcr\.io\/getpaseo\/paseo:(\d+\.\d+\.\d+)@sha256:[a-f0-9]{64}$/gm;
const codexPackage = /@openai\/codex@(\d+\.\d+\.\d+)(?=\s|$)/g;

function readPin(dockerfile) {
  const images = [...dockerfile.matchAll(imageLine)];
  const packages = [...dockerfile.matchAll(codexPackage)];
  if (images.length !== 1 || packages.length !== 1) {
    throw new Error('Expected one pinned stable Paseo image and one pinned stable Codex package');
  }
  return {
    line: images[0][0],
    codex: packages[0][0],
    version: Version.parse(`${images[0][1]}+${packages[0][1]}`),
  };
}

function configurePaseo(manifest, pin) {
  const released = manifest.releasedVersions[paseo];
  // SemVer ignores build metadata when comparing versions. Older releases had no Codex pin in the version.
  const olderCodex = released.build && Version.parse(pin.version.build).compare(Version.parse(released.build)) < 0;
  if (pin.version.compare(released) < 0 || olderCodex) {
    throw new Error('The Paseo or Codex pin is older than the release manifest');
  }
  if (pin.version.toString() === released.toString()) {
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
            const current = readPin(content);
            return content.replace(current.line, pin.line).replace(current.codex, pin.codex);
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

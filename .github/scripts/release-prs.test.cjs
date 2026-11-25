const assert = require('node:assert/strict');
const test = require('node:test');
const { Manifest } = require('release-please');
const { Simple } = require('release-please/build/src/strategies/simple');
const { Version } = require('release-please/build/src/version');
const { configurePaseo, readPin } = require('./release-prs.cjs');

const path = 'apps/paseo-codex';
const oldPin = 'FROM ghcr.io/getpaseo/paseo:0.17.4@sha256:' + 'a'.repeat(64) + '\nRUN npm install -g @openai/codex@0.163.0';
const codexUpdate = oldPin.replace('@0.163.0', '@0.172.0');
const paseoUpdate = 'FROM ghcr.io/getpaseo/paseo:0.19.2@sha256:' + 'b'.repeat(64) + '\nRUN npm install -g @openai/codex@0.163.0';
const github = {
  repository: { owner: 'example', repo: 'containers' },
  async *releaseIterator() {},
  async *tagIterator() {},
  async *mergeCommitIterator() {},
};

async function checkRelease(previousVersion, nextPin, expected) {
  const config = { [path]: { component: 'paseo-codex', releaseType: 'simple', skipChangelog: true } };
  const manifest = new Manifest(github, 'main', config, { [path]: Version.parse(previousVersion) }, {
    separatePullRequests: true,
  });
  configurePaseo(manifest, readPin(nextPin));
  const [pr] = await manifest.buildPullRequests();
  assert.equal(pr.version.toString(), expected);
  const updates = Object.fromEntries(pr.updates.map(update => [update.path, update.updater]));
  assert.equal(updates[path + '/Dockerfile'].updateContent(oldPin + '\nUSER root'), nextPin + '\nUSER root');
  assert.equal(updates[path + '/version.txt'].updateContent(previousVersion).trim(), expected);
  const previous = { [path]: previousVersion, 'apps/other': '1.2.3' };
  const updated = updates['.release-please-manifest.json'].updateContent(JSON.stringify(previous));
  assert.deepEqual(JSON.parse(updated), { ...previous, [path]: expected });
  const strategy = new Simple({
    github, component: 'paseo-codex', path, targetBranch: 'main',
  });
  const release = await strategy.buildRelease({
    title: pr.title.toString(), body: pr.body.toString(), headBranchName: pr.headRefName, sha: 'abcd',
  });
  assert.equal(release.tag.toString(), 'paseo-codex-v' + expected);
}

test('a legacy release gains the Codex version', async () => {
  await checkRelease('0.17.4', codexUpdate, '0.17.4+0.172.0');
});

test('a Codex-only update creates a release despite equal SemVer precedence', async () => {
  await checkRelease('0.17.4+0.163.0', codexUpdate, '0.17.4+0.172.0');
});

test('a Paseo-only update preserves the Codex version', async () => {
  await checkRelease('0.17.4+0.163.0', paseoUpdate, '0.19.2+0.163.0');
});

test('wrapper-only changes keep the released version and other apps remain eligible', () => {
  const manifest = {
    repositoryConfig: { [path]: {}, 'apps/other': {} },
    releasedVersions: { [path]: Version.parse('0.17.4+0.163.0') },
  };
  configurePaseo(manifest, readPin(oldPin));
  assert.deepEqual(manifest.repositoryConfig, { 'apps/other': {} });
});

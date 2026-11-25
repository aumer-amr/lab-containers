const assert = require('node:assert/strict');
const test = require('node:test');
const { Manifest } = require('release-please');
const { Version } = require('release-please/build/src/version');
const { configurePaseo, readPin } = require('./release-prs.cjs');

const path = 'apps/paseo-codex';
const oldPin = 'FROM ghcr.io/getpaseo/paseo:0.17.4@sha256:' + 'a'.repeat(64);
const newPin = 'FROM ghcr.io/getpaseo/paseo:0.19.2@sha256:' + 'b'.repeat(64);
const github = {
  repository: { owner: 'example', repo: 'containers' },
  async *releaseIterator() {},
  async *tagIterator() {},
  async *mergeCommitIterator() {},
};

test('a skipped upstream version promotes the pin, version file and manifest together', async () => {
  const config = { [path]: { component: 'paseo-codex', releaseType: 'simple', skipChangelog: true } };
  const manifest = new Manifest(github, 'main', config, { [path]: Version.parse('0.17.4') }, {
    separatePullRequests: true,
  });
  configurePaseo(manifest, readPin(newPin));
  const [pr] = await manifest.buildPullRequests();
  assert.equal(pr.version.toString(), '0.19.2');
  const updates = Object.fromEntries(pr.updates.map(update => [update.path, update.updater]));
  assert.equal(updates[path + '/Dockerfile'].updateContent(oldPin + '\nUSER root'), newPin + '\nUSER root');
  assert.equal(updates[path + '/version.txt'].updateContent('0.17.4\n').trim(), '0.19.2');
  const previous = { [path]: '0.17.4', 'apps/other': '1.2.3' };
  const updated = updates['.release-please-manifest.json'].updateContent(JSON.stringify(previous));
  assert.deepEqual(JSON.parse(updated), { ...previous, [path]: '0.19.2' });
});

test('wrapper-only changes keep the released version and other apps remain eligible', () => {
  const manifest = {
    repositoryConfig: { [path]: {}, 'apps/other': {} },
    releasedVersions: { [path]: Version.parse('0.17.4') },
  };
  configurePaseo(manifest, readPin(oldPin));
  assert.deepEqual(manifest.repositoryConfig, { 'apps/other': {} });
});

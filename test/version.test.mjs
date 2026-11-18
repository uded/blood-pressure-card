import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERSION } from '../blood-pressure-card.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('VERSION in the card matches package.json', () => {
  assert.equal(VERSION, pkg.version);
});

test('version is plain semver, so the release tag can be checked against it', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
});

test('release tag check: tag must equal v + VERSION', async () => {
  const { checkTag } = await import('../scripts/check-release.mjs');
  assert.doesNotThrow(() => checkTag(`v${VERSION}`, VERSION, pkg.version));
  assert.throws(() => checkTag('v9.9.9', VERSION, pkg.version), /does not match/);
  assert.throws(() => checkTag(`v${VERSION}`, VERSION, '0.0.1'), /package\.json/);
  assert.throws(() => checkTag('latest', VERSION, pkg.version), /tag/);
});

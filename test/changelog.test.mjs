import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERSION } from '../blood-pressure-card.js';
import { notesFor } from '../scripts/release-notes.mjs';

const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');

test('CHANGELOG has a section for the current version', () => {
  assert.ok(notesFor(changelog, VERSION).trim().length > 0);
});

test('notesFor returns only that version section, without its heading', () => {
  const md = '# Changelog\n\n## 1.1.0\n\n### Fixed\n- b\n\n## 1.0.0\n\n- a\n';
  assert.equal(notesFor(md, '1.1.0'), '### Fixed\n- b');
  assert.equal(notesFor(md, '1.0.0'), '- a');
});

test('notesFor throws for a version with no section', () => {
  assert.throws(() => notesFor('## 1.0.0\n- a\n', '2.0.0'), /2\.0\.0/);
});

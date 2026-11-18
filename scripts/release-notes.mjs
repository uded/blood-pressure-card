// Print the CHANGELOG.md section for one version, used as the GitHub release
// notes (what HACS shows in its update dialog).
// Usage in CI: node scripts/release-notes.mjs 0.2.3 > notes.md
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function notesFor(changelog, version) {
  const lines = changelog.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${version}`);
  if (start < 0) throw new Error(`CHANGELOG.md has no "## ${version}" section`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## /.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const md = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  console.log(notesFor(md, process.argv[2]));
}

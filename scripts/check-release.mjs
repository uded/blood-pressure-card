// Release guard: the pushed tag, package.json and the card's VERSION must all
// agree, so the asset HACS installs is exactly the tagged source.
// Usage in CI: node scripts/check-release.mjs "$GITHUB_REF_NAME"
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SEMVER_TAG = /^v(\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?)$/;

export function checkTag(tag, cardVersion, pkgVersion) {
  const m = SEMVER_TAG.exec(tag || '');
  if (!m) throw new Error(`tag ${JSON.stringify(tag)} is not vMAJOR.MINOR.PATCH`);
  if (pkgVersion !== cardVersion) {
    throw new Error(`package.json version ${pkgVersion} differs from VERSION ${cardVersion}`);
  }
  if (m[1] !== cardVersion) throw new Error(`tag ${tag} does not match VERSION ${cardVersion}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL('../', import.meta.url);
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  const src = readFileSync(new URL('blood-pressure-card.js', root), 'utf8');
  const found = src.match(/^export const VERSION = '([^']+)';$/m);
  if (!found) throw new Error('VERSION constant not found in blood-pressure-card.js');
  checkTag(process.argv[2], found[1], pkg.version);
  console.log(`release ${process.argv[2]} matches package.json and VERSION`);
}

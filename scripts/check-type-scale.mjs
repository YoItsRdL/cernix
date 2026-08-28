#!/usr/bin/env node
/**
 * Enforces the type scale's rank order.
 *
 * This exists because the scale was silently inverted for a long time:
 * `label` (buttons, menu items) sat at 13.5px while `heading` sat at
 * 10.5px, so every button in the app outranked every heading. Nobody
 * saw it while the whole scale was 8–13px. The moment the sizes grew,
 * "IMPORT FOLDER" was visibly larger than the heading above it.
 *
 * A comment would not have caught that. An ordering check does.
 *
 * The rule: a role may never be larger than the role above it, and
 * controls sit at body size. macOS control text and body text are both
 * 13pt for the same reason. A control is not more important than the
 * heading it sits under.
 *
 * Usage:  npm run check:type
 * Exit:   0 ordered, 1 violated, 2 could not run
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKENS = path.resolve(__dirname, '..', 'src/shared/tokens.css');

/** Smallest first. Roles on the same rank must be equal in size. */
const RANKS = [
  ['micro'],
  ['metadata', 'caption'],
  ['code'],
  ['body', 'label'],
  ['heading'],
  ['subtitle'],
  ['title'],
  ['display'],
];

/** Controls must not exceed the heading above them. */
const CONTROL = 'label';
const MUST_EXCEED_CONTROL = ['heading', 'subtitle', 'title', 'display'];

if (!fs.existsSync(TOKENS)) {
  console.error(`Cannot read ${TOKENS}.`);
  console.error('The token file moved: fix TOKENS rather than deleting this check.');
  process.exit(2);
}

const css = fs.readFileSync(TOKENS, 'utf8');
const sizes = {};
for (const m of css.matchAll(/^\s*--text-([a-z-]+)\s*:\s*([\d.]+)px\s*;/gm)) {
  if (m[1].includes('landing') || m[1] === 'hero') continue; // separate web scale
  sizes[m[1]] = parseFloat(m[2]);
}

const flat = RANKS.flat();
const missing = flat.filter(r => sizes[r] === undefined);
if (missing.length) {
  console.error(`Role(s) missing from the scale: ${missing.join(', ')}.`);
  console.error('Renamed or removed? Update RANKS: do not drop the ordering contract.');
  process.exit(2);
}

console.log('=== Type scale order ===\n');
for (const rank of RANKS) {
  console.log('  ' + rank.map(r => `${r} ${sizes[r]}px`).join('  =  '));
}
console.log('');

const problems = [];

// Equal within a rank.
for (const rank of RANKS) {
  const vals = [...new Set(rank.map(r => sizes[r]))];
  if (vals.length > 1) {
    problems.push(`${rank.join(' and ')} share a rank but differ: ${rank.map(r => `${r} ${sizes[r]}px`).join(', ')}`);
  }
}

// Strictly increasing between ranks.
for (let i = 1; i < RANKS.length; i++) {
  const lo = sizes[RANKS[i - 1][0]], hi = sizes[RANKS[i][0]];
  if (hi <= lo) {
    problems.push(`${RANKS[i][0]} (${hi}px) must be larger than ${RANKS[i - 1][0]} (${lo}px)`);
  }
}

// The rule the old scale actually broke.
for (const role of MUST_EXCEED_CONTROL) {
  if (sizes[role] <= sizes[CONTROL]) {
    problems.push(`${role} (${sizes[role]}px) must be larger than ${CONTROL} (${sizes[CONTROL]}px): a button cannot outrank a heading`);
  }
}

// Round numbers only. Fractional sizes came from scaling a wrong scale.
for (const [role, px] of Object.entries(sizes)) {
  if (!Number.isInteger(px)) problems.push(`${role} is ${px}px: the in-app scale uses whole pixels`);
}

if (problems.length) {
  for (const p of problems) console.error('  FAIL  ' + p);
  console.error('\n  Sizes come from the --text-* tokens in src/shared/tokens.css.');
  process.exit(1);
}

console.log(`Order holds across ${flat.length} roles. Controls sit at body size.`);

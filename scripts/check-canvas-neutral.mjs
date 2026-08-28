#!/usr/bin/env node
/**
 * Enforces the viewer's chrome being achromatic.
 *
 * It began as a guard on the editor's canvas surround: a tinted ground
 * shifts perceived white balance and skin tone, so edits judged against
 * it drift the other way everywhere else, which is why Lightroom and
 * Capture One are neutral grey. That surround is tinted by decision
 * now, so it is no longer here.
 *
 * This exists because that is exactly the kind of exception a future
 * palette sweep erases by accident: the tokens look like the only two
 * greys in a warm file, and "fixing" them is a one-line change nobody
 * would question. The check makes it fail loudly instead.
 *
 * Usage:  node scripts/check-canvas-neutral.mjs
 * Exit:   0 neutral, 1 chroma found, 2 could not run
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKENS = path.resolve(__dirname, '..', 'src/shared/tokens.css');

/**
 * Tokens that must stay achromatic, in every mode block.
 *
 * Two have left this list, each deliberately and each recorded on the
 * token itself: `--viewer-field`, because the viewer's ground is
 * `--background` so the room belongs to the application around it, and
 * `--canvas-surround`, because the editor's stage now carries a little
 * of the palette's chroma for the same reason.
 *
 * What remains is the chrome that sits ON a photograph. A chip or a
 * glyph with a hue in it, laid over someone's frame, tints the thing
 * immediately beside the pixels they are judging. The narrowest and
 * least arguable version of the rule this file was written for.
 */
const GUARDED = ['--viewer-chip', '--viewer-chip-hover', '--viewer-border', '--viewer-text', '--viewer-text-muted'];

/** Chroma at or below this counts as neutral; oklch chroma is 0–0.4. */
const EPSILON = 0.001;

if (!fs.existsSync(TOKENS)) {
  console.error(`Cannot read ${TOKENS}.`);
  console.error('The token file moved: fix TOKENS here rather than deleting this check.');
  process.exit(2);
}

const css = fs.readFileSync(TOKENS, 'utf8');
const found = [];
const problems = [];

for (const name of GUARDED) {
  const re = new RegExp(`${name}\\s*:\\s*([^;]+);`, 'g');
  let m;
  while ((m = re.exec(css)) !== null) {
    const value = m[1].trim();
    found.push({ name, value });

    const ok = /^oklch\(\s*[\d.]+\s+0(\.0*)?\s+[\d.]+\s*(\/.*)?\)$/i.exec(value);
    if (ok) continue;

    const parsed = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(value);
    if (!parsed) {
      problems.push(`${name}: ${value}\n      not a plain oklch() literal, so its chroma cannot be verified`);
      continue;
    }
    const chroma = parseFloat(parsed[2]);
    if (chroma > EPSILON) {
      problems.push(`${name}: ${value}\n      chroma ${chroma} exceeds ${EPSILON}, chrome that sits on a photograph must be achromatic`);
    }
  }
}

// A rename would otherwise pass silently by matching nothing at all.
const missing = GUARDED.filter(n => !found.some(f => f.name === n));
if (missing.length) {
  console.error(`Guarded token(s) not found in tokens.css: ${missing.join(', ')}`);
  console.error('Renamed or removed? Update GUARDED: do not drop the contract.');
  process.exit(2);
}

console.log('=== Editor canvas neutrality ===\n');
for (const f of found) console.log(`  ${f.name.padEnd(20)} ${f.value}`);
console.log('');

if (problems.length) {
  for (const p of problems) console.error(`  FAIL  ${p}`);
  console.error('\nChrome in the viewing room carries no hue: it sits on a');
  console.error('photograph, and a tint beside the pixels someone is judging');
  console.error('is a tint they will edit against.');
  process.exit(1);
}

console.log(`All ${found.length} viewer chrome token(s) achromatic, in every mode.`);

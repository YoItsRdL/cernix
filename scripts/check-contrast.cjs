#!/usr/bin/env node
/**
 * WCAG contrast check across both themes.
 *
 * Runs under Electron, and it has to. The palette is OKLCH and the
 * derived roles are `color-mix()` expressions that Tailwind inlines into
 * utilities, so they are not variables and there is nothing for a
 * regex to read. Anything short of a real engine would be re-implementing
 * colour interpolation and hoping it matches what Chromium paints.
 *
 * Resolution goes: expression -> getComputedStyle (gives back oklab) ->
 * canvas fillStyle -> readback of the actual sRGB bytes. That last hop
 * matters; converting OKLab to sRGB by hand is where a checker quietly
 * starts measuring something other than what is on screen.
 *
 * The predecessor to this script read the wrong file for an unknown
 * period and reported eight fabricated failures, which looked exactly
 * like eight real ones. So: a check that cannot run exits 2 and says so,
 * separately from a check that ran and found problems, which exits 1.
 *
 * Usage:  npm run check:contrast
 */
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync, rmSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TOKENS = path.join(ROOT, 'src/shared/tokens.css');

/**
 * The pairs the interface promises, and the ratio each owes: 4.5 for
 * body text, 3.0 where the role is deliberately recessive metadata that
 * only has to clear AA Large.
 */
const PAIRS = [
  // Body and heading text on each surface level.
  ['text-emphatic', 'surface-workspace', 4.5],
  ['text-emphatic', 'surface-panel', 4.5],
  ['text-emphatic', 'surface-raised', 4.5],
  ['text-default', 'surface-workspace', 4.5],
  ['text-default', 'surface-panel', 4.5],
  ['text-default', 'surface-raised', 4.5],

  // Metadata and captions. Dense Lightroom-style UI, AA Large floor.
  ['text-muted', 'surface-workspace', 3.0],
  ['text-muted', 'surface-panel', 3.0],
  ['text-muted', 'surface-raised', 3.0],

  // The pair flagged when the palette landed: muted-foreground on muted
  // is what the metadata columns actually sit on.
  ['muted-foreground', 'muted', 3.0],

  // shadcn primitives, on their own grounds.
  ['foreground', 'background', 4.5],
  ['foreground', 'card', 4.5],
  ['foreground', 'popover', 4.5],
  ['primary-foreground', 'primary', 4.5],
  ['accent-foreground', 'accent', 4.5],
  ['destructive-foreground', 'destructive', 4.5],
  ['secondary-foreground', 'secondary', 4.5],

  // The sidebar family. It paints the app's most prominent control.
  // The active nav pill, and had no coverage here at all, which is
  // how it kept shipping near-white on terracotta at 2.69:1 while the
  // identical primary pair was measured and fixed.
  // The viewing room. Constant across themes, so one measurement covers
  // both; it is listed anyway because a regression here is invisible in
  // whichever theme the author happens to be running.
  // Curve strokes are meaningful graphical objects, so they answer to
  // the 3:1 non-text bar rather than the 4.5 text one. The luma curve
  // shipped as pure white on the light theme's cream plot, which is the
  // kind of thing only a measurement catches.
  ['curve-luma', 'surface-workspace', 3.0],
  ['curve-r', 'surface-workspace', 3.0],
  ['curve-g', 'surface-workspace', 3.0],
  ['curve-b', 'surface-workspace', 3.0],

  ['viewer-text', 'viewer-chip', 4.5],
  ['viewer-text-muted', 'viewer-chip', 3.0],
  // The room's floor carries text of its own. The filename sits
  // directly on it, and now that the field follows the theme, both
  // modes have to be measured rather than one.
  ['viewer-text', 'viewer-field', 4.5],
  ['viewer-text-muted', 'viewer-field', 3.0],

  ['sidebar-primary-foreground', 'sidebar-primary', 4.5],
  ['sidebar-foreground', 'sidebar', 4.5],
  ['sidebar-accent-foreground', 'sidebar-accent', 4.5],

  // Teal is the cloud/sync identity and is used as TEXT on panels.
  // Drive log lines, share badges, folder marks, so it has to be
  // legible, not merely present.
  ['secondary', 'surface-panel', 3.0],
  ['secondary', 'surface-workspace', 3.0],

  // Status colours have to be readable as text, not just visible.
  ['status-success', 'surface-panel', 3.0],
  ['status-warn', 'surface-panel', 3.0],
  ['status-danger', 'surface-panel', 3.0],
  ['status-info', 'surface-panel', 3.0],

  // Categorical tints in the terminal, which sits on the panel.
  ['cat-sweep', 'surface-panel', 3.0],
  ['cat-upload', 'surface-panel', 3.0],
  ['cat-video', 'surface-panel', 3.0],
  ['cat-editor', 'surface-panel', 3.0],
];

/**
 * Pairs that sit below their threshold on purpose, keyed `mode|fg|bg`.
 *
 * These are the accent pairs the tweakcn export ships. We darkened them
 * until they passed and the theme stopped looking like the one we chose,
 * so the decision was to match the reference. Recorded here rather than
 * by lowering a threshold or deleting a row, because the difference
 * matters: a threshold change hides every future regression on that
 * pair, an exception hides exactly one known value.
 *
 * Each entry still gets measured and printed with its real ratio. If a
 * pair listed here starts passing, this check says so and asks for the
 * entry to be removed. An exception that no longer applies is just a
 * hole in the coverage.
 *
 * Each entry carries its own justification below.
 */
const ACCEPTED = new Map([
  ['light|primary-foreground|primary', 'export white on terracotta, ~2.69:1'],
  ['light|sidebar-primary-foreground|sidebar-primary', 'same pair as primary'],
  ['light|secondary-foreground|secondary', 'export white on teal, ~4.03:1 (dark passes at 4.75)'],
  ['light|sidebar-accent-foreground|sidebar-accent', 'same teal as secondary'],
]);

/**
 * `text-disabled` is intentionally low contrast. It signals
 * unavailability, so it is reported for visibility but never failed.
 */
const ADVISORY = [
  ['text-disabled', 'surface-panel'],
  ['text-disabled', 'surface-raised'],
];

function fail(msg, code) {
  console.error('\n  ' + msg + '\n');
  app.exit(code);
}

/** Relative luminance, WCAG 2.x, from 8-bit sRGB. */
function luminance([r, g, b]) {
  const lin = v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(fg, bg) {
  const a = luminance(fg), b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** Pull `--color-<name>: <expr>;` out of every @theme inline block. */
function parseThemeColors(css) {
  const out = {};
  for (const block of css.matchAll(/@theme\s+inline\s*\{/g)) {
    let i = block.index + block[0].length, depth = 1;
    const start = i;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    const body = css.slice(start, i - 1).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of body.matchAll(/--color-([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
      out[m[1]] = m[2].trim();
    }
  }
  return out;
}

async function main() {
  await app.whenReady();

  let css;
  try { css = readFileSync(TOKENS, 'utf8'); }
  catch { return fail(`Cannot read ${path.relative(ROOT, TOKENS)}. The token file moved: fix TOKENS.`, 2); }

  const colors = parseThemeColors(css);
  if (Object.keys(colors).length === 0) {
    return fail('No colours parsed from the @theme inline blocks.\n  The token file format changed: fix parseThemeColors rather than deleting this check.', 2);
  }

  const needed = [...new Set([...PAIRS, ...ADVISORY].flatMap(p => [p[0], p[1]]))];
  const missing = needed.filter(n => !colors[n]);
  if (missing.length) {
    return fail(`Token(s) referenced by this check no longer exist: ${missing.join(', ')}.\n  Renamed or removed? Update PAIRS, do not drop the coverage.`, 2);
  }

  const win = new BrowserWindow({ show: false, width: 400, height: 300 });
  const host = path.join(ROOT, 'node_modules', '.contrast-host.html');
  writeFileSync(host, `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="probe"></div>`);
  await win.loadFile(host);

  // Dark mode is toggled on <html>, exactly as the app does it, and
  // measured in two passes.
  //
  // The obvious shortcut (two sibling divs, one with the attribute) 
  // measures something the app never renders. Layer 2 overrides are
  // declared on :root, which IS <html>; a nested [data-theme] div
  // matches the layer-1 dark block directly, and a direct match beats
  // an inherited one. The check then reads the export value while the
  // app renders the override. That silently hid a contrast override
  // from its own verification.
  const measured = await win.webContents.executeJavaScript(`
    (() => {
      const COLORS = ${JSON.stringify(colors)};
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      const probe = document.getElementById('probe');
      const out = {};
      for (const mode of ['light', 'dark']) {
        document.documentElement.classList.toggle('dark', mode === 'dark');
        for (const [name, expr] of Object.entries(COLORS)) {
          probe.style.backgroundColor = '';
          probe.style.backgroundColor = expr;
          const resolved = getComputedStyle(probe).backgroundColor;
          // Canvas readback converts whatever colour space the engine
          // resolved to into the sRGB bytes actually painted.
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = '#000';
          ctx.fillStyle = resolved;
          ctx.fillRect(0, 0, 1, 1);
          const d = ctx.getImageData(0, 0, 1, 1).data;
          out[mode + '|' + name] = [d[0], d[1], d[2], d[3]];
        }
      }
      document.documentElement.classList.remove('dark');
      return out;
    })()
  `);
  rmSync(host, { force: true });

  // ── Window chrome must match --background in each mode ──
  //
  // BrowserWindow needs a literal hex at construction, so
  // WINDOW_BACKGROUND in src/main/constants.ts cannot read the token.
  // A duplicated colour drifts silently, and the symptom is a flash of
  // the wrong theme on every launch. Irritating, easy to miss in
  // review, and invisible to every other check. Since this script has
  // already resolved the real values, comparing them is nearly free.
  const constantsSrc = readFileSync(path.join(ROOT, 'src/main/constants.ts'), 'utf8');
  const declared = {};
  const wb = /WINDOW_BACKGROUND[^{]*\{([\s\S]*?)\}/.exec(constantsSrc);
  if (wb) for (const m of wb[1].matchAll(/(light|dark)\s*:\s*'(#[0-9a-f]{6})'/gi)) declared[m[1]] = m[2].toLowerCase();

  const chromeProblems = [];
  for (const mode of ['light', 'dark']) {
    const [r, g, b] = measured[mode + '|background'];
    const actual = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    if (!declared[mode]) chromeProblems.push(`WINDOW_BACKGROUND.${mode} not found in constants.ts`);
    else if (declared[mode] !== actual) chromeProblems.push(`WINDOW_BACKGROUND.${mode} is ${declared[mode]} but --background resolves to ${actual}`);
  }

  console.log('=== Cernix contrast: both themes ===\n');
  let failures = 0;
  const acceptedHits = [], stale = [];

  for (const mode of ['light', 'dark']) {
    console.log(`  ${mode.toUpperCase()}`);
    console.log('  ' + 'pair'.padEnd(46) + 'ratio'.padStart(8) + '   min   result');
    console.log('  ' + '-'.repeat(74));

    for (const [fg, bg, min] of PAIRS) {
      const f = measured[mode + '|' + fg], b = measured[mode + '|' + bg];
      const r = ratio(f, b);
      const ok = r >= min;
      const key = mode + '|' + fg + '|' + bg;
      const accepted = ACCEPTED.get(key);
      let verdict;
      if (ok && accepted) {
        verdict = 'pass';
        stale.push(`${key} passes at ${r.toFixed(2)}: drop its ACCEPTED entry`);
      } else if (ok) {
        verdict = 'pass';
      } else if (accepted) {
        verdict = 'ACCEPTED';
        acceptedHits.push(`${mode}: ${fg} on ${bg}, ${r.toFixed(2)}:1 (${accepted})`);
      } else {
        verdict = 'FAIL';
        failures++;
      }
      console.log('  ' + `${fg} on ${bg}`.padEnd(46) + r.toFixed(2).padStart(8) + `   ${min.toFixed(1)}   ` + verdict);
    }
    for (const [fg, bg] of ADVISORY) {
      const r = ratio(measured[mode + '|' + fg], measured[mode + '|' + bg]);
      console.log('  ' + `${fg} on ${bg}`.padEnd(46) + r.toFixed(2).padStart(8) + '     -   advisory');
    }
    console.log('');
  }

  if (chromeProblems.length) {
    console.error('  Window chrome:');
    for (const c of chromeProblems) console.error('    FAIL  ' + c);
    console.error('');
    failures += chromeProblems.length;
  } else {
    console.log('  Window chrome matches --background in both modes.\n');
  }

  if (acceptedHits.length) {
    console.log('  Below threshold by decision:');
    for (const a of acceptedHits) console.log('    ACCEPTED  ' + a);
    console.log('');
  }

  if (stale.length) {
    console.error('  Stale exceptions: these now pass and must be re-armed:');
    for (const t of stale) console.error('    ' + t);
    console.error('');
    failures += stale.length;
  }

  if (failures) {
    console.error(`  ${failures} pair(s) below threshold.`);
    console.error('  Move the token, not the threshold. A threshold changes only with');
    console.error('  a written justification in the ACCEPTED map above.');
    app.exit(1);
    return;
  }
  console.log(`  ${PAIRS.length * 2 - acceptedHits.length} of ${PAIRS.length * 2} checks pass across both themes` +
    (acceptedHits.length ? `, ${acceptedHits.length} accepted above.` : '.'));
  app.exit(0);
}

main().catch(e => { console.error(e); app.exit(2); });

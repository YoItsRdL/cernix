/**
 * Measures whether the visual hierarchy actually reads.
 *
 * Contrast checking covers text on surfaces. It says nothing about
 * whether two adjacent PANELS can be told apart, or whether a hover
 * wash is visible on the surface it sits on. Those are the failures a
 * derived palette produces: everything passes, and the UI still looks
 * flat because two planes landed a fraction of a percent apart.
 *
 * Separation is measured in OKLab L, which is perceptually uniform, so
 * a threshold means the same thing at both ends of the range.
 *
 * It earned its place immediately: surface-overlay had been mapped to
 * --popover, which is near-white in light mode. Every modal backdrop
 * would have washed the app out instead of dimming it, and the crop
 * tool would have brightened the excluded area rather than darkening
 * it. Contrast checking cannot see that; plane separation can.
 *
 * Requires a build: it reads dist/assets, because the derived roles
 * only exist inside generated utilities.
 */
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync, readdirSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// Planes that sit directly on each other in the UI.
//
// A pair passes if the FILLS differ, or if a border between them
// does. That is not a loosened threshold. It is how this theme
// actually builds hierarchy: its dark --background (0.1797) and
// --card (0.1822) are all but identical on purpose, and the plane
// boundary is drawn with --border instead. Requiring a fill step
// would fail a design that is working, and would push someone to
// 'fix' the export away from its own intent.
const ADJACENT = [
  ['surface-workspace', 'surface-panel'],
  ['surface-panel', 'surface-raised'],
  ['surface-panel', 'surface-overlay'],
  ['surface-panel', 'border-subtle'],
  ['surface-raised', 'border-subtle'],
  ['border-subtle', 'border-strong'],
];

// Washes, and the surfaces they land on.
const OVERLAYS = ['overlay-hover', 'overlay-active', 'overlay-strong'];
const BASES = ['surface-workspace', 'surface-panel', 'surface-raised'];

// Perceptual L separation below this reads as "the same colour".
const MIN_PLANE = 0.015;
const MIN_WASH = 0.010;

async function main() {
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 500, height: 400 });
  const assets = path.join(ROOT, 'dist/assets');
  const built = readFileSync(path.join(assets, readdirSync(assets).find(f => f.endsWith('.css'))), 'utf8');

  const host = path.join(ROOT, 'node_modules', '.hierarchy-host.html');
  writeFileSync(host, `<!doctype html><meta charset="utf-8"><style>${built}</style><div id="stage"></div>`);
  await win.loadFile(host);

  const data = await win.webContents.executeJavaScript(`
    (() => {
      const ADJACENT = ${JSON.stringify(ADJACENT)};
      const OVERLAYS = ${JSON.stringify(OVERLAYS)};
      const BASES = ${JSON.stringify(BASES)};
      const c = document.createElement('canvas'); c.width = c.height = 1;
      const ctx = c.getContext('2d', { willReadFrequently: true });

      // sRGB -> OKLab L
      const lum = (r, g, b) => {
        const f = v => { v /= 255; return v <= 0.04045 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
        const R = f(r), G = f(g), B = f(b);
        const l = Math.cbrt(0.4122214708*R + 0.5363325363*G + 0.0514459929*B);
        const m = Math.cbrt(0.2119034982*R + 0.6806995451*G + 0.1073969566*B);
        const s = Math.cbrt(0.0883024619*R + 0.2817188376*G + 0.6299787005*B);
        return 0.2104542553*l + 0.7936177850*m - 0.0040720468*s;
      };

      const out = { planes: {}, washes: {} };
      for (const mode of ['light','dark']) {
        // Toggled on <html> like the app, not a nested div: an
        // element carrying [data-theme] matches the export's dark
        // block directly, which beats a :root override reaching it by
        // inheritance, so a nested probe reads values the app never
        // renders.
        document.documentElement.classList.toggle('dark', mode === 'dark');
        const host = document.getElementById('stage');
        // Composite a class over an optional base and read the result.
        const paint = (cls, baseCls) => {
          const base = document.createElement('div');
          base.style.width = base.style.height = '10px';
          if (baseCls) base.className = baseCls;
          const top = document.createElement('div');
          top.className = cls;
          top.style.width = top.style.height = '10px';
          base.appendChild(top); host.appendChild(base);
          // Read the composited pixel by stacking colours manually:
          // fill base, then source-over the wash.
          const read = el => {
            const cs = getComputedStyle(el).backgroundColor;
            ctx.clearRect(0,0,1,1); ctx.fillStyle = '#000'; ctx.fillStyle = cs; ctx.fillRect(0,0,1,1);
            return ctx.getImageData(0,0,1,1).data;
          };
          const b = baseCls ? read(base) : null;
          ctx.clearRect(0,0,1,1);
          if (b) { ctx.fillStyle = 'rgb(' + b[0] + ',' + b[1] + ',' + b[2] + ')'; ctx.fillRect(0,0,1,1); }
          const t = getComputedStyle(top).backgroundColor;
          // Fully transparent means Tailwind never generated the
          // utility. The role is unused or renamed. That is a
          // different problem from a wash being too faint, and saying
          // 'invisible' would send someone to adjust a colour that is
          // not being applied at all.
          // Exact match, not a regex: this string lives inside a template
          // literal on its way to executeJavaScript, and a pattern like
          // /..\s*0\)$/ loses its backslashes to template escaping before
          // the browser ever sees it. Silently matching nothing.
          if (baseCls && (t === 'rgba(0, 0, 0, 0)' || t === 'transparent')) return null;
          ctx.fillStyle = t; ctx.fillRect(0,0,1,1);
          const d = ctx.getImageData(0,0,1,1).data;
          base.remove();
          return lum(d[0], d[1], d[2]);
        };

        for (const [a, b] of ADJACENT) {
          out.planes[mode + '|' + a + ' vs ' + b] = Math.abs(paint('bg-' + a) - paint('bg-' + b));
        }
        for (const base of BASES) for (const ov of OVERLAYS) {
          const plain = paint('bg-' + base);
          const washed = paint('bg-' + ov, 'bg-' + base);
          out.washes[mode + '|' + ov + ' on ' + base] = washed === null ? null : Math.abs(washed - plain);
        }
      }
      document.documentElement.classList.remove('dark');
      return out;
    })()
  `);

  const findings = [];
  // Border separation, measured the same way, as the fallback test.
  const borderSep = (mode, plane) => data.planes[mode + '|' + plane + ' vs border-subtle'];
  console.log('  ADJACENT PLANES  (OKLab L separation, min ' + MIN_PLANE + ')\n');
  for (const [k, v] of Object.entries(data.planes)) {
    const [mode, pair] = k.split('|');
    let ok = v >= MIN_PLANE;
    let note = ok ? 'ok' : 'TOO CLOSE';
    if (!ok) {
      // Fall back to the border between them.
      const a = pair.split(' vs ')[0];
      const b = pair.split(' vs ')[1];
      const edge = Math.max(borderSep(mode, a) ?? 0, borderSep(mode, b) ?? 0);
      if (edge >= MIN_PLANE) { ok = true; note = 'ok (border ' + edge.toFixed(3) + ')'; }
    }
    if (!ok) findings.push(`${mode}: ${pair} separated by only ${v.toFixed(4)}, and no border separates them either`);
    console.log('  ' + (mode + '  ' + pair).padEnd(52) + v.toFixed(4) + '   ' + note);
  }
  console.log('\n  INTERACTION WASHES  (min ' + MIN_WASH + ')\n');
  for (const [k, v] of Object.entries(data.washes)) {
    const [mode, pair] = k.split('|');
    if (v === null) {
      findings.push(`${mode}: ${pair}, no such utility; the role is unused, so Tailwind pruned it`);
      console.log('  ' + (mode + '  ' + pair).padEnd(52) + '     -   NOT GENERATED');
      continue;
    }
    const ok = v >= MIN_WASH;
    if (!ok) findings.push(`${mode}: ${pair} shifts only ${v.toFixed(4)}`);
    console.log('  ' + (mode + '  ' + pair).padEnd(52) + v.toFixed(4) + '   ' + (ok ? 'ok' : 'INVISIBLE'));
  }
  if (findings.length) {
    console.error('\n  ' + findings.length + ' finding(s):');
    for (const f of findings) console.error('    - ' + f);
    console.error('\n  Fix the derivation in tokens.css. Do not lower the threshold ');
    console.error('  a plane nobody can see is not a plane.');
    app.exit(1);
    return;
  }
  console.log('\n  Hierarchy holds in both modes.');
}

main().then(() => app.exit(0), e => { console.error(e); app.exit(1); });

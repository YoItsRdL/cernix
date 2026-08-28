/**
 * Compares two generated stylesheets by resolved declarations.
 *
 * Written for the Tailwind v3 to v4 migration (theme CNX-1804), where
 * "it builds" is not evidence that nothing changed. It caught a real
 * regression that a text diff would have buried: v4 changed the
 * arbitrary-value syntax for bare custom properties, so
 * origin-[--radix-...] silently emitted transform-origin without the
 * var() wrapper.
 *
 * Usage:  node scripts/css-parity.cjs <old.css> <new.css>
 *
 * A raw text diff is useless here: v4 reorders rules, renames internal
 * variables and indirects colours through --color-*. What matters is
 * whether a given utility class ends up applying the same computed
 * values. So both sheets are parsed into class -> declarations, every
 * var() is resolved against that sheet's own :root, and the resulting
 * maps are compared.
 */
const fs = require('fs');

const [, , v3Path, v4Path] = process.argv;

function parse(css) {
  const vars = {};
  for (const m of css.matchAll(/--([a-z0-9-]+(?:--[a-z-]+)?)\s*:\s*([^;}]+)/gi)) {
    if (!(m[1] in vars)) vars[m[1]] = m[2].trim();
  }
  const rules = new Map();
  // Minified output groups selectors (".absolute,.fixed{...}"), and the
  // two versions group differently. Split the list and record every
  // bare single-class selector, or the comparison invents differences
  // that are only formatting.
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selectors = m[1].split(',');
    const decls = m[2].trim();
    for (const raw of selectors) {
      const sel = raw.trim();
      // Bare `.class` only. No descendants, pseudos or compounds.
      const single = /^\.((?:[-\w]|\\.|\\[0-9a-f]+ ?)+)$/i.exec(sel);
      if (!single) continue;
      const cls = single[1].replace(/\\([0-9a-f]{1,6}) ?/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\/g, '');
      if (!rules.has(cls)) rules.set(cls, decls);
    }
  }
  return { vars, rules };
}

function resolve(value, vars, depth = 0) {
  if (depth > 12) return value;
  let out = value;
  let changed = false;
  out = out.replace(/var\(\s*--([a-z0-9-]+(?:--[a-z-]+)?)\s*(?:,\s*([^()]*))?\)/gi, (all, name, fallback) => {
    if (vars[name] !== undefined) { changed = true; return vars[name]; }
    if (fallback !== undefined) { changed = true; return fallback.trim(); }
    return all;
  });
  return changed ? resolve(out, vars, depth + 1) : out;
}

// v4 expresses spacing as calc(--spacing * N) where v3 emitted the
// product. Evaluate it so arithmetically identical rules do not read as
// differences. Otherwise the real signal drowns in ~250 false ones.
const evalCalc = s => s.replace(/calc\(\s*([\d.]+)rem\s*\*\s*(-?[\d.]+)\s*\)/gi, (_, unit, mult) => {
  const v = parseFloat(unit) * parseFloat(mult);
  return v === 0 ? '0' : `${parseFloat(v.toFixed(6))}rem`;
});

const norm = s => evalCalc(s)
  .replace(/\s+/g, ' ')
  .replace(/\s*([:;,])\s*/g, '$1')
  .replace(/;$/, '')
  .replace(/\b0\.(\d)/g, '.$1')   // 0.5rem and .5rem are the same value
  .replace(/;$/, '')
  .toLowerCase()
  .trim();

const a = parse(fs.readFileSync(v3Path, 'utf8'));
const b = parse(fs.readFileSync(v4Path, 'utf8'));

// Only compare classes the app actually uses. Both sheets are already
// content-pruned, so the intersection is the meaningful set.
const shared = [...a.rules.keys()].filter(k => b.rules.has(k));
const onlyV3 = [...a.rules.keys()].filter(k => !b.rules.has(k));
const onlyV4 = [...b.rules.keys()].filter(k => !a.rules.has(k));

const diffs = [];
for (const cls of shared) {
  const ra = norm(resolve(a.rules.get(cls), a.vars));
  const rb = norm(resolve(b.rules.get(cls), b.vars));
  if (ra !== rb) diffs.push({ cls, v3: ra, v4: rb });
}

console.log(`  v3 classes: ${a.rules.size}`);
console.log(`  v4 classes: ${b.rules.size}`);
console.log(`  shared:     ${shared.length}`);
console.log(`  identical:  ${shared.length - diffs.length}`);
console.log(`  differing:  ${diffs.length}`);
console.log('');

if (onlyV3.length) {
  console.log(`  --- ${onlyV3.length} class(es) present in v3 but NOT v4 (regressions if used) ---`);
  console.log('  ' + onlyV3.slice(0, 40).join(', '));
  console.log('');
}
if (onlyV4.length) {
  console.log(`  --- ${onlyV4.length} class(es) new in v4 ---`);
  console.log('  ' + onlyV4.slice(0, 25).join(', '));
  console.log('');
}
if (diffs.length) {
  console.log('  --- differing declarations ---');
  for (const d of diffs.slice(0, 60)) {
    console.log(`  .${d.cls}`);
    console.log(`      v3: ${d.v3.slice(0, 150)}`);
    console.log(`      v4: ${d.v4.slice(0, 150)}`);
  }
  if (diffs.length > 60) console.log(`  ... and ${diffs.length - 60} more`);
}

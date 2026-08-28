import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// Roots scanned for design-system compliance. Both surfaces. The
// Electron renderer AND the public landing page. Share the same
// token system (src/shared/tokens.css), so they share the same lint.
// Adding a new public-facing surface? Add it here.
const SCAN_ROOTS = [
  { dir: path.resolve(REPO_ROOT, 'src/renderer'), exts: ['.tsx', '.ts', '.css'] },
  { dir: path.resolve(REPO_ROOT, 'landing/src'),  exts: ['.html', '.css', '.js'] },
  // landing/*.html is build output now, assembled by scripts/landing-html.mjs
  // from landing/src/pages and landing/src/partials, both of which the root
  // above already covers. Scanning the generated copies as well reported
  // every divergence twice and pointed the fix at a file that gets
  // overwritten on the next build.
];

// Regexes to catch design system divergence
const REGEXES = {
  arbitraryColors: /\b(bg|text|border|ring)-\[#[0-9a-fA-F]+\]/g,
  arbitrarySpacing: /\b(w|h|gap|p[xytblr]?|m[xytblr]?)-\[[0-9]+(px|rem|em|%)?\]/g,
  arbitraryTextSize: /\btext-\[[0-9]+(px|rem|em|%)?\]/g,
  arbitraryRadius: /\brounded-\[[0-9]+(px|rem|em|%)?\]/g,
  inlineHex: /#[0-9a-fA-F]{3,8}\b/g,
  // Literal numeric colour functions: `oklch(0.65 0.2 45)`, `rgb(64, 64, 64)`,
  // `hsl(212, 100%, 50%)`, and friends.
  //
  // oklch/oklab/lch/lab/hwb/color are listed because the palette moved to
  // OKLCH. Before that they were absent, so an `oklch()` literal in a
  // component passed this audit silently, which is precisely the hole a
  // colour leaks back through.
  //
  // A `var()` first argument is skipped: composing a token in custom CSS
  // is the sanctioned form, not a violation. The value still has to come
  // from a token.
  inlineColorFunc: /\b(rgb|rgba|hsl|hsla|oklch|oklab|lch|lab|hwb|color)\(\s*(?!var\b|from\b|in\b)[0-9.]/g,
  // Palette colour utilities (bg-red-500 etc). Bypass role system.
  paletteUtility: /\b(bg|text|border|ring|from|to|via|shadow|outline|fill|stroke|placeholder|divide|accent|decoration|caret)-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-[0-9]+(\/[0-9]+)?/g,
  // Raw white/black alpha combos. Use overlay-* or a surface token.
  rawGreyscale: /\b(bg|text|border|ring|from|to|via|shadow|outline|fill|stroke|divide)-(white|black)(\/[0-9]+)?\b/g,
  // `bg-surface-overlay` with no alpha. The token is opaque black, so a
  // bare use is a solid black fill, which is how the Settings backdrop
  // shipped pitch black and six editor chips put dark text on black.
  //
  // Flagged rather than fixed by making the token translucent, because
  // the crop mask genuinely wants raw black at an explicit alpha. The
  // alpha is the whole contract, so its absence is the bug. Use
  // bg-scrim for a modal backdrop or bg-surface-floating for a chip.
  opaqueScrim: /\bbg-surface-overlay(?!\/[0-9])/g,
};

function walkDir(dir, callback, { shallow = false } = {}) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach(f => {
    const dirPath = path.join(dir, f);
    const isDirectory = fs.statSync(dirPath).isDirectory();
    if (isDirectory) {
      if (!shallow) walkDir(dirPath, callback);
    } else {
      callback(dirPath);
    }
  });
}

const report = {};

for (const root of SCAN_ROOTS) {
  walkDir(root.dir, (filePath) => {
    if (!root.exts.some(ext => filePath.endsWith(ext))) return;

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      // Skip explicit design-allow lines
      if (line.includes('design-allow')) return;

      for (const [ruleName, regex] of Object.entries(REGEXES)) {
        const matches = line.match(regex);
        if (matches) {
          if (!report[filePath]) report[filePath] = [];
          report[filePath].push({
            line: index + 1,
            rule: ruleName,
            matches: [...new Set(matches)],
            context: line.trim().substring(0, 80)
          });
        }
      }
    });
  }, { shallow: root.shallow });
}

let totalIssues = 0;

console.log('=== Cernix Design Audit Report ===\n');

for (const [file, issues] of Object.entries(report)) {
  const relativePath = path.relative(REPO_ROOT, file);
  console.log(`\n📄 ${relativePath}`);
  issues.forEach(issue => {
    totalIssues++;
    console.log(`  Line ${issue.line}: [${issue.rule}] found ${issue.matches.join(', ')}`);
    console.log(`    > ${issue.context}`);
  });
}

console.log(`\nTotal divergent usages found: ${totalIssues}`);
console.log('Note: This is a remediation list. Replace these with semantic roles from src/shared/tokens.css.');

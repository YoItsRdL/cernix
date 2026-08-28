/**
 * Every shortcut on the reference sheet must be bound somewhere.
 *
 * The sheet is documentation, and documentation rots quietly. The list
 * this replaced claimed the editor set star ratings on 0–9; it never
 * did, and nothing caught it because nothing was looking. This looks.
 *
 * It is deliberately crude. It asks whether a handler anywhere in the
 * renderer mentions the key, not whether it does the right thing with
 * it. That is enough to catch the failure that actually happens: a
 * binding removed or renamed while the sheet keeps promising it.
 *
 * Exit code is the number of unbacked entries.
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const RENDERER = path.join(ROOT, 'src', 'renderer')

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(e.name) && !full.includes('shortcuts.ts')) out.push(full)
  }
  return out
}

const source = walk(RENDERER).map(f => fs.readFileSync(f, 'utf8')).join('\n')

/**
 * A pattern that proves the key is compared against, not merely
 * present.
 *
 * The first version of this asked whether the source contained `'g'`
 * anywhere, and happily confirmed a shortcut invented to test it.
 * Single letters appear in a hundred harmless strings. Every needle
 * here is anchored to a `.key` comparison or a `case`, so what it finds
 * is a keyboard handler and nothing else.
 *
 * `null` means the entry is not a key press (a click, a modifier that
 * only ever appears alongside a real key).
 */
function evidenceFor(key) {
  const named = {
    '←': 'ArrowLeft', '→': 'ArrowRight', '↑': 'ArrowUp', '↓': 'ArrowDown',
    'arrows': 'ArrowLeft',
    'Esc': 'Escape', 'Enter': 'Enter', 'Home': 'Home', 'End': 'End',
    'Page Up': 'PageUp', 'Page Down': 'PageDown',
  }
  // Both senses of the comparison. The undo handler is written as an
  // early return (`e.key !== 'z' && e.key !== 'Z'`) and matching only
  // `===` reported the app's most-used shortcut as unbound.
  const compare = literal =>
    new RegExp(`(?:\\.key\\s*(?:===|!==)\\s*|case\\s*)${literal}`)

  if (key in named) return [compare(`'${named[key]}'`)]
  if (key === 'Space') return [compare(`' '`)]
  if (key === '?') return [compare(`'\\?'`)]
  if (key === '\\') return [compare(`'\\\\\\\\'`)]

  // Modifiers are only ever half of a chord; the other half carries the
  // proof. Checking the flag alone would pass on any handler anywhere.
  if (key === 'mod' || key === 'alt' || key === 'shift') return null
  if (key === 'Click') return null

  if (/^[A-Za-z]$/.test(key)) {
    return [compare(`'${key.toLowerCase()}'`), compare(`'${key.toUpperCase()}'`)]
  }
  // A range like "0 – 5" is implemented as a character class test, and
  // the class has to be the range the sheet advertises. Claiming 0–9
  // must not be satisfied by a handler that only accepts 0–5.
  const range = key.match(/^(\d)\s*[–-]\s*(\d)$/)
  if (range) {
    return [new RegExp(`\\[${range[1]}-${range[2]}\\][^\\n]*\\.test\\(\\s*e\\.key`)]
  }
  if (/^\d$/.test(key)) return [compare(`'${key}'`)]
  return null
}

// The sheet is TypeScript; read the literals out rather than importing,
// so this stays a plain Node script with no build step.
const sheet = fs.readFileSync(path.join(RENDERER, 'lib', 'shortcuts.ts'), 'utf8')
const entries = [...sheet.matchAll(/\{\s*keys:\s*'((?:[^'\\]|\\.)*)',\s*what:\s*'((?:[^'\\]|\\.)*)'\s*\}/g)]
  .map(m => ({ keys: m[1], what: m[2] }))

if (entries.length === 0) {
  console.error('  Read no entries from lib/shortcuts.ts: the shape changed. Fix this rather than skipping it.')
  process.exit(2)
}

let unbacked = 0
for (const entry of entries) {
  const parts = entry.keys.split(/\s*\+\s*/).map(p => p.trim())
  const missing = []
  for (const part of parts) {
    const patterns = evidenceFor(part)
    if (patterns === null) continue
    if (!patterns.some(re => re.test(source))) missing.push(part)
  }
  if (missing.length) {
    unbacked++
    console.log(`  UNBACKED  ${entry.keys.padEnd(16)} ${entry.what}`)
    console.log(`            no handler mentions: ${missing.join(', ')}`)
  }
}

console.log('')
console.log(unbacked
  ? `  ${entries.length} shortcuts listed, ${unbacked} with no handler behind them.`
  : `  All ${entries.length} listed shortcuts are bound somewhere.`)
process.exit(unbacked ? 1 : 0)

#!/usr/bin/env node
/**
 * Assembles landing/*.html from templates in landing/src/pages and shared
 * partials in landing/src/partials.
 *
 * Why this exists: the three pages shared roughly 90 lines of chrome each
 * and had already drifted apart. The legal pages inlined a brand mark the
 * landing page drew from its sprite, carried a footer tagline the landing
 * page had replaced, and appended a version number to the copyright that
 * nothing kept up to date. Three copies of one idea is how that happens.
 *
 * The output is plain static HTML with no runtime cost: the shared chrome
 * is stamped in at build time, so nothing arrives after first paint and
 * the pages stay JS-free apart from the theme scripts they already had.
 *
 * Syntax, deliberately tiny:
 *   {{> name }}   include landing/src/partials/name.html
 *   {{ key }}     substitute from the page's front matter
 *
 * Front matter is a JSON object in an HTML comment at the top of a page
 * template. Includes are expanded before substitution, so a partial can
 * use the page's variables.
 */
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PAGES = path.join(ROOT, 'landing/src/pages')
const PARTIALS = path.join(ROOT, 'landing/src/partials')
const OUT = path.join(ROOT, 'landing')

const partials = new Map()
for (const f of fs.readdirSync(PARTIALS)) {
  if (f.endsWith('.html')) partials.set(f.replace(/\.html$/, ''), read(path.join(PARTIALS, f)))
}

/** Read a file and normalise to LF; line endings are decided on write. */
function read(p) {
  return fs.readFileSync(p, 'utf8').split('\r\n').join('\n')
}

/** Pull the leading `<!-- {...} -->` front matter off a page template. */
function frontMatter(src, name) {
  const m = src.match(/^<!--\s*(\{[\s\S]*?\})\s*-->\n?/)
  if (!m) throw new Error(`${name}: no front matter`)
  let data
  try {
    data = JSON.parse(m[1])
  } catch (e) {
    throw new Error(`${name}: front matter is not valid JSON: ${e.message}`)
  }
  return { data, body: src.slice(m[0].length) }
}

/**
 * Expand includes. An include keeps the indentation of the line it sits
 * on, so the assembled file reads like it was written by hand rather
 * than pasted.
 */
function expand(src, name, depth = 0) {
  if (depth > 5) throw new Error(`${name}: include nested more than 5 deep`)
  return src.replace(/^([ \t]*)\{\{>\s*([\w-]+)\s*\}\}[ \t]*$/gm, (_, indent, key) => {
    const part = partials.get(key)
    if (part === undefined) throw new Error(`${name}: no partial named "${key}"`)
    const inner = expand(part, key, depth + 1).replace(/\n+$/, '')
    return inner.split('\n').map(l => (l ? indent + l : l)).join('\n')
  })
}

/** Substitute {{ key }}. An unknown key is a build error, never a blank. */
function substitute(src, data, name) {
  const seen = new Set()
  const out = src.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, key) => {
    if (!(key in data)) throw new Error(`${name}: no value for {{ ${key} }}`)
    seen.add(key)
    return data[key]
  })
  for (const key of Object.keys(data)) {
    if (key !== 'out' && key !== 'assetv' && !seen.has(key)) {
      process.stderr.write(`  warning: ${name} defines "${key}" but never uses it\n`)
    }
  }
  return out
}

/**
 * A content hash of the built stylesheet, stamped into its URL as
 * `{{ assetv }}`.
 *
 * `/dist/*` is served `immutable` for a year, which is correct only if
 * the URL changes when the bytes do. It did not: the path is a fixed
 * `dist/style.css`, so every returning visitor was pinned to whatever
 * stylesheet they first downloaded and `immutable` stopped the browser
 * even asking. Any CSS change was invisible to them, which is how a
 * dialog shipped with its rules missing and rendered in page flow.
 *
 * Eight hex characters is plenty to notice a change; this is a cache
 * key, not a checksum anyone verifies.
 *
 * Requires the stylesheet to exist, so `landing:build` compiles CSS
 * before HTML. Tailwind scans `src/**` as well as the built pages, so
 * nothing is lost by generating the HTML second.
 */
const cssPath = path.join(ROOT, 'landing/dist/style.css')
if (!fs.existsSync(cssPath)) {
  throw new Error('landing/dist/style.css is missing: build the CSS before the HTML')
}
const assetv = crypto.createHash('sha256')
  .update(fs.readFileSync(cssPath)).digest('hex').slice(0, 8)
console.log(`  stylesheet ${assetv}`)

let built = 0
for (const file of fs.readdirSync(PAGES).sort()) {
  if (!file.endsWith('.html')) continue
  const src = read(path.join(PAGES, file))
  const { data, body } = frontMatter(src, file)
  data.assetv = assetv
  const target = path.join(OUT, data.out || file)

  // Match whatever the file being replaced already used, so a page that
  // was CRLF stays CRLF and the diff shows content rather than endings.
  let eol = '\n'
  if (fs.existsSync(target)) {
    eol = fs.readFileSync(target, 'utf8').includes('\r\n') ? '\r\n' : '\n'
  }

  const html = substitute(expand(body, file), data, file)
  if (/\{\{/.test(html)) {
    const stray = html.match(/\{\{[^}]*\}\}/)
    throw new Error(`${file}: unresolved ${stray[0]} in the output`)
  }
  fs.writeFileSync(target, html.split('\n').join(eol), 'utf8')
  console.log(`  ${path.relative(ROOT, target).replace(/\\/g, '/')}  ${html.split('\n').length} lines`)
  built++
}
console.log(`${built} page${built === 1 ? '' : 's'} from ${partials.size} partials`)

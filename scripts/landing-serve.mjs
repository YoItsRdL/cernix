#!/usr/bin/env node
/**
 * Serves `landing/` the way Vercel does, so the page can be checked
 * locally before it is deployed.
 *
 * Why this exists rather than `python3 -m http.server`: two things the
 * built page depends on are behaviours of the host, not of the files.
 *
 * 1. **Pretty URLs.** The download CTAs link to `/download`, with no
 *    extension, because `cleanUrls` in vercel.json resolves that to
 *    `installation.html`. A
 *    plain static server returns 404 and the page looks broken when it
 *    is not.
 * 2. **`fetch` needs an origin.** Opening `landing/index.html` over
 *    `file://` gives the document an opaque origin, so the CTA script's
 *    `fetch('binary.json')` is refused and every button silently keeps
 *    its fallback href. The one thing worth testing does not run.
 *
 * Cache headers mirror vercel.json, so a stale `binary.json` cannot
 * fool a local check either.
 *
 * This serves what is already built. Run `npm run landing:build` first,
 * or `npm run landing:dev` alongside it to rebuild the stylesheet on
 * change; neither watches the HTML templates, so re-run `landing:html`
 * after editing a page.
 *
 * Usage:  npm run landing:serve [-- --port 4173]
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'landing')

const args = process.argv.slice(2)
const portArg = args.indexOf('--port')
const PORT = Number(portArg !== -1 && args[portArg + 1] ? args[portArg + 1] : 4173)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
}

/** vercel.json: hashed assets are immutable, everything else revalidates. */
function cacheControl(urlPath) {
  return urlPath.startsWith('/dist/')
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=0, must-revalidate'
}

/**
 * Resolve a request path to a file, the way Vercel's cleanUrls does:
 * `/download` before `/download.html`, and a directory before its
 * `index.html`.
 *
 * Returns null for anything that escapes ROOT. The check is on the
 * resolved path rather than the raw one, so `..` and an encoded `..`
 * are both caught after normalisation rather than by pattern.
 */
function resolveFile(urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0].split('#')[0])
  if (rel.endsWith('/')) rel += 'index.html'
  const base = path.resolve(ROOT, '.' + rel)
  if (base !== ROOT && !base.startsWith(ROOT + path.sep)) return null

  const candidates = path.extname(base)
    ? [base]
    : [base + '.html', path.join(base, 'index.html'), base]

  for (const file of candidates) {
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file
  }
  return null
}

const server = http.createServer((req, res) => {
  const file = resolveFile(req.url === '/' ? '/index.html' : req.url)

  if (!file) {
    // Vercel serves 404.html when a site has one. This one does not,
    // so say so plainly rather than inventing a page the deploy has no
    // equivalent of.
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(`404  ${req.url}\n\nNothing built at that path. Run: npm run landing:build\n`)
    console.log(`  404  ${req.url}`)
    return
  }

  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    'Cache-Control': cacheControl(req.url),
  })
  fs.createReadStream(file).pipe(res)
})

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error('No landing/index.html. Run `npm run landing:build` first.')
  process.exit(1)
}

server.listen(PORT, () => {
  console.log(`\n  landing/ on http://localhost:${PORT}`)
  console.log('  cleanUrls and vercel.json cache headers, as deployed')
  console.log('\n  /            the landing page')
  console.log('  /download    every platform, and the CTAs\' fallback')
  console.log('  /privacy     /terms')
  console.log('\n  Ctrl+C to stop.\n')
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is busy. Try: npm run landing:serve -- --port ${PORT + 1}`)
    process.exit(1)
  }
  throw err
})

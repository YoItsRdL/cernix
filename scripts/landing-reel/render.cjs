// Renders the landing film from film.html, frame by frame.
//
//   node scripts/landing-reel/render.cjs still 0 4.5 10.4 16 [--blur]
//   node scripts/landing-reel/render.cjs video           (REEL_POSTER=<s> picks the poster frame)
//   node scripts/landing-reel/render.cjs encode          (again from the master)
//   REEL_VERSION=2 node scripts/landing-reel/render.cjs publish
// Add REEL_THEME=dark to any of these for the dark cut.
//
// The page is served from 127.0.0.1 beside $REEL_WORK (the raw take and the
// fonts) and drawn with window.renderAt(t) in the installed
// Google Chrome, sandboxed (channel "chrome", chromiumSandbox: true), via
// playwright-core kept outside the repo in $REEL_TOOLS. It downloads no
// browser of its own.
//
// 60 fps, 1920×1080. Motion blur: every frame averages four moments across
// a 180° shutter in linear light, so fast moves smear the way a camera's
// would and still ones stay sharp.
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { execFileSync, spawn } = require('child_process')

const WORK = process.env.REEL_WORK || path.join(os.homedir(), 'CernixQA', 'reel-work')
const TOOLS = process.env.REEL_TOOLS || path.join(os.homedir(), 'CernixQA', 'reel-tools')
const { chromium } = require(path.join(TOOLS, 'node_modules', 'playwright-core'))
const sharp = require(path.join(TOOLS, 'node_modules', 'sharp'))

const REPO = path.resolve(__dirname, '..', '..')
const FPS = 60
const PAGE = 'film.html'
// REEL_THEME=dark renders the dark cut, from the dark take.
const THEME = process.env.REEL_THEME === 'dark' ? 'dark' : 'light'
const NAME = THEME === 'dark' ? 'cernix-film-dark' : 'cernix-film'
let DURATION = 32
const SIZE = { width: 1920, height: 1080 }
const SUB = 4
const PAGES = Number(process.env.REEL_PAGES || 3)
const OUT = path.join(WORK, 'render')
const PUBLISH = path.join(REPO, 'landing', 'reel')

const TYPES = { '.html': 'text/html', '.json': 'application/json', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.png': 'image/png' }

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0])
    const page = url === `/${PAGE}`
    const file = page ? path.join(__dirname, PAGE) : path.join(WORK, path.normalize(url).replace(/^([/\\])+/, ''))
    if (!page && !file.startsWith(WORK)) { res.writeHead(403); return res.end() }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end() }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' })
      res.end(data)
    })
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)))
}

async function openPages(browser, port, n) {
  const pages = []
  for (let i = 0; i < n; i++) {
    const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1 })
    const page = await context.newPage()
    page.on('pageerror', (e) => console.error('page error:', e.message))
    await page.goto(`http://127.0.0.1:${port}/${PAGE}?theme=${THEME}`)
    await page.evaluate(() => window.ready)
    DURATION = await page.evaluate(() => window.DURATION || 32)
    const cdp = await context.newCDPSession(page)
    pages.push({ page, cdp })
  }
  return pages
}

async function shot({ page, cdp }, t) {
  await page.evaluate((x) => window.renderAt(x), t)
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true })
  return sharp(Buffer.from(data, 'base64')).removeAlpha().raw().toBuffer()
}

// sRGB ↔ linear, as lookup tables.
const TO_LIN = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) })
function toSrgb(l) { const c = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055; return Math.round(Math.min(1, Math.max(0, c)) * 255) }
const FROM_LIN = new Uint8Array(4096).map((_, i) => toSrgb(i / 4095))

async function frame(p, t, blur) {
  if (!blur) return shot(p, t)
  const acc = new Float32Array(SIZE.width * SIZE.height * 3)
  for (let j = 0; j < SUB; j++) {
    const dt = ((j + 0.5) / SUB - 0.5) * (0.5 / FPS)
    const buf = await shot(p, t + dt)
    for (let i = 0; i < acc.length; i++) acc[i] += TO_LIN[buf[i]]
  }
  const out = Buffer.alloc(acc.length)
  for (let i = 0; i < acc.length; i++) out[i] = FROM_LIN[Math.round((acc[i] / SUB) * 4095)]
  return out
}

async function withBrowser(fn) {
  const server = await serve()
  const browser = await chromium.launch({ channel: 'chrome', chromiumSandbox: true, headless: true })
  try {
    return await fn(browser, server.address().port)
  } finally {
    await browser.close()
    server.close()
  }
}

const COMMANDS = {
  async still(args) {
    const blur = args.includes('--blur')
    const times = args.filter((a) => !a.startsWith('--')).map(Number)
    const dir = path.join(OUT, 'stills', NAME)
    fs.mkdirSync(dir, { recursive: true })
    await withBrowser(async (browser, port) => {
      const [p] = await openPages(browser, port, 1)
      for (const t of times) {
        const raw = await frame(p, t, blur)
        const file = path.join(dir, `t${t.toFixed(2).padStart(6, '0')}.jpg`)
        await sharp(raw, { raw: { ...SIZE, channels: 3 } }).jpeg({ quality: 90 }).toFile(file)
        console.log(file)
      }
    })
  },

  // Frames go straight into one high-quality master encode, in order, and
  // nothing per frame is written to disk: 2,000 PNGs at 1080p are 7 GB.
  async video() {
    fs.mkdirSync(OUT, { recursive: true })
    const master = path.join(OUT, `${NAME}-master.mp4`)
    const started = Date.now()
    await withBrowser(async (browser, port) => {
      const pages = await openPages(browser, port, PAGES)
      const total = Math.round(DURATION * FPS)
      console.log(`${PAGE}: ${total} frames`)
      const ff = spawn('ffmpeg', ['-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${SIZE.width}x${SIZE.height}`, '-r', String(FPS), '-i', '-',
        ...COLOUR, '-c:v', 'libx264', '-preset', 'medium', '-crf', '10', '-an', master], { stdio: ['pipe', 'ignore', 'inherit'] })
      const closed = new Promise((ok, fail) => ff.on('close', (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg exited ${code}`)))))
      const ready = new Map()
      let written = 0
      const flush = async () => {
        while (ready.has(written)) {
          const buf = ready.get(written)
          ready.delete(written)
          written++
          if (!ff.stdin.write(buf)) await new Promise((ok) => ff.stdin.once('drain', ok))
          if (written % 60 === 0) console.log(`${written}/${total} frames, ${((Date.now() - started) / 1000).toFixed(0)} s`)
        }
      }
      let next = 0
      let writing = Promise.resolve()
      await Promise.all(pages.map(async (p) => {
        while (next < total) {
          const n = next++
          // Rendering runs ahead of writing by a few frames at most.
          while (n - written > PAGES * 3) await new Promise((ok) => setTimeout(ok, 20))
          ready.set(n, await frame(p, n / FPS, true))
          writing = writing.then(flush)
        }
      }))
      await writing
      ff.stdin.end()
      await closed
    })
    encode(master)
  },

  // The delivery files again from the master, without rendering.
  async encode() { encode(path.join(OUT, `${NAME}-master.mp4`)) },

  // Into landing/reel under a versioned name: the files are served as
  // immutable, so a new cut needs a new name (and the page its new src).
  async publish() {
    const v = process.env.REEL_VERSION
    if (!/^\d+$/.test(v || '')) throw new Error('set REEL_VERSION to the number of the new cut')
    fs.mkdirSync(PUBLISH, { recursive: true })
    for (const [from, to] of [['.webm', '.webm'], ['.mp4', '.mp4'], ['-poster.webp', '-poster.webp']]) {
      const src = path.join(OUT, `${NAME}${from}`), dst = path.join(PUBLISH, `${NAME}-v${v}${to}`)
      fs.copyFileSync(src, dst)
      console.log(dst, fs.statSync(dst).size)
    }
  },
}

/** Full-range RGB in, limited-range BT.709 out, tagged so. */
const COLOUR = ['-vf', 'scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709']
const TAGS = ['-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709']

/**
 * The delivery encodes from the master: H.264, AV1, and the poster. A
 * keyframe every two seconds, so the page can seek into either cut quickly when
 * the theme changes.
 */
function encode(master) {
  const mp4 = path.join(OUT, `${NAME}.mp4`)
  const webm = path.join(OUT, `${NAME}.webm`)
  execFileSync('ffmpeg', ['-y', '-i', master, '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-g', String(FPS * 2), '-profile:v', 'high', '-pix_fmt', 'yuv420p', ...TAGS, '-movflags', '+faststart', '-an', mp4], { stdio: 'inherit' })
  execFileSync('ffmpeg', ['-y', '-i', master, '-c:v', 'libsvtav1', '-preset', '5', '-crf', '30', '-g', String(FPS * 2), '-pix_fmt', 'yuv420p', ...TAGS, '-an', webm], { stdio: 'inherit' })
  // The poster is a held moment of the app, not frame 0 (the brand card).
  const at = Number(process.env.REEL_POSTER || 31.0)
  execFileSync('ffmpeg', ['-y', '-ss', String(at), '-i', master, '-frames:v', '1', '-quality', '86', path.join(OUT, `${NAME}-poster.webp`)], { stdio: 'inherit' })
  for (const f of [mp4, webm]) console.log(f, (fs.statSync(f).size / 1e6).toFixed(1), 'MB')
}

const [cmd, ...args] = process.argv.slice(2)
if (!COMMANDS[cmd]) { console.error('usage: render.cjs still <t…> [--blur] | video | encode | publish'); process.exit(1) }
COMMANDS[cmd](args).catch((e) => { console.error(e); process.exit(1) })

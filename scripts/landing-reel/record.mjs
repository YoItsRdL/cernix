// Records Cernix for the landing film, as a screencast of the running dev app.
//
//   REEL_SCALE=2.5 node scripts/landing-reel/record.mjs film
//   REEL_SCALE=2.5 REEL_THEME=dark node scripts/landing-reel/record.mjs film
//
// One unbroken take: the card goes in, two frames are rated in the viewer,
// the batch is sent, then on to the Workstation's day folder on Drive, a
// photograph opened in the editor, a preset and two sliders.
//
// Drives the dev app started by tickets/qa-release/tools/qa-dev.mjs over its
// devtools port (49333), on its own QA profile, never the copy in daily use.
// The "card" is $REEL_WORK/card, inserted by writing the QA volumes file.
// The take uploads to the Drive account connected in that profile.
//
// The page is held at 1280×800 CSS px at REEL_SCALE (2.5× gives 3200×2000 frames), whatever
// the window's size. No cursor is drawn here: every pointer position is
// logged with its time, and the reel draws the pointer itself at its own
// frame rate, so it moves smoothly however unevenly the screencast arrives.
//
// Writes $REEL_WORK/raw/<take>/: f00000.jpg…, frames.json (time and file of
// every frame), pointer.json and marks.json, all on one clock (seconds from
// the take's start).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const WORK = process.env.REEL_WORK || path.join(os.homedir(), 'CernixQA', 'reel-work')
const QA_HOME = process.env.CERNIX_QA_HOME || path.join(os.homedir(), 'CernixQA')
const VOLUMES = path.join(QA_HOME, 'volumes.json')
const CARD = path.join(WORK, 'card')
const PORT = Number(process.env.CERNIX_REMOTE_DEBUG || 49333)
// 2.5× for the film take, so the camera can move in close and stay sharp.
const VIEW = { width: 1280, height: 800, scale: Number(process.env.REEL_SCALE || 1.5) }
// The app's theme for the take; the landing plays the one matching its own.
const THEME = process.env.REEL_THEME === 'dark' ? 'dark' : 'light'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const now = () => Date.now() / 1000

/** The Cernix dev window on PORT. Anything else answering there is refused. */
async function connect() {
  const base = `http://127.0.0.1:${PORT}`
  const version = await fetch(`${base}/json/version`).then((r) => r.json()).catch(() => null)
  if (!version) throw new Error(`nothing on port ${PORT}: start the app with tickets/qa-release/tools/qa-dev.mjs`)
  if (!/Electron/i.test(version['User-Agent'] || '')) throw new Error(`port ${PORT} is not Electron; refusing to drive it`)
  const targets = await fetch(`${base}/json/list`).then((r) => r.json())
  const page = targets.find((t) => t.type === 'page' && /^http:\/\/localhost:\d+\//.test(t.url))
  if (!page) throw new Error(`no Cernix dev window on port ${PORT}`)

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail })
  let id = 0
  const pending = new Map()
  const listeners = new Map()
  ws.onmessage = (m) => {
    const r = JSON.parse(m.data)
    if (r.id) pending.get(r.id)?.(r)
    else listeners.get(r.method)?.(r.params)
  }
  const send = (method, params = {}) => new Promise((ok) => {
    const k = ++id
    pending.set(k, ok)
    ws.send(JSON.stringify({ id: k, method, params }))
  })
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'evaluate failed')
    return r.result?.result?.value
  }
  return { ws, send, ev, on: (method, fn) => listeners.set(method, fn) }
}

/** Waits until the page's text matches, or throws. */
async function waitText(c, re, ms = 30000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (re.test(await c.ev('document.body.innerText'))) return
    await sleep(250)
  }
  throw new Error(`timed out waiting for ${re}`)
}

/** Centre of the first visible element matching a selector and text. */
async function centreOf(c, selector, text) {
  const r = await c.ev(`(() => {
    const re = ${text ? `new RegExp(${JSON.stringify(text)})` : 'null'}
    const e = [...document.querySelectorAll(${JSON.stringify(selector)})].find((n) => n.offsetParent && (!re || re.test(n.getAttribute('aria-label') || '') || re.test(n.textContent || '')))
    if (!e) return null
    const b = e.getBoundingClientRect()
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height, left: b.left, top: b.top }
  })()`)
  if (!r) throw new Error(`nothing matches ${selector} ${text || ''}`)
  return r
}

const smootherstep = (t) => t * t * t * (t * (t * 6 - 15) + 10)

/** A take: screencast frames, pointer path and marks on one clock. */
async function startTake(c, name) {
  const frames = []
  const pointer = []
  const marks = []
  let at = { x: VIEW.width * 0.5, y: VIEW.height * 0.62 }
  let t0 = null
  c.on('Page.screencastFrame', async (f) => {
    frames.push({ data: f.data, t: f.metadata.timestamp })
    try { await c.send('Page.screencastFrameAck', { sessionId: f.sessionId }) } catch { /* the take ended */ }
  })
  await c.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: VIEW.width * VIEW.scale, maxHeight: VIEW.height * VIEW.scale, everyNthFrame: 1 })
  t0 = now()
  const log = (down = false) => pointer.push({ t: Number((now() - t0).toFixed(4)), x: Math.round(at.x * 10) / 10, y: Math.round(at.y * 10) / 10, down })
  log()

  const take = {
    mark(label) {
      const t = now() - t0
      marks.push({ label, t: Number(t.toFixed(4)) })
      console.log(`  [${t.toFixed(2)}] ${label}`)
    },
    /** Moves the pointer along a smootherstep curve, firing real mouse events. */
    async glide(x, y, ms = 700) {
      const from = { ...at }
      const steps = Math.max(2, Math.round(ms / 16))
      for (let i = 1; i <= steps; i++) {
        const k = smootherstep(i / steps)
        at = { x: from.x + (x - from.x) * k, y: from.y + (y - from.y) * k }
        await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y, buttons: 0 })
        log()
        await sleep(ms / steps)
      }
    },
    async click(clickCount = 1) {
      for (let n = 1; n <= clickCount; n++) {
        await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: n })
        log(true)
        await sleep(70)
        await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: n })
        log(false)
        if (n < clickCount) await sleep(90)
      }
    },
    /** Press, glide with the button held, release. */
    async drag(x, y, ms = 1100) {
      await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1 })
      log(true)
      const from = { ...at }
      const steps = Math.max(2, Math.round(ms / 16))
      for (let i = 1; i <= steps; i++) {
        const k = smootherstep(i / steps)
        at = { x: from.x + (x - from.x) * k, y: from.y + (y - from.y) * k }
        await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y, button: 'left', buttons: 1 })
        log(true)
        await sleep(ms / steps)
      }
      await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: 1 })
      log(false)
    },
    async key(key) {
      await c.ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))`)
    },
    async stop() {
      await c.send('Page.stopScreencast')
      await sleep(300)
      const dir = path.join(WORK, 'raw', name)
      fs.rmSync(dir, { recursive: true, force: true })
      fs.mkdirSync(dir, { recursive: true })
      const index = frames.map((f, i) => {
        const file = `f${String(i).padStart(5, '0')}.jpg`
        fs.writeFileSync(path.join(dir, file), Buffer.from(f.data, 'base64'))
        return [Number((f.t - t0).toFixed(4)), file]
      })
      const size = [VIEW.width * VIEW.scale, VIEW.height * VIEW.scale]
      fs.writeFileSync(path.join(dir, 'frames.json'), JSON.stringify({ size, view: VIEW, frames: index }))
      fs.writeFileSync(path.join(dir, 'pointer.json'), JSON.stringify(pointer))
      fs.writeFileSync(path.join(dir, 'marks.json'), JSON.stringify(marks, null, 1))
      console.log(`${name}: ${frames.length} frames, ${(index.at(-1)?.[0] ?? 0).toFixed(1)} s`)
    },
  }
  return take
}

/** The app in the state every take starts from: THEME, Local Archive, no card. */
async function reset(c) {
  await c.send('Emulation.setDeviceMetricsOverride', { width: VIEW.width, height: VIEW.height, deviceScaleFactor: VIEW.scale, mobile: false })
  await c.ev(`window.electronAPI.themeSet(${JSON.stringify(THEME)})`)
  await c.ev(`(document.querySelector('[role=dialog]') && window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true)`)
  await c.ev(`([...document.querySelectorAll('button')].find((b) => /^Local Archive/.test(b.getAttribute('aria-label') || ''))?.click(), true)`)
  await sleep(800)
  await c.ev(`([...document.querySelectorAll('button')].find((b) => b.offsetParent && /^(Finish|Discard)/.test(b.textContent.trim()))?.click(), true)`)
  fs.writeFileSync(VOLUMES, '[]')
  await sleep(2500)
}

const TAKES = {
  // The whole film in one unbroken take: card in, rated, sent, then on to
  // the Workstation and into the editor. Run with REEL_SCALE=2.5.
  async film(c) {
    await reset(c)
    await waitText(c, /Ready to import/)
    const take = await startTake(c, THEME === 'dark' ? 'film-dark' : 'film')
    await take.glide(VIEW.width * 0.55, VIEW.height * 0.62, 10)
    await sleep(1400)

    fs.writeFileSync(VOLUMES, JSON.stringify([{ path: CARD, label: 'EOS_R6' }]))
    take.mark('card')
    await waitText(c, /Audit Batch Review/)
    take.mark('grid')
    await sleep(2400)

    const grid = JSON.parse(await c.ev(`JSON.stringify([...document.querySelectorAll('[data-grid-key]')].map((e) => { const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } }))`))
    await take.glide(grid[1].x, grid[1].y, 1000)
    await sleep(300)
    await take.click(2)
    take.mark('viewer')
    await sleep(1500)
    for (const [key, label, after] of [['5', 'key:5', 900], ['p', 'key:P', 1200], ['ArrowRight', 'key:→', 1000], ['4', 'key:4', 1200], ['Escape', 'key:Esc', 1500]]) {
      await take.key(key)
      take.mark(label)
      await sleep(after)
    }
    take.mark('grid2')

    const send = await centreOf(c, 'button', 'Initiate Trans')
    await take.glide(send.x, send.y, 1100)
    await sleep(300)
    await take.click()
    take.mark('send')
    await waitText(c, /INGEST (COMPLETE|INCOMPLETE)/, 180000)
    take.mark('done')
    await sleep(2200)

    const go = await centreOf(c, 'button', 'Go to Workstation')
    await take.glide(go.x, go.y, 1000)
    await sleep(250)
    await take.click()
    take.mark('workstation')
    await sleep(3500)
    // Down to the day the photographs were taken, if it did not open there.
    for (const name of ['2026', 'October', '17']) {
      const here = await c.ev(`!![...document.querySelectorAll('[role=button]')].find((b) => b.offsetParent && (b.getAttribute('aria-label') || '').trim() === ${JSON.stringify(name)})`)
      if (!here) continue
      const f = await centreOf(c, '[role=button]', `^${name}$`)
      await take.glide(f.x, f.y, 850)
      await sleep(150)
      await take.click()
      take.mark(`open ${name}`)
      await sleep(2300)
    }
    await waitText(c, /02-la-muralla-roja/, 20000).catch(() => {})
    await sleep(1800)
    take.mark('day')

    const photo = await centreOf(c, '[role=button]', '^02-la-muralla-roja')
    await take.glide(photo.x, photo.y, 1000)
    await sleep(250)
    await take.click(2)
    take.mark('drive-viewer')
    await sleep(2200)
    const edit = await centreOf(c, '[role=dialog] button', '^Edit$')
    await take.glide(edit.x, edit.y, 950)
    await sleep(250)
    await take.click()
    take.mark('edit')
    await waitText(c, /Exposure/, 60000)
    // The photograph arrives a few seconds after the panel.
    for (let i = 0; i < 40 && !(await c.ev(`!!document.querySelector('canvas') && document.querySelector('canvas').width > 300`)); i++) await sleep(250)
    await sleep(3500)
    take.mark('editor')

    const presets = await centreOf(c, 'button', '^Presets$')
    await take.glide(presets.x, presets.y, 900)
    await sleep(200)
    await take.click()
    take.mark('presets')
    await waitText(c, /Muted Film/, 20000)
    await sleep(1400)
    const film = await centreOf(c, '*', '^Muted Film$')
    await take.glide(film.x, film.y - 50, 800)
    await sleep(300)
    await take.click()
    take.mark('preset')
    await sleep(2200)

    const slider = async (index) => JSON.parse(await c.ev(`JSON.stringify((() => { const s = [...document.querySelectorAll('.cursor-ew-resize')].filter((e) => e.offsetParent)[${index}]; const b = s.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width } })())`))
    for (const [index, by, label] of [[3, 0.3, 'shadows'], [6, -0.2, 'temperature']]) {
      const s = await slider(index)
      await take.glide(s.x, s.y, 850)
      await sleep(250)
      take.mark(label)
      await take.drag(s.x + s.w * by, s.y, 1500)
      take.mark(`${label}:done`)
      await sleep(900)
    }
    await take.glide(VIEW.width * 0.42, VIEW.height * 0.55, 1200)
    await sleep(2000)
    take.mark('end')
    await take.stop()
  },
}

const c = await connect()
try {
  const wanted = process.argv.slice(2)
  for (const name of wanted.length ? wanted : Object.keys(TAKES)) {
    if (!TAKES[name]) throw new Error(`No take called ${name}`)
    console.log(name)
    await TAKES[name](c)
  }
} finally {
  fs.writeFileSync(VOLUMES, '[]')
  await c.send('Emulation.clearDeviceMetricsOverride').catch(() => {})
  c.ws.close()
}

#!/usr/bin/env node
/**
 * Rasterises build-resources/icon.svg into the app icon set.
 *
 * Runs under Electron rather than plain Node: Chromium is the renderer,
 * so the SVG rasterises exactly as it will in the app, and no image
 * dependency joins a repo we just finished slimming down.
 *
 * CommonJS on purpose. Electron 33's ESM loader cannot import the
 * `electron` module from a directly-run .mjs. Its CJS shim fails ESM
 * preparse and the process dies before the first line runs.
 *
 * Rasterising goes through a canvas in the renderer rather than
 * capturePage: capturePage waits on the window compositor, which never
 * produces a frame for a hidden window and stalls on a transparent one.
 * Canvas has no such dependency, so the window stays hidden.
 *
 * Usage:  npm run icons
 */
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync, mkdirSync, rmSync } = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'build-resources', 'icon.svg')
const OUT = path.join(ROOT, 'build-resources')

// 256 must be present: electron-builder rejects a Windows icon without it.
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const EXTRA = [512]

/**
 * Packs PNG buffers into an .ico.
 *
 * Six-byte header, a 16-byte directory entry per image, then the
 * payloads. Windows has accepted PNG payloads since Vista, so entries
 * point at the PNG verbatim. No BMP re-encoding, no AND mask.
 */
function encodeIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)

  const entries = []
  let offset = 6 + images.length * 16

  for (const { size, data } of images) {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0)  // 0 encodes 256
    e.writeUInt8(size >= 256 ? 0 : size, 1)
    e.writeUInt8(0, 2)
    e.writeUInt8(0, 3)
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    entries.push(e)
    offset += data.length
  }

  return Buffer.concat([header, ...entries, ...images.map(i => i.data)])
}

async function main() {
  await app.whenReady()

  const svg = readFileSync(SRC, 'utf8')
  const win = new BrowserWindow({ show: false, width: 64, height: 64 })

  // A real file:// host page, not a data: URL. A data: document has an
  // opaque origin and Chromium refuses to decode an image from it, which
  // surfaces only as a bare "svg failed to decode".
  mkdirSync(OUT, { recursive: true })
  const host = path.join(OUT, '.icon-host.html')
  writeFileSync(host, '<!doctype html><meta charset="utf-8"><title>icon</title>')
  await win.loadFile(host)

  const sizes = [...ICO_SIZES, ...EXTRA]

  // Each size is drawn from the SVG at that exact size rather than
  // downsampled from one master. Chromium re-rasterises the vector per
  // size, so 16px keeps crisp stroke edges instead of the mush a
  // bilinear downsample from 1024px would give.
  const results = await win.webContents.executeJavaScript(`
    (async () => {
      const blob = new Blob([${JSON.stringify(svg)}], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      const out = {}
      for (const size of ${JSON.stringify(sizes)}) {
        const img = new Image()
        img.width = size
        img.height = size
        await new Promise((res, rej) => {
          img.onload = res
          img.onerror = () => rej(new Error('svg failed to decode'))
          img.src = url
        })
        const c = document.createElement('canvas')
        c.width = size
        c.height = size
        const ctx = c.getContext('2d')
        ctx.clearRect(0, 0, size, size)
        ctx.drawImage(img, 0, 0, size, size)
        out[size] = c.toDataURL('image/png').split(',')[1]
      }
      return out
    })()
  `)

  const buf = size => Buffer.from(results[size], 'base64')

  mkdirSync(OUT, { recursive: true })
  writeFileSync(path.join(OUT, 'icon.ico'), encodeIco(ICO_SIZES.map(size => ({ size, data: buf(size) }))))
  writeFileSync(path.join(OUT, 'icon.png'), buf(512))

  // Previews so the result can be eyeballed at the sizes that matter.
  for (const s of [256, 32, 16]) writeFileSync(path.join(OUT, `preview-${s}.png`), buf(s))

  rmSync(host, { force: true })

  console.log('  icon.ico')
  for (const size of ICO_SIZES) console.log(`    ${String(size).padStart(3)}px  ${String(buf(size).length).padStart(6)} bytes`)
  console.log('  icon.png   512px')
  console.log('  preview-16/32/256.png : regenerable, not committed')
}

main().then(
  () => app.exit(0),
  err => { console.error('  FAILED: ' + (err && err.stack || err)); app.exit(1) },
)

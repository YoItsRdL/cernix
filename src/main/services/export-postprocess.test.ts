import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { postprocessExport } from './export-postprocess'

/**
 * What an exported photograph actually carries.
 *
 * This is the one editor failure that is silent. Everything else in the
 * pipeline shows itself the moment you look at the screen: a slider that
 * does nothing, a crop in the wrong place. An export that carries the
 * wrong metadata looks perfect in the app and is wrong forever after, in
 * a file the photographer has already sent to a client.
 *
 * The sharpest case is the embedded preview. `-TagsFromFile src -all:all`
 * copies the source's preview bitmaps along with its EXIF, and phone
 * galleries and social sites display those rather than decoding the full
 * image. Left in place, an edited export shows the unedited photograph
 * everywhere that matters, while looking correct in any desktop viewer
 * that decodes properly.
 */

const cjsRequire = createRequire(import.meta.url)
const EXIFTOOL = cjsRequire(
  process.platform === 'win32' ? 'exiftool-vendored.exe' : 'exiftool-vendored.pl',
) as string

/**
 * Real JPEGs, generated once in Electron.
 *
 * Deliberately different sizes. EXIF can be copied from one file to
 * another, but a JPEG's own SOF header cannot, so the decoded dimensions
 * are the one thing that says which frame the bytes actually are.
 */
const RED = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAQABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABwj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCVAC9XD//Z', 'base64')
const BLUE = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAYADADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAcI/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AmgDQaKAAAAAAAAAAP//Z', 'base64')

/**
 * exiftool's own JSON, so no output parsing has to be invented here.
 *
 * `-G0` prefixes every key with its group (`EXIF:Make`), which is what
 * makes the source of a tag unambiguous, so lookups go through the
 * group-insensitive helper below rather than guessing the prefix.
 */
function tags(file: string): Record<string, unknown> {
  const out = execFileSync(EXIFTOOL, ['-json', '-a', '-G0', file], { encoding: 'utf8' })
  return (JSON.parse(out) as Record<string, unknown>[])[0]
}

/** A tag by bare name, whatever group it arrived under. */
function tag(all: Record<string, unknown>, name: string): unknown {
  const key = Object.keys(all).find(k => k === name || k.endsWith(':' + name))
  return key === undefined ? undefined : all[key]
}

/**
 * These spawn `exiftool` as a real one-shot process, twice per case, which
 * the module does deliberately rather than share a stay-open instance.
 * Vitest's 5s default is not a meaningful bound for that: the same cases
 * measured 2.8s warm and over 8s on a loaded machine, and a CI runner is
 * colder than either. The generous timeout is about process startup, not
 * about tolerating a slow assertion.
 */
const EXIFTOOL_TIMEOUT = 30_000

let dir: string
let source: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cernix-export-'))
  source = path.join(dir, 'DSC_0001.JPG')
  fs.writeFileSync(source, RED)
  // The preview has to come from its own file. Pointing
  // `-ThumbnailImage<=` at the image being modified silently writes
  // nothing, which is what the fixture-guard test above exists to catch.
  const thumb = path.join(dir, 'thumb.jpg')
  fs.writeFileSync(thumb, RED)
  // A camera-like source: identity, a capture date, an orientation the
  // render has already baked into the pixels, and a preview bitmap of
  // the unedited frame.
  execFileSync(EXIFTOOL, [
    '-overwrite_original',
    '-Make=TestCam',
    '-Model=T-1000',
    '-DateTimeOriginal=2026:05:01 10:00:00',
    '-Orientation#=6',
    '-ThumbnailImage<=' + thumb,
    source,
  ])
})
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

async function exportOf(edited: Buffer): Promise<Record<string, unknown>> {
  const { bytes } = await postprocessExport(new Uint8Array(edited), source)
  const out = path.join(dir, 'out.jpg')
  fs.writeFileSync(out, bytes)
  return tags(out)
}

describe('postprocessExport', () => {
  it('confirms the fixture really does carry a preview of the source', () => {
    const t = tags(source)
    expect(tag(t, 'ThumbnailImage'), 'the test is meaningless without one').toBeTruthy()
    expect(tag(t, 'Make')).toBe('TestCam')
  })

  it('carries the camera identity and capture date onto the export', async () => {
    const t = await exportOf(BLUE)
    expect(tag(t, 'Make')).toBe('TestCam')
    expect(tag(t, 'Model')).toBe('T-1000')
    expect(tag(t, 'DateTimeOriginal')).toBe('2026:05:01 10:00:00')
  }, EXIFTOOL_TIMEOUT)

  /**
   * The silent one. If the source's preview survives, every phone
   * gallery and social upload shows the frame before the edit.
   */
  it('does not leave the unedited frame in the embedded preview', async () => {
    const t = await exportOf(BLUE)
    expect(tag(t, 'ThumbnailImage') ?? null, 'the source preview must not survive').toBeNull()
    expect(tag(t, 'PreviewImage') ?? null).toBeNull()
  }, EXIFTOOL_TIMEOUT)

  /**
   * The rendered pixels already have the rotation applied, so carrying
   * the source's Orientation rotates them a second time in any viewer
   * that honours the tag.
   */
  it('clears the orientation the render has already applied', async () => {
    const t = await exportOf(BLUE)
    const o = String(tag(t, 'Orientation') ?? '')
    expect(['', '1', 'Horizontal (normal)'], `orientation was ${o}`).toContain(o)
  }, EXIFTOOL_TIMEOUT)

  // The whole point is to enrich the edited frame, not hand back the
  // source. A postprocess that returned the original would satisfy every
  // metadata assertion above and be completely wrong.
  it('returns the edited image, not the source', async () => {
    const t = await exportOf(BLUE)
    // Asserted on the decoded size rather than on the bytes. The first
    // version compared the output against the source buffer, which
    // differs after exiftool has written to it whatever the pixels are,
    // so handing back the source outright still passed.
    expect(tag(t, 'ImageWidth'), 'the export carries the source frame').toBe(48)
    expect(tag(t, 'ImageHeight')).toBe(24)
  }, EXIFTOOL_TIMEOUT)

  it('returns usable bytes when there is no source to enrich from', async () => {
    const { bytes, warning } = await postprocessExport(new Uint8Array(BLUE), null)
    expect(Buffer.from(bytes).equals(BLUE)).toBe(true)
    expect(warning).toBeTruthy()
  }, EXIFTOOL_TIMEOUT)

  it('returns usable bytes when the source has gone missing', async () => {
    const { bytes, warning } = await postprocessExport(new Uint8Array(BLUE), path.join(dir, 'nope.JPG'))
    expect(Buffer.from(bytes).equals(BLUE)).toBe(true)
    expect(warning).toBeTruthy()
  }, EXIFTOOL_TIMEOUT)
})

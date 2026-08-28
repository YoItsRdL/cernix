import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { XmpWriter } from './xmp-writer'
import { DEFAULT_PARAMS } from '../../shared/edit-params'
import type { EditParams } from '../../shared/edit-params'

/**
 * The sidecar is where a user's edits live.
 *
 * Nothing else persists them: the pipeline holds them in memory and this
 * file is the only thing that survives closing the app. A key that
 * `serialize` writes and `parse` forgets does not fail loudly, it
 * silently reverts that slider to its default the next time the photo is
 * opened, which reads as "the app lost my edit".
 *
 * The round-trip is asserted by perturbing every leaf of DEFAULT_PARAMS
 * rather than by naming fields, so a slider added later is covered the
 * day it is added instead of the day someone remembers this file.
 */

/** Move every leaf off its default so a dropped key cannot look correct. */
function perturb(value: unknown, depth = 0): unknown {
  if (typeof value === 'number') return Number((value + 0.37).toFixed(4))
  if (typeof value === 'boolean') return !value
  if (Array.isArray(value)) return value.map(v => perturb(v, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = perturb(v, depth + 1)
    return out
  }
  return value   // strings are enum-ish here; changing them would test the enum, not the round-trip
}

let dir: string
let photo: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cernix-xmp-'))
  photo = path.join(dir, 'DSC_0001.ARW')
  fs.writeFileSync(photo, 'not-really-a-raw')
})
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

describe('XmpWriter', () => {
  it('puts the sidecar beside the source', () => {
    expect(XmpWriter.sidecarPath(photo)).toBe(photo + '.xmp')
  })

  it('returns defaults when there is no sidecar', async () => {
    expect(await XmpWriter.read(photo)).toEqual(DEFAULT_PARAMS)
  })

  it('round-trips the defaults unchanged', async () => {
    await XmpWriter.write(photo, DEFAULT_PARAMS)
    expect(await XmpWriter.read(photo)).toEqual(DEFAULT_PARAMS)
  })

  /**
   * The one that matters: every leaf moved off its default at once.
   *
   * Two fields need a valid value rather than a nudged one, and both
   * are the writer being right rather than wrong. `orientation` parses
   * only 0/90/180/270, so an arbitrary float is correctly refused.
   * `lightLeak` is deliberately not written at all while its preset is
   * `none`, so nudging the numbers underneath an off switch tests
   * nothing. Nudging them anyway is what made this test fail first
   * time, and reading the writer rather than trusting the test is what
   * showed it was the test that was wrong.
   */
  it('round-trips a fully non-default edit without losing a field', async () => {
    const edited = perturb(DEFAULT_PARAMS) as EditParams
    edited.orientation = 90
    edited.lightLeak = { preset: 'ember', intensity: 0.87, rotation: 0.37, spread: 1.37 }
    await XmpWriter.write(photo, edited)
    const back = await XmpWriter.read(photo)

    const lost: string[] = []
    for (const key of Object.keys(edited) as (keyof EditParams)[]) {
      if (JSON.stringify(back[key]) !== JSON.stringify(edited[key])) {
        lost.push(`${String(key)}: wrote ${JSON.stringify(edited[key])}, read ${JSON.stringify(back[key])}`)
      }
    }
    expect(lost, 'fields that did not survive the sidecar').toEqual([])
  })

  it('creates the parent directory when it is missing', async () => {
    const nested = path.join(dir, 'a', 'b', 'DSC_0002.ARW')
    await XmpWriter.write(nested, DEFAULT_PARAMS)
    expect(fs.existsSync(nested + '.xmp')).toBe(true)
  })

  // A truncated or corrupted sidecar must not take the editor down with
  // it. Falling back to defaults loses the edit, which is bad, but
  // throwing on open loses the photograph's editability entirely.
  it('falls back to defaults rather than throwing on a corrupt sidecar', async () => {
    for (const junk of ['', 'not xml at all', '<x:xmpmeta><truncated', '<?xml version="1.0"?><a/>']) {
      fs.writeFileSync(photo + '.xmp', junk)
      await expect(XmpWriter.read(photo)).resolves.toBeTruthy()
    }
  })

  it('overwrites a previous sidecar rather than appending to it', async () => {
    await XmpWriter.write(photo, DEFAULT_PARAMS)
    const edited = perturb(DEFAULT_PARAMS) as EditParams
    await XmpWriter.write(photo, edited)
    const raw = fs.readFileSync(photo + '.xmp', 'utf8')
    expect(raw.match(/<x:xmpmeta/g) || []).toHaveLength(1)
  })
})

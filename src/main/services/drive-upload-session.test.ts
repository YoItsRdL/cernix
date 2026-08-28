import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { DriveUploadService } from './drive-upload'

/**
 * The upload queue's orchestration.
 *
 * This is the last point at which a photograph exists only on the card.
 * The user watches this finish and then formats. So the property that
 * matters is not throughput or retries, it is that the session cannot
 * report success while a file is missing, and that every selected file
 * is attempted exactly once.
 */

let staging: string
let uploaded: string[]
let failFor: (name: string) => boolean

const driveClient = {
  getRootFolderId: async () => 'root-id',
  createSubfolder: async (parent: string, name: string) => `${parent}/${name}`,
}

function stubFetch() {
  vi.stubGlobal('fetch', async (url: string, init?: { body?: unknown }) => {
    // Only the multipart upload endpoint is exercised by these sizes.
    const body = String(init?.body ?? '')
    const nameMatch = /"name":"([^"]+)"/.exec(body)
    const name = nameMatch ? nameMatch[1] : '<unknown>'
    uploaded.push(name)
    if (failFor(name)) {
      return { ok: false, status: 400, text: async () => 'permanently rejected' }
    }
    return { ok: true, status: 200, json: async () => ({ id: 'drive-' + name }) }
  })
}

function write(rel: string, bytes: number) {
  const p = path.join(staging, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, Buffer.alloc(bytes, 7))
}

beforeEach(() => {
  staging = fs.mkdtempSync(path.join(os.tmpdir(), 'cernix-upload-'))
  uploaded = []
  failFor = () => false
  stubFetch()
})
afterEach(() => {
  vi.unstubAllGlobals()
  fs.rmSync(staging, { recursive: true, force: true })
})

const service = () => new DriveUploadService(async () => 'token', driveClient as never)

describe('DriveUploadService.uploadSession', () => {
  it('uploads every staged file exactly once', async () => {
    write('2026/05/01/DSC_0001.jpg', 64)
    write('2026/05/01/DSC_0002.jpg', 64)
    write('2026/05/02/DSC_0003.jpg', 64)

    const summary = await service().uploadSession({ sessionId: 's1', stagingPath: staging, driveFolderName: 's1-folder' })

    expect(summary.totalFiles).toBe(3)
    expect(summary.completedFiles).toBe(3)
    expect(summary.failedFiles).toBe(0)
    expect(uploaded.slice().sort()).toEqual(['DSC_0001.jpg', 'DSC_0002.jpg', 'DSC_0003.jpg'])
    expect(new Set(uploaded).size, 'no file uploaded twice').toBe(3)
  })

  it('uploads only the files the session selected', async () => {
    write('2026/05/01/keep.jpg', 64)
    write('2026/05/01/skip.jpg', 64)

    const summary = await service().uploadSession({
      sessionId: 's2', stagingPath: staging, driveFolderName: 's2-folder',
      filterFiles: [path.join('2026', '05', '01', 'keep.jpg')],
    })

    expect(uploaded).toEqual(['keep.jpg'])
    expect(summary.totalFiles).toBe(1)
  })

  /**
   * The one that costs photographs.
   *
   * A session that could not upload every file must not describe itself
   * as complete, because the renderer takes that word at face value,
   * shows 100%, and the user then formats the card.
   */
  it('does not report a clean completion when a file failed', async () => {
    write('2026/05/01/ok.jpg', 64)
    write('2026/05/01/doomed.jpg', 64)
    failFor = name => name === 'doomed.jpg'

    const summary = await service().uploadSession({ sessionId: 's3', stagingPath: staging, driveFolderName: 's3-folder' })

    expect(summary.failedFiles, 'the failure must be counted').toBe(1)
    expect(summary.completedFiles).toBe(1)
    expect(summary.status, 'a session with a failed file is not "complete"').not.toBe('complete')
  })

  it('completes cleanly when there is nothing staged', async () => {
    const summary = await service().uploadSession({ sessionId: 's4', stagingPath: staging, driveFolderName: 's4-folder' })
    expect(summary.totalFiles).toBe(0)
    expect(summary.status).toBe('complete')
  })
})

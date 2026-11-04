import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DriveUploadService } from './drive-upload'

/**
 * The upload path's retry classification.
 *
 * A wrong answer here is not a slow upload. Called retryable when it is
 * not, the queue burns its attempts and reports "network instability"
 * for something that will never succeed. Called permanent when it was
 * transient, the file is dropped from the session and the photographer
 * is told the upload finished.
 *
 * The method is private because nothing outside needs it; it is reached
 * here directly because the classification is the behaviour worth
 * pinning, and driving it through a real upload would test `fetch`.
 */
const service = () => new DriveUploadService(async () => 'token', {} as never)
const retryable = (err: unknown): boolean =>
  (service() as unknown as { isRetryableError(e: unknown): boolean }).isRetryableError(err)

describe('DriveUploadService retry classification', () => {
  it('retries the transport failures a field upload actually hits', () => {
    for (const err of [
      new Error('fetch failed'),
      new Error('Request timeout'),
      new Error('network unreachable'),
      Object.assign(new Error('x'), { code: 'ECONNRESET' }),
      Object.assign(new Error('x'), { code: 'ETIMEDOUT' }),
      Object.assign(new Error('x'), { code: 'ENOTFOUND' }),
      Object.assign(new Error('x'), { code: 'ECONNREFUSED' }),
    ]) expect(retryable(err), String((err as Error).message)).toBe(true)
  })

  it('retries the server statuses Drive returns under load', () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(retryable(new Error(`Chunk upload failed (${status}): backend error`)), String(status)).toBe(true)
    }
  })

  it('does not retry a failure that will never succeed', () => {
    for (const err of [
      new Error('Chunk upload failed (400): malformed request'),
      new Error('Chunk upload failed (404): file not found'),
      new Error('insufficient permissions'),
    ]) expect(retryable(err), String((err as Error).message)).toBe(false)
  })

  it('survives a thrown value that is not an Error', () => {
    for (const err of [null, undefined, 'boom', 42, {}]) {
      expect(() => retryable(err)).not.toThrow()
    }
  })

  /**
   * The status codes are matched as substrings of the whole message,
   * and a message carries the filename and the byte counts. Camera
   * filenames run to five digits and RAW files are megabytes, so the
   * digits that mean "server error" turn up constantly in messages that
   * mean nothing of the sort.
   */
  it('does not mistake digits in a filename or byte count for a status', () => {
    expect(retryable(new Error('Upload failed for IMG_1500.ARW: permission denied')), 'filename 1500').toBe(false)
    expect(retryable(new Error('Chunk upload failed (400): quota of 503316480 bytes exceeded')), 'byte count 503').toBe(false)
    expect(retryable(new Error('Chunk upload failed (403): file 5040 is owned by another user')), 'id 5040').toBe(false)
  })

  /**
   * Google returns 403 for rate limiting as well as for permission
   * denial, and its own guidance is to back off and retry the former.
   * Treated as permanent, a burst upload drops files the API only asked
   * us to slow down for.
   */
  it('retries a 403 that is a rate limit, not a permission denial', () => {
    expect(retryable(new Error('Chunk upload failed (403): userRateLimitExceeded'))).toBe(true)
    expect(retryable(new Error('Chunk upload failed (403): rateLimitExceeded'))).toBe(true)
    expect(retryable(new Error('Chunk upload failed (403): insufficientPermissions')), 'a real permission denial stays permanent').toBe(false)
  })
})

/**
 * The id Google gives a new file. It was read as a status and its body
 * dropped, so a finished upload carried no Drive id: the ledger column was
 * never filled and a rating made on the card could not follow the file.
 */
describe('DriveUploadService keeps the id Google returns', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  const job = (file: string, size: number) => ({
    id: 'j1', filePath: file, fileName: path.basename(file), mimeType: 'image/jpeg', sizeBytes: size,
    driveFolderId: 'folder', status: 'pending', progress: 0, bytesUploaded: 0, resumeUri: null, retryCount: 0, error: null,
  }) as Record<string, unknown>
  const upload = (kind: 'simpleUpload' | 'resumableUpload', j: Record<string, unknown>) =>
    (service() as unknown as Record<string, (j: unknown, t: string) => Promise<void>>)[kind](j, 'token')

  it('on a small file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cernix-up-'))
    try {
      const file = path.join(dir, 'a.jpg'); fs.writeFileSync(file, 'abc')
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: '1AbC_driveId', name: 'a.jpg' }), { status: 200 })))
      const j = job(file, 3)
      await upload('simpleUpload', j)
      expect(j.driveFileId).toBe('1AbC_driveId')
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('on a file sent in chunks, from the reply to the last one', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cernix-up-'))
    try {
      const file = path.join(dir, 'b.jpg'); fs.writeFileSync(file, 'abcdef')
      const replies = [
        new Response('', { status: 200, headers: { location: 'https://upload.example/session' } }),  // session started
        new Response(JSON.stringify({ id: 'chunkedId' }), { status: 200 }),                           // last chunk
      ]
      vi.stubGlobal('fetch', vi.fn(async () => replies.shift()!))
      const j = job(file, 6)
      await upload('resumableUpload', j)
      expect(j.driveFileId).toBe('chunkedId')
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('leaves it empty, rather than failing the upload, when the reply has no usable id', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cernix-up-'))
    try {
      const file = path.join(dir, 'c.jpg'); fs.writeFileSync(file, 'abc')
      vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
      const j = job(file, 3)
      await upload('simpleUpload', j)
      expect(j.driveFileId).toBeNull()
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})

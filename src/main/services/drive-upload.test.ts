import { describe, it, expect } from 'vitest'
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

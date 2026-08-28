import { CERNIX_ROOT_FOLDER, CERNIX_SHARED_FOLDER } from '../constants'
import type { SyncDatabase } from './sync-db'

/**
 * What the Drive v3 files endpoint sends back, narrowed to the fields
 * this client asks for in `fields`. Optional throughout because the API
 * omits anything empty, which is the part that matters: every read of
 * one of these has to cope with it being absent.
 */
interface DriveApiFile {
  id: string
  name: string
  /** Always present for a real file when asked for; `size` is not, and
   *  neither are the media blocks, so those stay optional. */
  mimeType: string
  createdTime: string
  modifiedTime: string
  size?: string
  thumbnailLink?: string
  webViewLink?: string
  imageMediaMetadata?: { time?: string }
  videoMediaMetadata?: Record<string, unknown>
}

interface DriveApiList {
  files?: DriveApiFile[]
  nextPageToken?: string
}


/** Every Drive operation except uploading: browse, move, rename, trash,
 *  restore, share. Uploading is drive-upload.ts, which has its own queue
 *  and resume behaviour. */
/** Persistence hook for the library root's file id. Optional, without
 *  it the id is resolved by name on every launch, which is fine but
 *  costs a search round-trip and depends on the folder staying visible
 *  to this OAuth client. */
export interface RootFolderStore {
  get(): string | null
  set(id: string): void
}

/**
 * Hosts a Drive thumbnail may legitimately live on.
 *
 * Exact suffix matching on the hostname, not `includes`: `googleapis.com
 * .attacker.example` contains the string and is not Google. Scheme is
 * pinned to https so the token cannot be sent in clear.
 */
const GOOGLE_MEDIA_HOSTS = ['googleusercontent.com', 'googleapis.com', 'google.com']

/**
 * Escape a value being interpolated into a Drive `q=` filter.
 *
 * Drive's query language delimits string literals with single quotes
 * and has no other way to express one, so a value carrying a quote ends
 * the literal early and the rest is parsed as query syntax: a folder
 * named `x' or '1'='1` matches things the caller never asked for.
 * Bounded by the `drive.file` scope, which only ever sees items this app
 * created, but bounded is not absent.
 *
 * Backslashes first, or the ones this adds get escaped again.
 */
export function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, '\\\'')
}

export function isGoogleMediaUrl(raw: string): boolean {
  let url: URL
  try { url = new URL(raw) } catch { return false }
  if (url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase()
  return GOOGLE_MEDIA_HOSTS.some(h => host === h || host.endsWith(`.${h}`))
}

export class DriveClient {
  private getToken: () => Promise<string | null>
  private rootFolderId: string | null = null
  private rootStore: RootFolderStore | null

  constructor(getToken: () => Promise<string | null>, rootStore?: RootFolderStore) {
    this.getToken = getToken
    this.rootStore = rootStore ?? null
  }

  // ── Root Folder ──

  /**
   * Resolve the library root, preferring a remembered id over a
   * name search.
   *
   * Under the `drive.file` scope a name search only sees folders this
   * client created, so remembering the id avoids creating a duplicate
   * when the original stops matching. A folder renamed in the Drive
   * UI, for instance. A remembered id that no longer resolves (deleted,
   * trashed, or access revoked) falls through to find-or-create.
   */
  async getRootFolderId(): Promise<string> {
    const token = await this.requireToken()
    if (this.rootFolderId) return this.rootFolderId

    const remembered = this.rootStore?.get() ?? null
    if (remembered && await this.folderExists(remembered, token)) {
      this.rootFolderId = remembered
      return remembered
    }

    const id = await this.findOrCreateFolder(CERNIX_ROOT_FOLDER, 'root', token)
    this.rootFolderId = id
    this.rootStore?.set(id)
    return id
  }

  /** True when the id resolves to a live, untrashed folder we can see. */
  private async folderExists(id: string, token: string): Promise<boolean> {
    try {
      const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`)
      url.searchParams.set('fields', 'id,trashed,mimeType')
      const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return false
      const data = await res.json() as { trashed?: boolean; mimeType?: string }
      return data.trashed !== true && data.mimeType === 'application/vnd.google-apps.folder'
    } catch {
      return false
    }
  }

  // ── Browse ──

  async listFolderContents(folderId: string): Promise<{
    files: { id: string; name: string; mimeType: string; size: string; createdTime: string; modifiedTime: string; captureTime: string | null; thumbnailLink?: string; webViewLink?: string }[]
    folders: { id: string; name: string; createdTime: string }[]
  }> {
    const token = await this.requireToken()

    const q = `'${escapeDriveQueryValue(folderId)}' in parents and trashed=false`

    // Followed to the end. 1000 is the largest page Drive will return,
    // and asking for one page was silently a limit: a folder with more
    // than a thousand items showed the first thousand and gave no sign
    // that the rest existed. The UI pages what it displays; that is a
    // separate question from having the folder in full.
    const items: DriveApiFile[] = []
    let pageToken = ''
    for (;;) {
      const url = new URL('https://www.googleapis.com/drive/v3/files')
      url.searchParams.set('q', q)
      url.searchParams.set('pageSize', '1000')
      url.searchParams.set('fields', 'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, imageMediaMetadata/time, videoMediaMetadata, thumbnailLink, webViewLink)')
      url.searchParams.set('orderBy', 'name')
      if (pageToken) url.searchParams.set('pageToken', pageToken)

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!response.ok) throw new Error(`Drive list failed (${response.status})`)
      const data = await response.json() as DriveApiList
      items.push(...(data.files || []))

      pageToken = data.nextPageToken ?? ''
      if (!pageToken) break
    }

    const FOLDER_MIME = 'application/vnd.google-apps.folder'
    const files = items.filter(f => f.mimeType !== FOLDER_MIME).map(f => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: f.size || '0',
      createdTime: f.createdTime,
      modifiedTime: f.modifiedTime || f.createdTime,
      captureTime: f.imageMediaMetadata?.time || null,
      thumbnailLink: f.thumbnailLink,
      webViewLink: f.webViewLink,
    }))

    const folders = items.filter(f => f.mimeType === FOLDER_MIME).map(f => ({
      id: f.id,
      name: f.name,
      createdTime: f.createdTime,
    }))

    return { files, folders }
  }

  // ── Mutations ──

  async moveFile(fileId: string, newParentId: string, currentParentId: string): Promise<void> {
    const token = await this.requireToken()
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?addParents=${encodeURIComponent(newParentId)}&removeParents=${encodeURIComponent(currentParentId)}`
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!response.ok) throw new Error(`Move failed (${response.status})`)
  }

  async renameFile(fileId: string, newName: string): Promise<void> {
    const token = await this.requireToken()
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: newName }),
      }
    )
    if (!response.ok) throw new Error(`Rename failed (${response.status})`)
  }

  async createSubfolder(parentId: string, name: string): Promise<string> {
    const token = await this.requireToken()
    return this.findOrCreateFolder(name, parentId, token)
  }

  /**
   * Trashing and untrashing are the same PATCH with a different flag, so
   * they share one implementation. An untrash that drifted from its
   * trash would be a very quiet way to lose files.
   */
  private async setTrashed(fileId: string, trashed: boolean): Promise<void> {
    const token = await this.requireToken()
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed }),
      }
    )
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`${trashed ? 'Trash' : 'Untrash'} failed (${response.status}): ${body}`)
    }
  }

  async trashFile(fileId: string): Promise<void> {
    return this.setTrashed(fileId, true)
  }

  /** Restores a trashed file. The inverse half of undo for a trash. */
  async untrashFile(fileId: string): Promise<void> {
    return this.setTrashed(fileId, false)
  }

  // ── Sharing ──

  async setPublic(fileId: string): Promise<void> {
    const token = await this.requireToken()
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'reader', type: 'anyone' }),
      }
    )
    if (!response.ok) throw new Error(`Share failed (${response.status})`)
  }

  /** List file names in a folder (used for duplicate detection before copy) */
  async listFileNames(folderId: string): Promise<Set<string>> {
    const token = await this.requireToken()
    const names = new Set<string>()
    let pageToken = ''
    while (true) {
      const url = new URL('https://www.googleapis.com/drive/v3/files')
      url.searchParams.set('q', `'${escapeDriveQueryValue(folderId)}' in parents and trashed=false`)
      url.searchParams.set('fields', 'nextPageToken, files(name)')
      url.searchParams.set('pageSize', '1000')
      if (pageToken) url.searchParams.set('pageToken', pageToken)
      const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
      if (!response.ok) break
      const data = await response.json() as DriveApiList
      for (const f of data.files || []) names.add(f.name)
      pageToken = data.nextPageToken ?? ''
      if (!pageToken) break
    }
    return names
  }

  // ── Download ──

  /**
   * Upload raw bytes as a new Drive file. The editor's export path ends
   * here: WebGL render -> blob -> ArrayBuffer -> this -> Drive.
   * Returns the new file ID + web view URL.
   */
  async uploadBytes(
    bytes: Uint8Array,
    name: string,
    parentFolderId: string,
    mimeType = 'image/jpeg',
  ): Promise<{ id: string; webViewLink?: string }> {
    const token = await this.requireToken()
    const boundary = `boundary-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const metadata = JSON.stringify({ name, parents: [parentFolderId] })
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
      ),
      Buffer.from(bytes),
      Buffer.from(`\r\n--${boundary}--`),
    ])
    const response = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
          'Content-Length': String(body.length),
        },
        body,
      }
    )
    if (!response.ok) {
      const errBody = await response.text()
      throw new Error(`Upload failed (${response.status}): ${errBody.slice(0, 200)}`)
    }
    return response.json() as Promise<{ id: string; webViewLink?: string }>
  }

  /** Download a file's binary content and write it to the given local path */
  async downloadFileToPath(fileId: string, destPath: string): Promise<void> {
    const token = await this.requireToken()
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) throw new Error(`Download failed (${response.status})`)
    const buffer = Buffer.from(await response.arrayBuffer())
    const fsp = await import('node:fs/promises')
    await fsp.writeFile(destPath, buffer)
  }

  /**
   * Stream a file from Drive to disk with progress callbacks. Returns total bytes
   * written. Used by the edit cache so large sources don't pin renderer memory
   * and the user sees loading progress.
   */
  async downloadFileStreaming(
    fileId: string,
    destPath: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<number> {
    const token = await this.requireToken()
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok || !response.body) throw new Error(`Download failed (${response.status})`)
    const total = Number(response.headers.get('content-length') || 0)
    const fs = await import('node:fs')
    const write = fs.createWriteStream(destPath)
    let done = 0
    const reader = response.body.getReader()
    try {
      while (true) {
        const { value, done: finished } = await reader.read()
        if (finished) break
        done += value.length
        write.write(value)
        onProgress?.(done, total || done)
      }
    } finally {
      write.end()
      reader.releaseLock()
    }
    await new Promise<void>((resolve, reject) => {
      write.on('finish', () => resolve())
      write.on('error', reject)
    })
    return done
  }

  // ── Thumbnails ──

  async getThumbnailBase64(url: string): Promise<string | null> {
    // The URL arrives from the renderer, and the token goes out in an
    // Authorization header from the main process, where the page's CSP
    // does not apply. Without this check any host the renderer names
    // receives a live Drive credential.
    if (!isGoogleMediaUrl(url)) {
      console.warn('[DriveClient] Refused a thumbnail fetch for a non-Google host')
      return null
    }
    try {
      const token = await this.requireToken()
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (!response.ok) return null
      const buffer = await response.arrayBuffer()
      const base64 = Buffer.from(buffer).toString('base64')
      const contentType = response.headers.get('content-type') || 'image/jpeg'
      return `data:${contentType};base64,${base64}`
    } catch {
      return null
    }
  }

  // ── Ledger ──

  async rebuildCloudLedger(syncDb: SyncDatabase): Promise<number> {
    const token = await this.requireToken()

    // Gathered in full before anything is written. See
    // SyncDatabase.replaceSyncRecords: a rebuild that fails halfway
    // used to leave a truncated ledger behind, which reads as "these
    // files were never uploaded".
    const gathered: { fileName: string; sizeBytes: number; driveFileId: string | null }[] = []
    let pageToken = ''
    // Unqualified by folder on purpose: under `drive.file` the result set
    // is already limited to items this app created, which is exactly what
    // the ledger tracks. Records are keyed on (name, size), so a wider
    // scope would let an unrelated file elsewhere in the user's Drive
    // shadow a card file of the same name and size and suppress its
    // upload.
    const q = 'trashed=false and (mimeType contains \'image/\' or mimeType contains \'video/\')'

    while (true) {
      const url = new URL('https://www.googleapis.com/drive/v3/files')
      url.searchParams.set('q', q)
      url.searchParams.set('pageSize', '1000')
      url.searchParams.set('fields', 'nextPageToken, files(id, name, size)')
      if (pageToken) url.searchParams.set('pageToken', pageToken)

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!response.ok) throw new Error(`Drive API error: ${response.status}`)

      const data = await response.json() as DriveApiList
      for (const f of data.files || []) {
        if (f.name && f.size) {
          gathered.push({ fileName: f.name, sizeBytes: Number(f.size), driveFileId: f.id })
        }
      }

      pageToken = data.nextPageToken ?? ''
      if (!pageToken) break
    }

    syncDb.replaceSyncRecords(gathered)
    return gathered.length
  }

  // ── Internal ──

  /**
   * Resolve the destination folder for an export: mirror the source file's
   * path under the shared public root. Source at `Cernix/2026/April/x.jpg`
   * becomes `Cernix Shared/2026/April/` - creating any missing folders.
   *
   * The shared root is made link-shareable the first time it's created so
   * every export placed inside inherits that affordance without extra calls.
   * Returns { folderId, path } where path is the array of folder names under
   * the shared root (useful for the UI).
   */
  async resolveSharedMirrorFolder(sourceFileId: string): Promise<{ folderId: string; path: string[] }> {
    const token = await this.requireToken()

    // 1. Ensure the shared root exists; make it public on creation.
    const sharedRoot = await this.findOrCreateFolder(CERNIX_SHARED_FOLDER, 'root', token, {
      onCreate: async (id) => { await this.setPublic(id).catch(() => { /* non-fatal */ }) },
    })

    // 2. Walk the source's parent chain. Collect folder names until we hit
    //    the Cernix library root (or drive root). These names are the
    //    mirror path under the shared root.
    const ancestry: string[] = []
    let currentId: string | null = sourceFileId
    let currentIsSource = true
    const seen = new Set<string>()
    while (currentId && !seen.has(currentId)) {
      seen.add(currentId)
      const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(currentId)}`)
      url.searchParams.set('fields', 'id,name,parents')
      const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) break
      const data = await res.json() as { id: string; name: string; parents?: string[] }
      if (!currentIsSource) {
        if (data.name === CERNIX_ROOT_FOLDER) break // stop at the library root
        ancestry.unshift(data.name)
      }
      currentIsSource = false
      const nextParent = data.parents?.[0]
      if (!nextParent) break
      currentId = nextParent
    }

    // 3. Walk-or-create the mirror path under the shared root.
    let folderId = sharedRoot
    for (const name of ancestry) {
      folderId = await this.findOrCreateFolder(name, folderId, token)
    }
    return { folderId, path: ancestry }
  }

  /** Create or resolve a direct child folder. Thin public wrapper so callers
   *  outside the client don't need access to raw tokens. */
  async findOrCreateChildFolder(parentId: string, name: string): Promise<string> {
    const token = await this.requireToken()
    return this.findOrCreateFolder(name, parentId, token)
  }

  async findOrCreateFolder(
    name: string,
    parentId: string,
    token: string,
    options?: { onCreate?: (id: string) => Promise<void> | void },
  ): Promise<string> {
    const query = `name='${escapeDriveQueryValue(name)}' and mimeType='application/vnd.google-apps.folder' and '${escapeDriveQueryValue(parentId)}' in parents and trashed=false`
    const searchUrl = new URL('https://www.googleapis.com/drive/v3/files')
    searchUrl.searchParams.set('q', query)
    searchUrl.searchParams.set('fields', 'files(id)')

    const searchResponse = await fetch(searchUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!searchResponse.ok) throw new Error(`Folder search failed (${searchResponse.status})`)
    const searchData = await searchResponse.json() as DriveApiList
    if (searchData.files?.length) return searchData.files[0].id

    const createResponse = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      }),
    })
    if (!createResponse.ok) throw new Error(`Folder creation failed (${createResponse.status})`)
    const created = await createResponse.json() as { id: string }
    if (options?.onCreate) await options.onCreate(created.id)
    return created.id
  }


  private async requireToken(): Promise<string> {
    const token = await this.getToken()
    if (!token) throw new Error('Not authenticated')
    return token
  }
}

import { contextBridge, ipcRenderer } from 'electron'

/**
 * Interface theme: the stored one, read from main synchronously.
 *
 * Synchronous on purpose: the class has to be on <html> before the
 * renderer paints, and an async round trip after load shows a frame of
 * the wrong theme. The window's backgroundColor covers the remaining
 * gap before the document exists.
 *
 * It was a launch argument, which is fixed for the window's life: after
 * a switch and a reload, the preload put the launch theme back while
 * the stored one differed. Kept current here so that a remounted rail
 * asks `themeGet` and hears the theme on screen, not the launch one.
 */
let currentTheme: 'light' | 'dark' = ipcRenderer.sendSync('theme:get') === 'dark' ? 'dark' : 'light'

/** Who wants to hear that the theme on screen changed: the rail, Settings. */
const themeListeners = new Set<(theme: 'light' | 'dark') => void>()
function showTheme(theme: 'light' | 'dark'): void {
  currentTheme = theme
  applyTheme(theme)
}
function announceTheme(theme: 'light' | 'dark'): void {
  showTheme(theme)
  for (const l of [...themeListeners]) l(theme)
}
// The system changed its theme while the choice is "follow the system".
ipcRenderer.on('theme:changed', (_e, theme: 'light' | 'dark') => announceTheme(theme === 'dark' ? 'dark' : 'light'))

function applyTheme(theme: 'light' | 'dark'): void {
  const root = document.documentElement
  // The export selects on a .dark class. colorScheme keeps native
  // widgets (scrollbars, form controls) in step with the palette.
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
}

/**
 * Mark the platform on <html>, for the same reason and at the same time
 * as the theme.
 *
 * macOS draws its traffic lights inside the app's own top row, so that
 * row needs to reserve space for them and the app's caption buttons must
 * not be drawn at all. Both are first-paint decisions: asking main over
 * IPC would render one frame of the wrong chrome, and on the window's
 * own title bar that is very visible.
 *
 * A class rather than a media query because there is nothing to query:
 * the platform is not a property of the page.
 */
function applyPlatform(): void {
  const root = document.documentElement
  root.classList.add(`platform-${process.platform}`)

  // The room macOS's traffic lights need above the app's own rows.
  // Main computes it from where it placed them, so the two cannot
  // disagree; the renderer never repeats the arithmetic.
  //
  // Applied here rather than hardcoded in CSS for the same reason the
  // theme is: it has to be true before the first frame, and the top row
  // is the most visible place to get one frame wrong.
  const band = process.argv.find(a => a.startsWith('--cernix-titlebar-band='))
  if (band) root.style.setProperty('--titlebar-inset', `${band.split('=')[1]}px`)
}

function applyChrome(): void {
  applyTheme(currentTheme)
  applyPlatform()
}

if (document.documentElement) applyChrome()
else document.addEventListener('DOMContentLoaded', applyChrome, { once: true })


// The exposed API below IS the whitelist: the renderer only reaches channels
// through the named methods we wrap here. A raw `ipcRenderer` is never
// exposed to the renderer via contextBridge, so arbitrary channels are
// unreachable regardless of what strings are passed.

import type { IpcRendererEvent } from 'electron'
import type { EditParams } from '../shared/edit-params'
import {
  LogEntry,
  VolumeInfo,
  SweepProgress,
  SweepSession,
  UploadSessionSummary,
  UploadProgress,
  ScannedFile,
  AuthStatus,
  ProgressState,
  EditorCacheProgress,
  DriveFile,
  DriveFolder,
  FileRating,
  Preset,
  UpdateStatus,
  ArchivePick,
  ArchiveMoveReply,
  ArchiveProgress
} from '../shared/ipc-types'

contextBridge.exposeInMainWorld('electronAPI', {
  // Dialog
  openFolderDialog: () => ipcRenderer.invoke('dialog:open-folder') as Promise<string | null>,
  openImageDialog: () =>
    ipcRenderer.invoke('dialog:open-image') as Promise<{ path: string; name: string; modifiedTime: string } | null>,

  // Volume & Storage
  volumeList: () => ipcRenderer.invoke('volume:list') as Promise<VolumeInfo[]>,
  onVolumeDetected: (cb: (vol: VolumeInfo) => void) => {
    const l = (_: IpcRendererEvent, v: VolumeInfo) => cb(v)
    ipcRenderer.on('volume:detected', l)
    return () => ipcRenderer.removeListener('volume:detected', l)
  },
  onVolumeRemoved: (cb: (vol: VolumeInfo) => void) => {
    const l = (_: IpcRendererEvent, v: VolumeInfo) => cb(v)
    ipcRenderer.on('volume:removed', l)
    return () => ipcRenderer.removeListener('volume:removed', l)
  },

  // Ingest & Sweeping
  sweepScan: (path: string) => ipcRenderer.invoke('sweep:scan', path) as Promise<ScannedFile[]>,
  sweepStart: (path: string, selected: string[], customFolder?: string) => ipcRenderer.invoke('sweep:start', path, selected, customFolder),
  sweepCancel: () => ipcRenderer.invoke('sweep:cancel') as Promise<{ cancelled: number }>,
  mediaReveal: (path: string) => ipcRenderer.invoke('media:reveal', path) as Promise<void>,
  mediaTrash: (paths: string[]) =>
    ipcRenderer.invoke('media:trash', paths) as Promise<{ trashedPaths: string[]; failures: string[] }>,
  onSweepProgress: (cb: (p: SweepProgress) => void) => {
    const l = (_: IpcRendererEvent, v: SweepProgress) => cb(v)
    ipcRenderer.on('sweep:progress', l)
    return () => ipcRenderer.removeListener('sweep:progress', l)
  },
  onSweepComplete: (cb: (s: SweepSession) => void) => {
    const l = (_: IpcRendererEvent, v: SweepSession) => cb(v)
    ipcRenderer.on('sweep:complete', l)
    return () => ipcRenderer.removeListener('sweep:complete', l)
  },
  // Emitters use `error` for the human-readable string (see
  // FileSweeper's `sweep:error` payload and index.ts's no-auth-token
  // branch). `message` is accepted too so a payload from either shape
  // still reaches the UI instead of rendering as `undefined`.
  onSweepError: (cb: (e: { error?: string; message?: string; sessionId?: string; file?: string; kind?: 'drive-disconnected' }) => void) => {
    const l = (_: IpcRendererEvent, v: { error?: string; message?: string; sessionId?: string; file?: string }) => cb(v)
    ipcRenderer.on('sweep:error', l)
    return () => ipcRenderer.removeListener('sweep:error', l)
  },

  onAuthStatus: (cb: (s: AuthStatus) => void) => {
    const l = (_: IpcRendererEvent, v: AuthStatus) => cb(v)
    ipcRenderer.on('auth:status', l)
    return () => ipcRenderer.removeListener('auth:status', l)
  },
  /**
   * Auth failures. Main has always forwarded `auth:error` (index.ts),
   * but nothing bridged it to the renderer, so a `connect()` that
   * bailed early (e.g. missing OAuth credentials) was a completely
   * silent no-op on the Account button.
   */
  onAuthError: (cb: (e: { message: string }) => void) => {
    const l = (_: IpcRendererEvent, v: { message: string }) => cb(v)
    ipcRenderer.on('auth:error', l)
    return () => ipcRenderer.removeListener('auth:error', l)
  },
  onUploadStarted: (cb: (s: UploadSessionSummary) => void) => {
    const l = (_: IpcRendererEvent, v: UploadSessionSummary) => cb(v)
    ipcRenderer.on('upload:started', l)
    return () => ipcRenderer.removeListener('upload:started', l)
  },
  onUploadError: (cb: (e: { file: string; error: string }) => void) => {
    const l = (_: IpcRendererEvent, v: { file: string; error: string }) => cb(v)
    ipcRenderer.on('upload:error', l)
    return () => ipcRenderer.removeListener('upload:error', l)
  },
  onUploadComplete: (cb: (s: UploadSessionSummary) => void) => {
    const l = (_: IpcRendererEvent, v: UploadSessionSummary) => cb(v)
    ipcRenderer.on('upload:complete', l)
    return () => ipcRenderer.removeListener('upload:complete', l)
  },
  onUploadProgress: (cb: (p: UploadProgress) => void) => {
    const l = (_: IpcRendererEvent, v: UploadProgress) => cb(v)
    ipcRenderer.on('upload:progress', l)
    return () => ipcRenderer.removeListener('upload:progress', l)
  },

  // Auth & Identity
  authConnect: () => ipcRenderer.invoke('auth:connect'),
  authStatus: () => ipcRenderer.invoke('auth:status') as Promise<AuthStatus>,
  authDisconnect: () => ipcRenderer.invoke('auth:disconnect') as Promise<void>,
  authRebuildLedger: () => ipcRenderer.invoke('auth:rebuild-ledger') as Promise<{ count: number }>,
  /** Open the support page in the system browser. */
  supportOpen: () => ipcRenderer.invoke('support:open') as Promise<{ ok: true }>,
  systemVersion: () => ipcRenderer.invoke('system:version') as Promise<string>,
  /** Where the copied photographs are kept. */
  archiveInfo: () => ipcRenderer.invoke('archive:info') as Promise<{ path: string }>,
  archivePickDestination: () => ipcRenderer.invoke('archive:pick-destination') as Promise<ArchivePick>,
  archiveMove: () => ipcRenderer.invoke('archive:move') as Promise<ArchiveMoveReply>,
  archiveMoveCancel: () => ipcRenderer.invoke('archive:move-cancel') as Promise<void>,
  onArchiveProgress: (cb: (p: ArchiveProgress) => void) => {
    const l = (_: IpcRendererEvent, v: ArchiveProgress) => cb(v)
    ipcRenderer.on('archive:progress', l)
    return () => ipcRenderer.removeListener('archive:progress', l)
  },
  archiveOpen: () => ipcRenderer.invoke('archive:open') as Promise<{ ok: true } | { ok: false; reason: string }>,

  // Caption buttons. The window has no OS title bar, so the top row's
  // three controls are the renderer's to draw and these are what they
  // call. See components/WindowControls.
  windowMinimize: () => ipcRenderer.invoke('window:minimize') as Promise<{ ok: true }>,
  windowToggleMaximize: () =>
    ipcRenderer.invoke('window:toggle-maximize') as Promise<{ maximized: boolean }>,
  windowClose: () => ipcRenderer.invoke('window:close') as Promise<{ ok: true }>,
  windowIsMaximized: () =>
    ipcRenderer.invoke('window:is-maximized') as Promise<{ maximized: boolean }>,
  onWindowMaximized: (cb: (maximized: boolean) => void) => {
    const l = (_: IpcRendererEvent, v: boolean) => cb(v)
    ipcRenderer.on('window:maximized', l)
    return () => ipcRenderer.removeListener('window:maximized', l)
  },

  /** The theme on screen. */
  themeGet: () => currentTheme,
  /**
   * Switch theme. Applies immediately, then persists. The class swap
   * is what the user sees, and it should not wait on a disk write.
   */
  themeSet: async (theme: 'light' | 'dark' | 'system') => {
    // An explicit choice is painted before the round trip, so the switch is
    // instant. "System" has to ask main what the system is. Listeners hear
    // of it only once the choice is stored, so one that reads it back gets
    // the new one and not the one it replaced.
    if (theme !== 'system') showTheme(theme)
    const r = await ipcRenderer.invoke('theme:set', theme) as { ok: true; effective: 'light' | 'dark' }
    announceTheme(r.effective)
    return { ok: true as const }
  },
  /** The choice itself, which differs from the theme on screen when it is "system". */
  themePreference: () => ipcRenderer.invoke('theme:preference') as Promise<'light' | 'dark' | 'system'>,
  onThemeChanged: (cb: (theme: 'light' | 'dark') => void) => {
    themeListeners.add(cb)
    return () => { themeListeners.delete(cb) }
  },

  // AI & Assistant
  driveSetPublic: (folderId: string) => ipcRenderer.invoke('drive:set-public', folderId),

  // Drive Organizer
  driveGetRootId: () => ipcRenderer.invoke('drive:get-root-id') as Promise<string>,
  driveListContents: (folderId: string) => ipcRenderer.invoke('drive:list-contents', folderId) as Promise<{ files: DriveFile[]; folders: DriveFolder[] }>,
  driveRenameFile: (fileId: string, newName: string) => ipcRenderer.invoke('drive:rename-file', fileId, newName),
  driveCreateFolder: (parentId: string, name: string) => ipcRenderer.invoke('drive:create-folder', parentId, name),
  driveGetThumbnail: (url: string) => ipcRenderer.invoke('drive:get-thumbnail', url) as Promise<string>,
  driveOrganizeByDate: (folderId: string) =>
    ipcRenderer.invoke('drive:organize-by-date', folderId) as
      Promise<{ summary: string; movedCount: number; foldersCreated: number }>,
  driveRemoveEmptyFolders: (folderId: string) =>
    ipcRenderer.invoke('drive:remove-empty-folders', folderId) as
      Promise<{ summary: string; removedCount: number }>,
  driveTrashBatch: (fileIds: string[]) => ipcRenderer.invoke('drive:trash-batch', fileIds) as Promise<ProgressState>,
  driveUntrashBatch: (fileIds: string[]) =>
    ipcRenderer.invoke('drive:untrash-batch', fileIds) as Promise<{ done: number; failed: number; total: number }>,
  driveMoveBatch: (ids: string[], targetId: string, sourceParentId: string) =>
    ipcRenderer.invoke('drive:move-batch', ids, targetId, sourceParentId) as Promise<{ done: number; failed: number; total: number }>,
  driveDownloadBatch: (files: { id: string; name: string }[]) => ipcRenderer.invoke('drive:download-batch', files) as Promise<ProgressState & { dir: string }>,
  onDownloadProgress: (cb: (p: ProgressState) => void) => {
    const l = (_: IpcRendererEvent, v: ProgressState) => cb(v)
    ipcRenderer.on('download:progress', l)
    return () => ipcRenderer.removeListener('download:progress', l)
  },
  onTrashProgress: (cb: (p: ProgressState) => void) => {
    const l = (_: IpcRendererEvent, v: ProgressState) => cb(v)
    ipcRenderer.on('trash:progress', l)
    return () => ipcRenderer.removeListener('trash:progress', l)
  },
  driveCancelOrganize: () => ipcRenderer.invoke('drive:cancel-organize'),
  driveStageForEditing: (files: { id: string; name: string }[]) => ipcRenderer.invoke('drive:stage-for-editing', files) as Promise<ProgressState & { dir: string }>,



  // Rating Store
  ratingGetAll: () => ipcRenderer.invoke('rating:get-all') as Promise<FileRating[]>,
  ratingSetStars: (fileId: string, stars: number | null) => ipcRenderer.invoke('rating:set-stars', fileId, stars),
  ratingSetFlag: (fileId: string, flag: 'pick' | null) => ipcRenderer.invoke('rating:set-flag', fileId, flag),

  // Editor source cache
  editorPrepareSource: (fileId: string, modifiedTime: string, fileName: string) =>
    ipcRenderer.invoke('editor:prepare-source', fileId, modifiedTime, fileName) as Promise<string>,
  onEditorCacheProgress: (cb: (p: EditorCacheProgress) => void) => {
    const l = (_: IpcRendererEvent, v: EditorCacheProgress) => cb(v)
    ipcRenderer.on('editor:cache-progress', l)
    return () => ipcRenderer.removeListener('editor:cache-progress', l)
  },

  // Editor params persistence
  editorReadParams: (sourcePath: string) =>
    ipcRenderer.invoke('editor:read-params', sourcePath) as Promise<EditParams | null>,
  editorWriteParams: (sourcePath: string, params: EditParams) => ipcRenderer.invoke('editor:write-params', sourcePath, params),

  editorUploadExport: (sourceFileId: string, bytes: ArrayBuffer, outputName: string, sourceCachePath: string | null, subpath: string[] | null, keepLocation: boolean) =>
    ipcRenderer.invoke('editor:upload-export', sourceFileId, bytes, outputName, sourceCachePath, subpath, keepLocation) as Promise<{ id: string; webViewLink?: string; name: string; mirrorPath: string[]; warning?: string }>,

  editorSaveExportLocal: (bytes: ArrayBuffer, outputName: string, sourceCachePath: string | null, keepLocation: boolean) =>
    ipcRenderer.invoke('editor:save-export-local', bytes, outputName, sourceCachePath, keepLocation) as Promise<{ saved: false } | { saved: true; path: string; warning?: string }>,

  // Presets
  presetList: () => ipcRenderer.invoke('preset:list') as Promise<Preset[]>,
  presetSave: (name: string, params: EditParams) => ipcRenderer.invoke('preset:save', name, params) as Promise<Preset>,
  presetDelete: (id: string) => ipcRenderer.invoke('preset:delete', id),
  presetRename: (id: string, name: string) => ipcRenderer.invoke('preset:rename', id, name) as Promise<Preset | null>,

  // Preset thumbnail cache
  presetThumbGet: (sourceHash: string, presetId: string, presetUpdatedAt: string) =>
    ipcRenderer.invoke('preset-thumb:get', sourceHash, presetId, presetUpdatedAt) as Promise<Uint8Array | null>,
  presetThumbPut: (sourceHash: string, presetId: string, presetUpdatedAt: string, bytes: Uint8Array) =>
    ipcRenderer.invoke('preset-thumb:put', sourceHash, presetId, presetUpdatedAt, bytes) as Promise<void>,

  /**
   * Which OS this is running on.
   *
   * A value rather than an invoke, because the only caller decides what
   * to draw during its first render and a promise would arrive a frame
   * too late. Read from `process.platform` in the preload, which is the
   * real thing rather than a user-agent guess.
   */
  platform: process.platform as NodeJS.Platform,

  // Updates. See services/updater.ts for what is asked of whom.
  updateStatus: () => ipcRenderer.invoke('update:status') as Promise<UpdateStatus>,
  updateSetEnabled: (enabled: boolean) => ipcRenderer.invoke('update:set-enabled', enabled) as Promise<UpdateStatus>,
  updateCheck: () => ipcRenderer.invoke('update:check') as Promise<UpdateStatus>,
  updateInstall: () =>
    ipcRenderer.invoke('update:install') as Promise<{ ok: true } | { ok: false; reason: string }>,
  updateOpenRelease: () => ipcRenderer.invoke('update:open-release') as Promise<{ ok: true }>,
  onUpdateStatus: (cb: (s: UpdateStatus) => void) => {
    const l = (_: IpcRendererEvent, v: UpdateStatus) => cb(v)
    ipcRenderer.on('update:status', l)
    return () => ipcRenderer.removeListener('update:status', l)
  },

  // System Log
  onSysLog: (cb: (entry: LogEntry) => void) => {
    const l = (_: IpcRendererEvent, v: LogEntry) => cb(v)
    ipcRenderer.on('sys:log', l)
    return () => ipcRenderer.removeListener('sys:log', l)
  },
  /** A crash the error screen caught, for main's fatal-error log. */
  reportError: (detail: string) => ipcRenderer.send('renderer:error', String(detail)),
})

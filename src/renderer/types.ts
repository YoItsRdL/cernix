// Renderer-side types. Anything that crosses IPC is imported from
// shared/ipc-types rather than described again here: this file used to
// declare its own ScannedFile and its own callback payloads, and two of
// them did not match what main sends.

export type IngestState = 'idle' | 'scanning' | 'review' | 'sweeping' | 'complete' | 'error'
export type TabId = 'library-ingest' | 'organize' | 'settings' | 'local'


import type { EditParams } from '@/../shared/edit-params'
import type {
  ScannedFile, SweepProgress, SweepSession, UploadSessionSummary, UploadProgress,
  RatingRecord, RatingFlag, RatingStars,
} from '@/../shared/ipc-types'
export type {
  ScannedFile, SweepProgress, SweepSession, UploadSessionSummary, UploadProgress,
  RatingRecord, RatingFlag, RatingStars,
}
export type {
  CurvePoint, CurveChannel, ToneCurve,
  HslRange, HslBand, HslAdjustments,
  SelectiveColorRange, SelectiveColorBand, SelectiveColor,
  BlackAndWhite, CropRect, Orientation,
  Mask, MaskAdjustments, MaskType,
  BrushMask, BrushStroke, BrushStrokePoint,
  HealSpot, HealMode,
  LinearMask, RadialMask,
  EditParams, LightLeakParams, LightLeakPreset,
} from '@/../shared/edit-params'

export interface Preset {
  id: string
  name: string
  params: EditParams
  createdAt: number
  builtin?: boolean
}

export interface VolumeInfo {
  path: string
  label: string
  sizeBytes: number
  freeBytes: number
  fileSystem: string
}

export interface AuthStatus {
  connected: boolean
  email: string | null
  avatar: string | null
  expiresAt: number | null
}

export interface ElectronAPI {
  // Dialog
  openFolderDialog: () => Promise<string | null>
  openImageDialog: () => Promise<{ path: string; name: string; modifiedTime: string } | null>

  // Volume & Storage
  volumeList: () => Promise<VolumeInfo[]>
  onVolumeDetected: (cb: (vol: VolumeInfo) => void) => () => void
  onVolumeRemoved: (cb: (vol: VolumeInfo) => void) => () => void

  // Ingest & Sweeping
  sweepScan: (path: string) => Promise<ScannedFile[]>
  sweepStart: (path: string, selected: string[], customFolder?: string) => Promise<void>
  /** Abort the in-flight sweep. Resolves with how many sessions were cancelled. */
  sweepCancel: () => Promise<{ cancelled: number }>
  mediaTrash: (paths: string[]) => Promise<{ trashedPaths: string[]; failures: string[] }>
  onSweepProgress: (cb: (p: SweepProgress) => void) => () => void
  onSweepComplete: (cb: (s: SweepSession) => void) => () => void
  onSweepError: (cb: (e: { error?: string; message?: string; sessionId?: string; file?: string }) => void) => () => void
  onUploadStarted: (cb: (s: UploadSessionSummary) => void) => () => void
  onUploadProgress: (cb: (p: UploadProgress) => void) => () => void
  onUploadComplete: (cb: (s: UploadSessionSummary) => void) => () => void

  // Auth & Identity
  authConnect: () => Promise<void>
  authStatus: () => Promise<AuthStatus>
  authRebuildLedger: () => Promise<{ count: number }>
  /** Open the support page in the system browser. */
  supportOpen: () => Promise<{ ok: true }>
  /** The running app version, as stamped into the build from package.json. */
  systemVersion: () => Promise<string>
  /** Theme this window started with. Synchronous: no round trip. */
  /** Minimise the window. */
  windowMinimize: () => Promise<{ ok: true }>
  /** Maximise or restore, whichever the window is not. */
  windowToggleMaximize: () => Promise<{ maximized: boolean }>
  /** Close the window. */
  windowClose: () => Promise<{ ok: true }>
  /** Maximised state at mount, for the button that has to show one of two glyphs. */
  /** The host OS, so the caption row can match it. Set at preload, not awaited. */
  platform: NodeJS.Platform
  windowIsMaximized: () => Promise<{ maximized: boolean }>
  /** Maximised state after any change, including ones the app did not make. */
  onWindowMaximized: (cb: (maximized: boolean) => void) => () => void

  themeGet: () => 'light' | 'dark'
  /** Switch theme: applies immediately, persists locally. */
  themeSet: (theme: 'light' | 'dark') => Promise<{ ok: true }>
  onAuthStatus: (cb: (s: AuthStatus) => void) => () => void
  /** Auth failures (bad/missing OAuth credentials, expired session). */
  onAuthError: (cb: (e: { message: string }) => void) => () => void

  // Drive & Sharing
  driveSetPublic: (folderId: string) => Promise<void>

  // Drive Organizer
  driveGetRootId: () => Promise<string>
  driveListContents: (folderId: string) => Promise<{
    files: { id: string; name: string; mimeType: string; size: string; createdTime: string; thumbnailLink?: string; webViewLink?: string }[]
    folders: { id: string; name: string; createdTime: string }[]
  }>
  driveRenameFile: (fileId: string, newName: string) => Promise<void>
  driveCreateFolder: (parentId: string, name: string) => Promise<string>
  driveGetThumbnail: (url: string) => Promise<string | null>
  driveOrganizeByDate: (folderId: string) => Promise<{ summary: string; movedCount: number; foldersCreated: number }>
  driveRemoveEmptyFolders: (folderId: string) => Promise<{ summary: string; removedCount: number }>
  driveTrashBatch: (fileIds: string[]) => Promise<{ done: number; failed: number; total: number }>
  /** Restore trashed items. Inverse of driveTrashBatch. */
  driveUntrashBatch: (fileIds: string[]) => Promise<{ done: number; failed: number; total: number }>
  /** Move items into another folder. Drive swaps parents, so the source folder is required. */
  driveMoveBatch: (ids: string[], targetId: string, sourceParentId: string) => Promise<{ done: number; failed: number; total: number }>
  onTrashProgress: (cb: (p: { done: number; total: number; failed: number }) => void) => () => void
  driveDownloadBatch: (files: { id: string; name: string }[]) => Promise<{ saved: number; failed?: number; total?: number; dir?: string }>
  onDownloadProgress: (cb: (p: { done: number; total: number; failed: number }) => void) => () => void
  driveCancelOrganize: () => Promise<void>
  driveStageForEditing: (files: { id: string; name: string }[]) => Promise<{ saved: number; failed?: number; total?: number; dir?: string }>

  // Rating Store
  ratingGetAll: () => Promise<RatingRecord[]>
  ratingSetStars: (fileId: string, stars: number | null) => Promise<void>
  ratingSetFlag: (fileId: string, flag: 'pick' | null) => Promise<void>
  ratingSetUserPick: (fileId: string, picked: boolean) => Promise<void>

  // Editor source cache
  editorPrepareSource: (fileId: string, modifiedTime: string, fileName: string) => Promise<string>
  onEditorCacheProgress: (cb: (p: { fileId: string; done: number; total: number }) => void) => () => void

  // Editor params persistence
  editorReadParams: (sourcePath: string) => Promise<EditParams>
  editorWriteParams: (sourcePath: string, params: EditParams) => Promise<void>

  editorUploadExport: (sourceFileId: string, bytes: ArrayBuffer, outputName: string, sourceCachePath: string | null, subpath: string[] | null) => Promise<{ id: string; webViewLink?: string; name: string; mirrorPath: string[]; warning?: string }>
  editorSaveExportLocal: (bytes: ArrayBuffer, outputName: string, sourceCachePath: string | null) => Promise<{ saved: false } | { saved: true; path: string; warning?: string }>

  // Presets
  presetList: () => Promise<Preset[]>
  presetSave: (name: string, params: EditParams) => Promise<Preset>
  presetDelete: (id: string) => Promise<void>
  presetRename: (id: string, name: string) => Promise<Preset | null>

  // Preset thumbnail cache
  presetThumbGet: (sourceHash: string, presetId: string, presetUpdatedAt: string) => Promise<Uint8Array | null>
  presetThumbPut: (sourceHash: string, presetId: string, presetUpdatedAt: string, bytes: Uint8Array) => Promise<void>

  // System Log (Terminal Panel)
  onSysLog: (cb: (entry: { level: string; source: string; message: string }) => void) => () => void

}

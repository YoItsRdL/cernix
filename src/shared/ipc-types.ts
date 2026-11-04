import type { EditParams } from './edit-params'

/**
 * Every payload that crosses IPC, declared once.
 *
 * The main standard is that the handler, the bridge in preload and the
 * renderer's type all agree. They can only agree if there is one
 * declaration to agree with: `sweep:progress` was written out three
 * different ways here, in preload and in renderer/types, and no two
 * matched what the sweeper actually emits.
 */

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  level: LogLevel;
  source: string;
  message: string;
}

export interface VolumeInfo {
  path: string;
  name: string;
  isRemovable: boolean;
}

/**
 * What a copy reports while it runs. This said `{ done, total,
 * currentFile }` and the sweeper has never emitted that: the renderer
 * read `percentComplete` off an `any` and the declaration was never
 * consulted by anything.
 */
export interface SweepProgress {
  sessionId: string;
  file: string;
  current: number;
  total: number;
  bytesPerSecond: number;
  percentComplete: number;
}

export interface SweepError {
  file: string;
  error: string;
  /** Set when the copy itself worked and only the upload could not start. */
  kind?: 'drive-disconnected';
}

/** A copy session, start to finish. Emitted on `sweep:complete`. */
export interface SweepSession {
  sessionId: string;
  sourcePath: string;
  stagingPath: string;
  startedAt: Date;
  totalFiles: number;
  processedFiles: number;
  totalBytes: number;
  processedBytes: number;
  status: 'scanning' | 'copying' | 'complete' | 'error' | 'cancelled';
  errors: SweepError[];
  customFolder?: string;
  /** Relative to stagingPath. */
  addedFiles: string[];
}

/** One file's upload progress. */
export interface UploadProgress {
  jobId: string;
  file: string;
  percent: number;
  bytesUploaded: number;
  totalBytes: number;
}

/** An upload session, start to finish. Emitted on `upload:started` and
 *  again on `upload:complete`. */
export interface UploadSessionSummary {
  sessionId: string;
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  totalBytes: number;
  uploadedBytes: number;
  /**
   * `partial` exists because `complete` was being reported for sessions
   * that had lost files. The renderer takes the word at face value,
   * shows 100%, and the user formats the card, so a session that could
   * not upload everything must not be able to say the same word as one
   * that did.
   */
  status: 'idle' | 'uploading' | 'complete' | 'partial' | 'paused';
  driveFolderId: string | null;
  driveFolderUrl: string | null;
}

export interface FileEntry {
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
  mtime: Date;
  /** EXIF capture date: the day the photograph was taken. */
  captureDate?: Date;
}

/** A file the scan found, and whether the ledger has already seen it.
 *  Declared here rather than twice: the sweeper's copy said `Date` and
 *  the renderer's said `string | Date`, for the same payload. */
export type FileDamage = 'empty' | 'unreadable';

export interface ScannedFile extends FileEntry {
  isUploaded: boolean;
  /** Empty, or its opening bytes are not those of its format. */
  damage?: FileDamage;
  /** Already in the local archive (by name and size), though not on Drive. */
  isCopied?: boolean;
  width?: number;
  height?: number;
  megapixels?: number;
  iso?: number;
  camera?: string;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  modifiedTime?: string;
  thumbnailLink?: string;
}

export interface DriveFolder {
  id: string;
  name: string;
}

/** One rating: stars plus an optional pick. Declared here because
 *  `rating:get-all` carries it across, and it used to be written out
 *  twice. Once main-side, once renderer-side. */
export type RatingFlag = 'pick' | null;
export type RatingStars = 0 | 1 | 2 | 3 | 4 | 5;

export interface RatingRecord {
  fileId: string;
  userStars: RatingStars | null;
  flag: RatingFlag;
  updatedAt: number;
}

export interface FileRating {
  fileId: string;
  stars: number | null;
  flag: 'pick' | null;
  aiReason?: string;
  userPick?: boolean;
}

export interface AuthStatus {
  authenticated: boolean;
  userEmail?: string;
  lastSyncAt?: number;
}

export interface ProgressState {
  done: number;
  total: number;
  failed?: number;
}

export interface EditorCacheProgress {
  fileId: string;
  done: number;
  total: number;
}

export interface Preset {
  id: string;
  name: string;
  params: EditParams;
  createdAt: number;
}


/**
 * Where the updater is, as the renderer shows it.
 *
 * `available` on macOS means "a newer version is out; download it from
 * the release page": an ad-hoc signed app cannot be replaced in place
 * (Squirrel.Mac requires a Developer ID), so the Mac build never
 * downloads. On Windows and Linux `available` is followed by
 * `downloading` and then `ready`, at which point a restart installs it.
 */
export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'current'; version: string }
  | { kind: 'available'; version: string; releaseUrl: string }
  | { kind: 'downloading'; version: string; percent: number }
  | { kind: 'ready'; version: string }
  | { kind: 'error'; message: string };

export interface UpdateStatus {
  /** The user's choice in Settings. Off means no request is ever made. */
  enabled: boolean;
  /** False in a dev build, which has nothing to update. */
  supported: boolean;
  /** Whether this platform installs in place, or only announces. */
  installsInPlace: boolean;
  state: UpdateState;
}

// ── Moving the Local Archive (decision 20) ──

/** What picking a new place for the archive came to. */
export type ArchivePick =
  | { cancelled: true }
  | { error: string }
  | { destination: string; from: string; files: number; bytes: number };

export type ArchiveMoveReply =
  | { error: string }
  | { ok: true; path: string; files: number; bytes: number; leftovers: string[] };

export interface ArchiveProgress {
  phase: 'counting' | 'copying' | 'checking' | 'removing';
  done: number;
  total: number;
}

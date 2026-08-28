import Database from 'better-sqlite3'
import { uploadKey } from './upload-key'

/** The Drive upload ledger: what this machine has already sent, keyed
 *  by name and size. */
export class SyncDatabase {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    
    // Initialize schema
    this.initSchema()
    this.dropRetiredTables()

    console.log(`[SyncDatabase] Initialized at: ${dbPath}`)
  }

  /**
   * Drop the tables the AI removal left behind.
   *
   * ai_rules, ai_sessions and ai_settings backed features deleted before
   * the open-source launch. Their own schema comment called them
   * vestigial and flagged them for a sweep that never came, so they have
   * been carried in every database since. Holding, in ai_settings' case,
   * a plaintext API key row that a later ticket had already migrated to
   * the OS keychain.
   *
   * Dropped rather than ignored: a table nothing can write is a
   * description of a feature that does not exist, and this one still
   * held a secret.
   */
  private dropRetiredTables(): void {
    const retired = ['ai_rules', 'ai_sessions', 'ai_settings']
    const present = retired.filter(t =>
      this.db.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get('table', t))
    if (!present.length) return
    this.db.transaction(() => {
      for (const t of present) this.db.exec(`DROP TABLE IF EXISTS ${t}`)
    })()
    console.log(`[SyncDatabase] dropped retired table(s): ${present.join(', ')}`)
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_name TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        drive_file_id TEXT,
        uploaded_at INTEGER NOT NULL,
        UNIQUE(file_name, size_bytes)
      );
      
      -- Small key/value store for state that outlives a session; the
      -- ledger reconcile timestamp lives here.
      CREATE TABLE IF NOT EXISTS app_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_file_lookup ON sync_records (file_name, size_bytes);
    `)
  }

  /**
   * Record a successful upload to the local ledger.
   */
  recordUpload(fileName: string, sizeBytes: number, driveFileId: string | null = null): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO sync_records (file_name, size_bytes, drive_file_id, uploaded_at)
      VALUES (?, ?, ?, ?)
    `)
    
    stmt.run(fileName, sizeBytes, driveFileId, Date.now())
  }

  /**
   * Every uploaded file, keyed for lookup by a scan.
   *
   * The ledger holds two shapes, because two things write to it: a
   * finished upload records the path relative to its source, which on
   * Windows is "2026\August\21\P1100463.JPG", while reconciling against
   * Drive records the bare name Drive reports. Any check has to cope
   * with both, and the previous one did not: it matched a path ending
   * in "/name" while every record written on Windows ends in "\name",
   * so nothing ever matched and every file on the card looked new.
   *
   * Reducing both sides to a basename here, in JS, sidesteps the
   * separator question rather than encoding one platform's answer into
   * a LIKE pattern. It also turns a full table scan per scanned file
   * into a single query and a set lookup.
   */
  getUploadedKeys(): Set<string> {
    const rows = this.db
      .prepare('SELECT file_name, size_bytes FROM sync_records')
      .all() as { file_name: string; size_bytes: number }[]

    const keys = new Set<string>()
    for (const row of rows) {
      if (!row.file_name) continue
      keys.add(uploadKey(row.file_name, row.size_bytes))
    }
    return keys
  }

  /** Count total sync records */
  getSyncRecordCount(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM sync_records')
    return (stmt.get() as { count: number }).count
  }

  /**
   * Swap the whole ledger for a freshly gathered one, atomically.
   *
   * Reconciling used to clear the table and then insert page by page as
   * Drive returned them. A network failure halfway through left the
   * ledger holding whatever had arrived so far, and the app treats a
   * missing record as "never uploaded", so an interrupted rebuild
   * would quietly offer to re-upload thousands of files that were
   * already safe in Drive.
   *
   * Collecting first and swapping inside one transaction means the
   * ledger is either the old one or the new one. There is no moment
   * where it is neither.
   */
  replaceSyncRecords(records: { fileName: string; sizeBytes: number; driveFileId: string | null }[]): void {
    const wipe = this.db.prepare('DELETE FROM sync_records')
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO sync_records (file_name, size_bytes, drive_file_id, uploaded_at)
      VALUES (?, ?, ?, ?)
    `)
    const now = Date.now()

    const swap = this.db.transaction((rows: typeof records) => {
      wipe.run()
      for (const r of rows) insert.run(r.fileName, r.sizeBytes, r.driveFileId, now)
    })
    swap(records)
  }

  /** Small key/value store for app-level state that outlives a session. */
  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  setMeta(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO app_meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value)
  }

  close(): void {
    this.db.close()
  }
}

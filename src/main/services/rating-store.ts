import Database from 'better-sqlite3'

/** One row of `ratings`, as better-sqlite3 hands it back. */
interface RatingRow {
  file_id: string
  user_stars: number | null
  flag: string | null
  updated_at: number
}


/**
 * Reject is gone. It belonged to a culling pass that no longer exists.
 * Mark the bad ones, let something else act on the marks, and without
 * that, a flag saying "this is bad" that leaves the file exactly where
 * it was is a note to nobody. The control it lived on trashes now,
 * which is what the mark was standing in for.
 *
 * Gone from the schema too, not just from the type: see
 * dropRejectFlag(). A column still admitting a value nothing can write
 * is a description of a feature that does not exist.
 */
import type { RatingRecord, RatingFlag, RatingStars } from '../../shared/ipc-types'

export type Flag = RatingFlag
export type Stars = RatingStars
export type { RatingRecord }

/**
 * Rating store. One rating per file. Stars plus an optional pick.
 * Legacy snapshot API is preserved as a derived view.
 */
export class RatingStore {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.initSchema()
    this.migrateLegacyPicks()
    this.dropRejectFlag()
    this.dropRetiredTables()
    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN user_stars IS NOT NULL OR flag IS NOT NULL THEN 1 END) as withUser
      FROM ratings
    `).get() as { total: number; withUser: number }
    console.log(`[RatingStore] ${dbPath}: ${stats.total} row(s), user/flag: ${stats.withUser}`)
  }

  /**
   * Rebuild the table without "reject".
   *
   * Nulling the values alone would have been enough to keep the app
   * working, and would have left the constraint still admitting a word
   * nothing writes. A schema describing a feature that no longer
   * exists, waiting to confuse whoever reads it next. SQLite cannot
   * alter a CHECK in place, so the table is rebuilt: the only honest
   * way to say the value is gone.
   *
   * Keyed off the stored schema rather than a version number, so it
   * runs exactly once and is a no-op on a database created after this.
   */
  private dropRejectFlag(): void {
    const existing = this.db
      .prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?')
      .get('table', 'ratings') as { sql: string } | undefined
    if (!existing || !existing.sql.includes('reject')) return

    const rebuild = this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE ratings_rebuilt (
          file_id     TEXT PRIMARY KEY,
          user_stars  INTEGER,
          flag        TEXT CHECK(flag IN ('pick') OR flag IS NULL),
          updated_at  INTEGER NOT NULL
        );
        INSERT INTO ratings_rebuilt (file_id, user_stars, flag, updated_at)
          SELECT file_id, user_stars,
                 CASE WHEN flag = 'pick' THEN 'pick' ELSE NULL END,
                 updated_at
          FROM ratings;
        DROP TABLE ratings;
        ALTER TABLE ratings_rebuilt RENAME TO ratings;
        CREATE INDEX IF NOT EXISTS idx_ratings_user_stars ON ratings(user_stars);
        CREATE INDEX IF NOT EXISTS idx_ratings_flag       ON ratings(flag);
      `)
    })

    rebuild()
    console.log('[RatingStore] rebuilt ratings without the reject flag')
  }

  /**
   * Drop rating_meta.
   *
   * It held one key. Is_ai_selection, recording whether a pick came
   * from the user or from a model. There is no model, and nothing ever
   * read the value back.
   */
  private dropRetiredTables(): void {
    const present = this.db
      .prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?')
      .get('table', 'rating_meta')
    if (!present) return
    this.db.exec('DROP TABLE IF EXISTS rating_meta')
    console.log('[RatingStore] dropped retired table: rating_meta')
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ratings (
        file_id     TEXT PRIMARY KEY,
        user_stars  INTEGER,
        flag        TEXT CHECK(flag IN ('pick') OR flag IS NULL),
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ratings_user_stars ON ratings(user_stars);
      CREATE INDEX IF NOT EXISTS idx_ratings_flag       ON ratings(flag);
    `)
  }

  /** One-way migration: promote any legacy 501 'picks' rows into the ratings table, then drop them. */
  private migrateLegacyPicks(): void {
    const legacyExists = this.db.prepare(
      'SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'picks\''
    ).get()
    if (!legacyExists) return

    const rows = this.db.prepare('SELECT file_id, source FROM picks').all() as { file_id: string; source: string }[]
    const now = Date.now()
    const up = this.db.prepare(`
      INSERT INTO ratings (file_id, user_stars, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(file_id) DO NOTHING
    `)
    const tx = this.db.transaction(() => {
      for (const r of rows) up.run(r.file_id, 4, now)
      this.db.exec('DROP TABLE picks; DROP TABLE IF EXISTS pick_meta;')
    })
    tx()
    console.log(`[RatingStore] Migrated ${rows.length} legacy picks → ratings.`)
  }

  // ── Writes ──

  setUserStars(fileId: string, stars: Stars | null): void {
    this.upsert(fileId, { user_stars: stars })
  }

  setFlag(fileId: string, flag: Flag): void {
    this.upsert(fileId, { flag })
  }

  // ── Reads ──

  getAllRatings(): RatingRecord[] {
    const rows = this.db.prepare('SELECT * FROM ratings').all() as RatingRow[]
    return rows.map(r => this.rowToRecord(r))
  }

  setUserPick(fileId: string, picked: boolean): void {
    this.setFlag(fileId, picked ? 'pick' : null)
  }

  // ── Internals ──

  private upsert(fileId: string, fields: Partial<{ user_stars: number | null; flag: Flag }>): void {
    const now = Date.now()
    const keys = Object.keys(fields)
    const cols = keys.join(', ')
    const vals = keys.map(k => (fields as Record<string, unknown>)[k])
    const placeholders = keys.map(() => '?').join(', ')
    const updateSet = keys.map(k => `${k} = excluded.${k}`).join(', ')
    this.db.prepare(`
      INSERT INTO ratings (file_id, ${cols}, updated_at) VALUES (?, ${placeholders}, ?)
      ON CONFLICT(file_id) DO UPDATE SET ${updateSet}, updated_at = excluded.updated_at
    `).run(fileId, ...vals, now)
  }

  private rowToRecord(row: RatingRow): RatingRecord {
    return {
      fileId: row.file_id,
      userStars: row.user_stars as Stars | null,
      flag: row.flag as Flag,
      updatedAt: row.updated_at,
    }
  }

}

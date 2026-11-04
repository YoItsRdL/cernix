import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'

/**
 * The retired AI tables held a plaintext API key. Dropping the table is
 * not enough: the bytes stay in the file's free pages until something
 * overwrites them. This checks the file itself, not the schema.
 */
const SECRET = 'sk-test-PLAINTEXT-API-KEY-0123456789'

describe('dropping the retired tables', () => {
  it('leaves no trace of a stored key in the database file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cernix-syncdb-'))
    const file = path.join(dir, 'cernix-v1.db')
    try {
      const seed = new Database(file)
      seed.pragma('journal_mode = WAL')
      seed.exec('CREATE TABLE ai_settings (key TEXT PRIMARY KEY, value TEXT)')
      seed.prepare('INSERT INTO ai_settings VALUES (?, ?)').run('api_key', SECRET)
      seed.close()
      expect(fs.readFileSync(file).includes(SECRET)).toBe(true)

      const { SyncDatabase } = await import('./sync-db')
      const db = new SyncDatabase(file)
      db.close()

      const left = [file, file + '-wal'].filter(f => fs.existsSync(f)).some(f => fs.readFileSync(f).includes(SECRET))
      expect(left).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

/**
 * The sqlite driver: one file on disk, zero native dependencies.
 *
 * `node:sqlite` ships with Node 22+, so this is the default store and the
 * fallback for hosts without a database service. The handle survives Next.js
 * dev-mode module reloads via the global registry, the standard pattern for
 * per-process singletons in the app router.
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { TTL_MS } from '../share'
import type { ShareRow, ShareStore } from '../store'

function open(): DatabaseSync {
  const file = process.env.SHARE_DB_PATH ?? path.join(process.cwd(), 'data', 'share.db')
  mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec(`
    CREATE TABLE IF NOT EXISTS share (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      summary TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `)
  return db
}

const registry = globalThis as unknown as { __shareDbSqlite?: DatabaseSync }

function handle(): DatabaseSync {
  if (!registry.__shareDbSqlite) registry.__shareDbSqlite = open()
  return registry.__shareDbSqlite
}

export function sqliteStore(): ShareStore {
  return {
    async insert(id, code, summary, now) {
      handle()
        .prepare('INSERT INTO share (id, code, summary, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, code, summary, now, now + TTL_MS)
    },

    async get(id) {
      return handle().prepare('SELECT id, code, summary, created_at, expires_at FROM share WHERE id = ?').get(id) as
        | ShareRow
        | undefined
    },

    async touch(id, now) {
      const expiresAt = now + TTL_MS
      try {
        handle()
          .prepare('UPDATE share SET expires_at = ? WHERE id = ? AND expires_at < ?')
          .run(expiresAt, id, expiresAt)
        return expiresAt
      } catch {
        return now
      }
    },
  }
}

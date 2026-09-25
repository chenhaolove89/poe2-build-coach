/**
 * The MySQL driver — the database this host already runs for the kids-english
 * server (统一接入): same server, same mysql2 library, one more database.
 *
 * The pool is created once per process (globalThis guard against dev-mode
 * reloads) and the table self-provisions on first use, so a fresh database
 * needs nothing but credentials:
 *
 *   SHARE_DB=mysql
 *   MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE
 *
 * Credentials live in an EnvironmentFile next to the data dir (0600, root), not
 * in the unit or the repo.
 */
import { createPool, type Pool, type RowDataPacket } from 'mysql2/promise'
import { TTL_MS } from '../share'
import type { ShareStore } from '../store'

const DDL = `
CREATE TABLE IF NOT EXISTS share (
  id VARCHAR(8) PRIMARY KEY,
  code MEDIUMTEXT NOT NULL,
  summary MEDIUMTEXT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  KEY idx_share_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`.trim()

const registry = globalThis as unknown as { __shareMysql?: Pool }

/** The raw row shape mysql2 returns — summary arrives as a string or null. */
interface Row extends RowDataPacket {
  id: string
  code: string
  summary: string | null
  created_at: number
  expires_at: number
}

function pool(): Pool {
  if (!registry.__shareMysql) {
    registry.__shareMysql = createPool({
      host: process.env.MYSQL_HOST ?? '127.0.0.1',
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user: process.env.MYSQL_USER ?? 'poe2coach',
      password: process.env.MYSQL_PASSWORD ?? '',
      database: process.env.MYSQL_DATABASE ?? 'poe2coach_share',
      charset: 'utf8mb4',
      connectionLimit: 3,
    })
  }
  return registry.__shareMysql
}

let provisioned = false

/** The table bootstrap runs once per process; a miss here surfaces as a 500. */
async function ensureTable(): Promise<void> {
  if (provisioned) return
  await pool().query(DDL)
  provisioned = true
}

export function mysqlStore(): ShareStore {
  return {
    async insert(id, code, summary, now) {
      await ensureTable()
      // A duplicate id rejects (ER_DUP_ENTRY) and the route's retry mints a new
      // one — same contract as the sqlite driver's PRIMARY KEY.
      await pool().execute('INSERT INTO share (id, code, summary, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', [
        id,
        code,
        summary,
        now,
        now + TTL_MS,
      ])
    },

    async get(id) {
      await ensureTable()
      const [rows] = await pool().execute<Row[]>(
        'SELECT id, code, summary, created_at, expires_at FROM share WHERE id = ?',
        [id],
      )
      return rows[0]
    },

    async touch(id, now) {
      const expiresAt = now + TTL_MS
      try {
        await pool().execute('UPDATE share SET expires_at = ? WHERE id = ? AND expires_at < ?', [expiresAt, id, expiresAt])
        return expiresAt
      } catch {
        return now
      }
    },
  }
}

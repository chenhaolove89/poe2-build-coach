/**
 * The store the routes talk to, selected by SHARE_DB.
 *
 * `sqlite` is the built-in default and the fallback for a bare host. `mysql` is
 * the 统一接入 driver: the host already runs MySQL 8 for the kids-english
 * server, so production runs on it — same machine, same mysql2 library, one
 * more database. Adding another backend is a file in `drivers/` plus a line
 * here; the API and pages never change.
 */
import type { ShareRow, ShareStore } from './store'
import { sqliteStore } from './drivers/sqlite'
import { mysqlStore } from './drivers/mysql'

const factories: Record<string, () => ShareStore> = {
  sqlite: sqliteStore,
  mysql: mysqlStore,
}

const name = process.env.SHARE_DB ?? 'sqlite'
const factory = factories[name]
if (!factory) {
  throw new Error(`unknown SHARE_DB "${name}" — have: ${Object.keys(factories).join(', ')}`)
}

const store: ShareStore = factory()

export type { ShareRow }
export const insertShare = store.insert.bind(store)
export const getShare = store.get.bind(store)
export const touchShare = store.touch.bind(store)

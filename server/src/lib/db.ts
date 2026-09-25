/**
 * The store the routes talk to, selected by SHARE_DB.
 *
 * `sqlite` is the built-in default. When the host's own database service is
 * known (the point of 统一接入), its driver lands in `drivers/` and a line here
 * routes to it — the API and pages never change.
 */
import type { ShareRow, ShareStore } from './store'
import { sqliteStore } from './drivers/sqlite'

const factories: Record<string, () => ShareStore> = {
  sqlite: sqliteStore,
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

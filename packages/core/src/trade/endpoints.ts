/**
 * Where each realm's endpoints actually live.
 *
 * This exists because the difference is a trap: `Realm.siteBase` is a **path**
 * on the site (`https://poe.game.qq.com/trade2`), not an origin, and the
 * `character-window` endpoints hang off the host root. Concatenating them gives
 * `/trade2/character-window/...`, which the site answers with a plain 404 — and
 * a 404 there reads like "this endpoint does not exist for PoE2", which is the
 * opposite of the truth. Getting this wrong once cost a round trip, so the
 * strings are built here and pinned by tests.
 */
import { realmOf } from './realms.js'
import type { Realm, RealmId } from './realms.js'

/** The legacy web-session endpoints, which sit beside `/trade2`, not under it. */
export type CharacterWindowEndpoint = 'get-account-name' | 'get-characters' | 'get-stash-items'

/** The host root of a realm's website: `https://poe.game.qq.com`. */
export function siteOrigin(realm: Realm): string {
  return new URL(realm.siteBase).origin
}

/** A trade search, which is what a price check posts to. */
export function searchUrl(realm: Realm, league: string): string {
  return `${realm.apiBase}/search/poe2/${encodeURIComponent(league)}`
}

/** A `character-window` endpoint: the stash and character reads live here. */
export function characterWindowUrl(realm: Realm, endpoint: CharacterWindowEndpoint): string {
  return `${siteOrigin(realm)}/character-window/${endpoint}`
}

/** Convenience for callers that only have a realm id. */
export function endpointsFor(id: RealmId): { realm: Realm; origin: string; search: (league: string) => string } {
  const realm = realmOf(id)
  return { realm, origin: siteOrigin(realm), search: (league) => searchUrl(realm, league) }
}

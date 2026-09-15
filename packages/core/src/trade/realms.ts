/**
 * The trade realms the app can talk to.
 *
 * Path of Exile 2 ships three separate trade sites, and each one only knows the
 * language its own game client renders items in. That matters here because a
 * price check starts from item text the player copied out of their client: the
 * mods have to be matched against templates in that same language, so the realm
 * selects a data pack as much as it selects a URL.
 *
 *   intl  www.pathofexile.com   English             (the global client)
 *   cn    poe.game.qq.com       Simplified Chinese  (Tencent / WeGame)
 *   tw    pathofexile.tw        Traditional Chinese (Garena)
 *
 * The stat ids are shared across all three — only the template wording and word
 * order differ (international "#% to Fire Resistance", Tencent "火焰抗性 #%",
 * Garena "#%火焰抗性") — which is why each realm needs its own pack.
 *
 * Simplified Chinese exists only on the Tencent realm; the international and
 * Garena clients write Traditional.
 */

export type RealmId = 'intl' | 'cn' | 'tw'

/** Language a realm's game client writes item text in. */
export type RealmLanguage = 'en' | 'zh-Hans' | 'zh-Hant'

export interface Realm {
  id: RealmId
  /** Name shown in the settings panel. */
  label: string
  /** Short qualifier, so the two Chinese realms are not confused. */
  operator: string
  /** Trade API root; every request path is appended to it. */
  apiBase: string
  /** Where the same search opens in a browser. */
  siteBase: string
  lang: RealmLanguage
  /**
   * True when the trade site refuses anonymous searches. Tencent's login is the
   * game account, so price checks there need a session cookie the player copies
   * out of their own browser — see the POESESSID handling in the desktop app.
   */
  loginRequired: boolean
}

export const REALMS: Record<RealmId, Realm> = {
  intl: {
    id: 'intl',
    label: '国际服',
    operator: 'Grinding Gear Games',
    apiBase: 'https://www.pathofexile.com/api/trade2',
    siteBase: 'https://www.pathofexile.com/trade2',
    lang: 'en',
    loginRequired: false,
  },
  cn: {
    id: 'cn',
    label: '国服',
    operator: '腾讯 WeGame · 简体',
    apiBase: 'https://poe.game.qq.com/api/trade2',
    siteBase: 'https://poe.game.qq.com/trade2',
    lang: 'zh-Hans',
    loginRequired: true,
  },
  tw: {
    id: 'tw',
    label: '台服',
    // Authored in Simplified like every other string the UI shows, so the
    // display-language switch can reach it; 繁體 stays put as the label for
    // the realm's own client language. The operator is 熱酷科技, the company
    // that took over the 台港澳 agency from Garena.
    operator: '热酷科技 · 繁體',
    apiBase: 'https://pathofexile.tw/api/trade2',
    siteBase: 'https://pathofexile.tw/trade2',
    lang: 'zh-Hant',
    loginRequired: false,
  },
}

export const REALM_IDS = Object.keys(REALMS) as RealmId[]

export function isRealmId(value: unknown): value is RealmId {
  return typeof value === 'string' && value in REALMS
}

/** Falls back to the international realm for anything unrecognised. */
export function realmOf(id: string | null | undefined): Realm {
  return isRealmId(id) ? REALMS[id] : REALMS.intl
}

/**
 * The display language a realm's data is natively written in, as the app's
 * `ZhVariant` calls it. Used to skip a pointless rewrite when the player reads
 * the realm's own language.
 */
export function realmVariant(realm: Realm): 'hans' | 'hant' | null {
  if (realm.lang === 'zh-Hans') return 'hans'
  if (realm.lang === 'zh-Hant') return 'hant'
  return null
}

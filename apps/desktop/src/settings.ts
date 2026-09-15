/**
 * User settings: which trade realm to talk to, and the session cookie the one
 * login-gated realm needs.
 *
 * There is no display-language setting. It follows the realm: Simplified only
 * exists on the Tencent client, and the international client ships Traditional
 * rather than Simplified, so picking a realm already picks the script. See
 * `Realm.reading`.
 *
 * These are module-level refs rather than a composable instance so that any
 * component can read them and Vue still tracks the dependency — a template
 * that renders `realm.value.apiBase` re-renders when the realm changes.
 */
import { computed, ref, watch } from 'vue'
import { REALMS, realmOf, type Realm, type RealmId, type ZhVariant } from '@poe2coach/core'

const REALM_KEY = 'poe2coach.realm'
/**
 * Kept apart from the realm: this one is a credential, and it should be
 * obvious which key to delete.
 */
const SESSION_KEY = 'poe2coach.cnSession'
/** Written by the version that had a language switch of its own; now unused. */
const LEGACY_VARIANT_KEY = 'poe2coach.zhVariant'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    /* storage disabled — the pick just will not persist */
  }
}

/** International is the default: it is the only realm that never needs a login. */
export const realmId = ref<RealmId>(realmOf(read(REALM_KEY)).id)

export const realm = computed<Realm>(() => REALMS[realmId.value])

/** The script this realm's players read. Not user-selectable. */
export const zhVariant = computed<ZhVariant>(() => realm.value.reading)

/**
 * A Tencent session cookie (POESESSID), in the "name=value" form DevTools
 * shows. Empty for the realms that answer anonymously.
 */
export const cnSession = ref<string>(read(SESSION_KEY) ?? '')

export function selectRealm(id: RealmId): void {
  realmId.value = id
}

export function setCnSession(cookie: string): void {
  cnSession.value = cookie.trim()
}

watch(realmId, (v) => write(REALM_KEY, v), { immediate: true })
watch(cnSession, (v) => write(SESSION_KEY, v), { immediate: true })

// Drop the key the removed language switch used to write, so a later code path
// cannot resurrect a stale choice.
write(LEGACY_VARIANT_KEY, '')

/**
 * User settings: which trade realm to talk to, which Chinese variant to read,
 * and the session cookie the one login-gated realm needs.
 *
 * These are module-level refs rather than a composable instance so that any
 * component can read them and Vue still tracks the dependency — a template
 * that renders `realm.value.apiBase` re-renders when the realm changes.
 */
import { computed, ref, watch } from 'vue'
import { REALMS, realmOf, type Realm, type RealmId, type ZhVariant } from '@poe2coach/core'

const REALM_KEY = 'poe2coach.realm'
const VARIANT_KEY = 'poe2coach.zhVariant'
/**
 * Kept apart from the other two: this one is a credential, and it should be
 * obvious which key to delete.
 */
const SESSION_KEY = 'poe2coach.cnSession'

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

export const zhVariant = ref<ZhVariant>(read(VARIANT_KEY) === 'hant' ? 'hant' : 'hans')

/**
 * A Tencent session cookie (POESESSID), in the "name=value" form DevTools
 * shows. Empty for the realms that answer anonymously.
 */
export const cnSession = ref<string>(read(SESSION_KEY) ?? '')

export const realm = computed<Realm>(() => REALMS[realmId.value])

/**
 * Pick a realm, and follow it with the language its player most likely reads:
 * 国服 clients only ship Simplified and Garena's only Traditional, so pairing
 * them is right far more often than not. The language stays switchable
 * afterwards — plenty of 国服 players prefer reading Traditional.
 */
export function selectRealm(id: RealmId): void {
  realmId.value = id
  if (id === 'cn') zhVariant.value = 'hans'
  else if (id === 'tw') zhVariant.value = 'hant'
}

export function selectVariant(variant: ZhVariant): void {
  zhVariant.value = variant
}

export function setCnSession(cookie: string): void {
  cnSession.value = cookie.trim()
}

watch(realmId, (v) => write(REALM_KEY, v), { immediate: true })
watch(zhVariant, (v) => write(VARIANT_KEY, v), { immediate: true })
watch(cnSession, (v) => write(SESSION_KEY, v), { immediate: true })

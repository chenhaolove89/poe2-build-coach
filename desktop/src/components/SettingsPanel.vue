<script setup lang="ts">
/**
 * Realm selection, and the login the one gated realm needs.
 *
 * There is deliberately nothing else. Everything the tool can decide on its own
 * it does without a setting: the credential is cached when the player links
 * their login, the display language follows the realm (a realm's client only
 * writes one script — see `Realm.reading`), and the league list is fetched from
 * a public endpoint. A settings page should only hold real choices.
 *
 * Manual cookie pasting survives as a collapsed fallback for when the login
 * window cannot open — but it is the escape hatch, not the path.
 */
import { computed, ref } from 'vue'
import { REALMS, REALM_IDS, type RealmId } from '@poe2coach/core'
import { t } from '../i18n'
import { cnSession, realmId, selectRealm, setCnSession } from '../settings'
import { linkRealmSession, SessionLinkError, type LinkProgress } from '../sessionLink'
import { isDesktopRuntime } from '../tradeClient'

const draft = ref(cnSession.value)
const saved = ref(false)
const linking = ref(false)
const linkError = ref<string | null>(null)
const linkProgress = ref<LinkProgress>('waiting')

const desktop = isDesktopRuntime()

const active = computed(() => REALMS[realmId.value])
/** The one realm whose trade site will not answer without a login. */
const needsSession = computed(() => active.value.loginRequired)

function chooseRealm(id: RealmId) {
  selectRealm(id)
  linkError.value = null
}

function saveSession() {
  setCnSession(draft.value)
  saved.value = true
  setTimeout(() => (saved.value = false), 1500)
}

function clearSession() {
  draft.value = ''
  setCnSession('')
}

/**
 * Open the realm's own sign-in page in a separate window and take the session
 * cookie from there, so the player never has to touch DevTools.
 */
async function startLink() {
  if (linking.value) return
  linking.value = true
  linkError.value = null
  linkProgress.value = 'waiting'
  try {
    // The window stays open until a real search comes back authorised. Merely
    // finding a cookie would succeed immediately: 国服 hands one to anonymous
    // visitors, so the window would close before the player could log in.
    const cookie = await linkRealmSession(active.value, (state) => (linkProgress.value = state))
    draft.value = cookie
    setCnSession(cookie)
  } catch (e) {
    linkError.value =
      e instanceof SessionLinkError
        ? t(e.message)
        : t('无法打开登录窗口,请展开下面的手动粘贴。')
  } finally {
    linking.value = false
  }
}

/** What the login window is waiting on, in the player's words. */
const LINK_STATE_TEXT: Record<LinkProgress, string> = {
  waiting: '等待登录中…请在打开的窗口完成登录',
  verifying: '已取得会话,正在验证它是否真的登录了…',
  unverified: '窗口里已有会话,但还没登录 —— 匿名访客也会拿到 cookie。请在窗口里用 QQ / 微信登录,登录成功后这个窗口会自己关闭。',
}
</script>

<template>
  <div class="settings">
    <h2>{{ t('设置') }}</h2>

    <section class="block">
      <h3>{{ t('服务器') }}</h3>
      <div class="realms">
        <button
          v-for="id in REALM_IDS"
          :key="id"
          class="realm"
          :class="{ active: realmId === id }"
          @click="chooseRealm(id)"
        >
          <span class="realm-label">{{ t(REALMS[id].label) }}</span>
          <span class="realm-op">{{ t(REALMS[id].operator) }}</span>
          <span v-if="REALMS[id].loginRequired" class="realm-flag">{{ t('需登录') }}</span>
        </button>
      </div>
      <p class="note dim">
        <template v-if="needsSession">
          {{ t('查价走国服交易站，需要登录（见下）。界面语言随所选服务器自动切换。') }}
        </template>
        <template v-else>
          {{ t('这个服可以直接查询，不需要登录。界面语言随所选服务器自动切换。') }}
        </template>
      </p>
    </section>

    <section v-if="needsSession" class="block">
      <h3>{{ t('国服登录') }}</h3>
      <p class="state" :class="cnSession ? 'ok' : 'warn'">
        <template v-if="cnSession">
          {{ t('已关联登录，可以查价。凭证只保存在本机，只用于向国服交易站做只读查询。') }}
          <button class="mini-link" @click="clearSession">{{ t('清除') }}</button>
        </template>
        <template v-else>{{ t('尚未登录 —— 登录后才能查价。') }}</template>
      </p>

      <button class="primary wide" :disabled="!desktop || linking" @click="startLink">
        {{ linking ? t(LINK_STATE_TEXT[linkProgress]) : t('关联登录') }}
      </button>
      <p v-if="!desktop && !linking" class="state warn">
        {{ t('关联登录需要桌面版。也可以在浏览器登录 poe.game.qq.com 后手动粘贴 Cookie（见下）。') }}
      </p>
      <p v-if="linkError" class="state err">{{ linkError }}</p>

      <details class="manual">
        <summary>{{ t('自动登录不行？手动粘贴 Cookie') }}</summary>
        <p class="hint">
          {{ t('在浏览器登录 poe.game.qq.com 后，按 F12 → 应用 → Cookies，复制 POESESSID 的值粘贴到这里。') }}
        </p>
        <div class="session">
          <input
            v-model="draft"
            type="password"
            spellcheck="false"
            :placeholder="t('POESESSID 的值,或 POESESSID=… 整条')"
            @keyup.enter="saveSession"
          />
          <button :disabled="!draft.trim()" @click="saveSession">
            {{ saved ? t('已保存') : t('保存') }}
          </button>
        </div>
      </details>
    </section>
  </div>
</template>

<style scoped>
.settings {
  max-width: 620px;
}
h2 {
  font-size: 16px;
  color: #e8b04b;
  margin-bottom: 16px;
}
.block {
  background: #10131b;
  border: 1px solid #232939;
  border-radius: 10px;
  padding: 14px 16px;
  margin-bottom: 14px;
}
h3 {
  font-size: 13px;
  color: #cfd4e4;
  margin-bottom: 10px;
  font-weight: 600;
}
.hint {
  font-size: 12px;
  color: #9aa3bd;
  line-height: 1.7;
  margin-bottom: 10px;
}
.note {
  font-size: 11px;
  line-height: 1.75;
  margin-top: 10px;
}
.realms {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.realm {
  flex: 1 1 180px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  align-items: flex-start;
  text-align: left;
  background: #0b0d12;
  border: 1px solid #2c3244;
  border-radius: 8px;
  padding: 10px 12px;
  color: #cfd4e4;
  cursor: pointer;
  font: inherit;
}
.realm:hover {
  border-color: #4a5468;
}
.realm.active {
  border-color: #e8b04b;
  background: #1f1a10;
}
.realm-label {
  font-size: 14px;
  font-weight: 600;
}
.realm.active .realm-label {
  color: #e8b04b;
}
.realm-op {
  font-size: 11px;
  color: #9aa3bd;
}
.realm-flag {
  margin-top: 3px;
  font-size: 10px;
  color: #d9a441;
  border: 1px solid #4a3d20;
  border-radius: 8px;
  padding: 0 7px;
}
button.wide {
  width: 100%;
}
button {
  background: #1a1f2c;
  border: 1px solid #2c3244;
  color: #cfd4e4;
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
}
button:hover:not(:disabled) {
  border-color: #e8b04b;
  color: #e8b04b;
}
button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
button.primary {
  background: #e8b04b;
  border-color: #e8b04b;
  color: #14120a;
  font-weight: 600;
}
button.primary:hover:not(:disabled) {
  color: #14120a;
  filter: brightness(1.08);
}
.mini-link {
  background: none;
  border: none;
  padding: 0 0 0 6px;
  font-size: 11px;
  color: #8a93ad;
  text-decoration: underline;
  cursor: pointer;
}
.mini-link:hover {
  color: #e06060;
}
.state {
  font-size: 11px;
  margin: 10px 0;
  line-height: 1.7;
}
.state.ok {
  color: #7dd087;
}
.state.warn {
  color: #d9a441;
}
.state.err {
  color: #e06060;
}
.manual {
  margin-top: 14px;
  border-top: 1px dashed #2c3244;
  padding-top: 10px;
}
.manual summary {
  font-size: 12px;
  color: #8a93ad;
  cursor: pointer;
  user-select: none;
}
.manual summary:hover {
  color: #cfd4e4;
}
.manual[open] summary {
  margin-bottom: 10px;
}
.session {
  display: flex;
  gap: 8px;
}
.session input {
  flex: 1;
  background: #0b0d12;
  color: #cfd4e4;
  border: 1px solid #2c3244;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 12px;
  font-family: 'Consolas', 'Menlo', monospace;
}
.session input:focus {
  outline: none;
  border-color: #e8b04b;
}
.dim {
  color: #6b7390;
}
</style>

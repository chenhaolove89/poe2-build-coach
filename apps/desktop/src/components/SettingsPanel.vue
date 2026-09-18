<script setup lang="ts">
/**
 * Realm and login settings.
 *
 * The display language is not offered here: it follows the realm, because a
 * realm's client only writes one script (see `Realm.reading`). One switch
 * instead of two also means the two can never disagree, which they silently
 * could before — matching used the realm's pack while the UI showed the other
 * script.
 */
import { computed, onMounted, ref } from 'vue'
import { REALMS, REALM_IDS, type RealmId } from '@poe2coach/core'
import { t } from '../i18n'
import { cnSession, realmId, selectRealm, setCnSession, zhVariant } from '../settings'
import { linkRealmSession, SessionLinkError } from '../sessionLink'
import { probeStashAccess, stashVerdict, type ProbeStep } from '../stashProbe'
import { fetchLeagues, isDesktopRuntime, savedLeague } from '../tradeClient'

const draft = ref(cnSession.value)
const saved = ref(false)
const linking = ref(false)
const linkError = ref<string | null>(null)

const desktop = isDesktopRuntime()

const active = computed(() => REALMS[realmId.value])
/** The one realm whose trade site will not answer without a login. */
const needsSession = computed(() => active.value.loginRequired)

// ------------------------------------------------------------- 仓库接口诊断

const probeLeague = ref(savedLeague() ?? '')
const probeAccount = ref('')
const probing = ref(false)
const probeError = ref<string | null>(null)
const steps = ref<ProbeStep[]>([])

/**
 * Fill the league in rather than making the player type it.
 *
 * The league list is a public endpoint on all three realms, and the probe needs
 * a real league name in its query — a wrong one would come back as a search
 * failure and look like a credential problem.
 */
onMounted(async () => {
  if (probeLeague.value.trim() || !desktop) return
  try {
    probeLeague.value = (await fetchLeagues(active.value))[0] ?? ''
  } catch {
    /* no session yet — the field stays empty and the button stays disabled */
  }
})

/**
 * Ask the realm, with the credential already stored, whether PoE2 gives out
 * stash contents. This is a question the docs do not answer: the API reference
 * marks the stash endpoints as PoE1 only, yet the routes are plainly still
 * there, so only a real session settles it.
 */
async function runProbe() {
  probing.value = true
  probeError.value = null
  steps.value = []
  try {
    steps.value = await probeStashAccess({
      realm: active.value,
      league: probeLeague.value.trim(),
      account: probeAccount.value,
    })
  } catch (e) {
    probeError.value = e instanceof Error ? e.message : String(e)
  } finally {
    probing.value = false
  }
}

const verdict = computed(() => (steps.value.length > 0 ? stashVerdict(steps.value) : null))
const VERDICT_TEXT: Record<string, string> = {
  served: '拿到仓库结构了 —— PoE2 的仓库可以读,"今日净值差"这条路走得通。(items 为空只是那一页没东西,不是失败。)',
  refused: '被拒了。对照那一步若是 200,说明凭证没问题、是这个接口对 PoE2 关着;国服是 401 而国际服/台服是 403,两个都是"路由在、不放行"。',
  unknown: '200 但没带仓库结构 —— 通常是 HTML 登录页,也就是凭证过期了,重新关联一次再试。',
}

/**
 * Running this without a credential would be worse than not running it: every
 * step comes back 401, which reads like an answer ("the endpoint refuses PoE2")
 * when it is really just an empty request. So the button stays off until there
 * is something to send.
 */
const needsCredential = computed(() => active.value.loginRequired && !cnSession.value)
const probeReady = computed(() => desktop && !!probeLeague.value.trim() && !needsCredential.value)

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
  try {
    const cookie = await linkRealmSession(active.value)
    draft.value = cookie
    setCnSession(cookie)
  } catch (e) {
    linkError.value =
      e instanceof SessionLinkError
        ? t(e.message)
        : t('无法打开登录窗口,请改用手动粘贴。')
  } finally {
    linking.value = false
  }
}
</script>

<template>
  <div class="settings">
    <h2>{{ t('设置') }}</h2>

    <section class="block">
      <h3>{{ t('服务器') }}</h3>
      <p class="hint">
        {{ t('决定查价走哪个交易站。三个服的游戏文本语言不同，粘贴的装备要和所在服的模板匹配才能查出价格。界面语言跟着服务器自动切换，不用单独选。') }}
      </p>
      <div class="realms">
        <button
          v-for="id in REALM_IDS"
          :key="id"
          class="realm"
          :class="{ active: realmId === id }"
          @click="chooseRealm(id)"
        >
          <span class="realm-label">{{ t(REALMS[id].label) }}</span>
          <span class="realm-op">{{ REALMS[id].operator }}</span>
          <span class="realm-host">{{ REALMS[id].apiBase.replace('https://', '') }}</span>
          <span v-if="REALMS[id].loginRequired" class="realm-flag">{{ t('需登录') }}</span>
        </button>
      </div>
      <p class="note dim">
        <template v-if="needsSession">
          {{ t('国服的交易站不对外开放匿名查询，实测未登录会返回 401。要在国服查价，需要填入你浏览器登录后的会话 Cookie（见下）。词缀匹配、联赛列表、物品解析都是本地或公开接口，不受影响。') }}
        </template>
        <template v-else>
          {{ t('这个服可以直接查询，不需要登录。') }}
        </template>
      </p>
    </section>

    <section v-if="needsSession" class="block">
      <h3>{{ t('国服登录') }}</h3>
      <p class="hint">
        {{
          t(
            '国服交易站要求登录后才能查询。点下面的按钮会在一个独立窗口里打开腾讯官方的登录页,用 QQ / 微信登录后本工具自动取回会话 Cookie。',
          )
        }}
      </p>

      <div class="link-row">
        <button class="primary wide" :disabled="!desktop || linking" @click="startLink">
          {{ linking ? t('等待登录中…请在打开的窗口完成登录') : t('关联登录(推荐)') }}
        </button>
      </div>
      <p v-if="!desktop" class="state warn">
        {{ t('关联登录需要桌面版:它要用内嵌浏览器打开登录页。浏览器预览只能用下面的手动方式。') }}
      </p>
      <p v-else-if="linking" class="state warn">
        {{ t('登录窗口已打开。完成登录后这里会自动获取凭证;关掉窗口即取消。') }}
      </p>

      <p class="hint manual">
        {{ t('也可以手动粘贴:在浏览器登录 poe.game.qq.com 后,按 F12 → Application/应用 → Cookies → 复制 POESESSID 的值。') }}
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
        <button :disabled="!cnSession" @click="clearSession">{{ t('清除') }}</button>
      </div>
      <p v-if="linkError" class="state err">{{ linkError }}</p>

      <ul class="caveats">
        <li>{{ t('打开的登录页是腾讯官方页面,账号密码只填在那一页,本工具不会接触、也无法接触。') }}</li>
        <li>{{ t('本工具读到的只是登录后的会话 Cookie,等同于浏览器里的登录状态,请只在自己的机器上使用。') }}</li>
        <li>{{ t('它只保存在本机,只会发给 poe.game.qq.com,不会发给其他两个服。') }}</li>
        <li>{{ t('本工具只用它做只读查询,不会交易、不会上架、不会改任何账号数据。') }}</li>
        <li>{{ t('会话会过期,过期后重新关联一次即可。') }}</li>
      </ul>
      <p v-if="cnSession" class="state ok">{{ t('已保存凭证，可以查询国服。') }}</p>
      <p v-else class="state warn">{{ t('尚未填写，国服只能做本地词缀匹配，无法取回价格。') }}</p>
    </section>

    <section class="block">
      <h3>{{ t('仓库接口诊断') }}</h3>
      <p class="hint">
        {{
          t(
            '「今日收益多少 D」这类数字,查价器不是从掉落算的,是定时快照你的仓库、定价、再相减。那需要读仓库,而官方文档把仓库接口标成只支持 PoE1。点下面的按钮会用你已保存的凭证实测一次,看 PoE2 到底给不给。',
          )
        }}
      </p>
      <div class="probe-row">
        <label class="mini">
          <span class="dim">{{ t('赛季') }}</span>
          <input v-model="probeLeague" spellcheck="false" :placeholder="t('和查价页一致,如 奥杜尔秘符')" />
        </label>
        <label class="mini">
          <span class="dim">{{ t('账号名') }}</span>
          <input v-model="probeAccount" spellcheck="false" :placeholder="t('留空则自动取')" />
        </label>
        <button :disabled="!probeReady || probing" @click="runProbe">
          {{ probing ? t('测试中…') : t('测试仓库接口') }}
        </button>
      </div>
      <p v-if="!desktop" class="state warn">{{ t('需要桌面版:浏览器会被跨域策略拦掉。') }}</p>
      <p v-else-if="needsCredential" class="state warn">
        {{ t('先在上面「关联登录」或粘贴 POESESSID —— 没有凭证跑这个测试,四步都会返回 401,那个 401 说明不了任何事。') }}
      </p>
      <p v-if="probeError" class="state err">{{ t(probeError) }}</p>

      <div v-if="steps.length" class="probe-steps">
        <div v-for="s in steps" :key="s.label" class="probe-step">
          <span class="code" :class="{ ok: s.status === 200, bad: s.status === 0 || s.status >= 400 }">
            {{ s.status || '—' }}
          </span>
          <span class="what">
            <b>{{ t(s.label) }}</b>
            <span class="dim">{{ s.summary }}</span>
            <span v-if="s.items != null" class="dim">
              · items {{ s.items }}<template v-if="s.tabs != null">, tabs {{ s.tabs }}</template>
            </span>
            <span class="url dim">{{ s.url }}</span>
            <span v-if="s.body" class="raw">{{ s.body }}</span>
          </span>
        </div>
        <p v-if="verdict" class="state" :class="verdict === 'served' ? 'ok' : 'warn'">
          {{ t(VERDICT_TEXT[verdict]) }}
        </p>
      </div>
      <p class="note dim">
        {{ t('凭证只发给它所属的那个服,不会显示、不会记录、不会发给另外两个服。这个测试不写任何账号数据。') }}
      </p>
    </section>

    <section class="block">
      <h3>{{ t('当前生效') }}</h3>
      <div class="kv">
        <div class="kv-row"><span class="k">{{ t('交易站') }}</span><span class="v">{{ active.apiBase }}</span></div>
        <div class="kv-row"><span class="k">{{ t('网页版') }}</span><span class="v">{{ active.siteBase }}</span></div>
        <div class="kv-row">
          <span class="k">{{ t('游戏文本语言') }}</span>
          <span class="v">{{ active.lang === 'en' ? 'English' : active.lang === 'zh-Hans' ? '简体中文' : '繁體中文' }}</span>
        </div>
        <div class="kv-row">
          <span class="k">{{ t('界面显示') }}</span>
          <span class="v">{{ zhVariant === 'hans' ? '简体中文' : '繁體中文' }}</span>
        </div>
      </div>
      <p class="note dim">
        {{ t('界面语言由服务器决定：简体只在国服存在，国际服客户端自带的是繁体而不是简体，所以选了服务器就等于选了语言，两者不会不一致。') }}
      </p>
    </section>
  </div>
</template>

<style scoped>
.settings {
  max-width: 720px;
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
  margin-bottom: 8px;
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
  flex: 1 1 200px;
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
.realm-host {
  font-size: 10px;
  color: #6b7390;
  font-family: 'Consolas', 'Menlo', monospace;
}
.realm-flag {
  margin-top: 3px;
  font-size: 10px;
  color: #d9a441;
  border: 1px solid #4a3d20;
  border-radius: 8px;
  padding: 0 7px;
}
.link-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
button.wide {
  flex: 1;
}
.hint.manual {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed #2c3244;
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
.caveats {
  margin: 10px 0 0;
  padding-left: 18px;
  font-size: 11px;
  color: #8a93ad;
  line-height: 1.8;
}
.state {
  font-size: 11px;
  margin-top: 10px;
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
.kv-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  padding: 3px 0;
}
.kv-row .k {
  color: #7a8299;
  flex: 0 0 auto;
}
.kv-row .v {
  color: #cfd4e4;
  font-family: 'Consolas', 'Menlo', monospace;
  font-size: 11px;
  text-align: right;
  word-break: break-all;
}
.dim {
  color: #6b7390;
}
.probe-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}
.mini {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
}
.mini input {
  background: #0b0d12;
  color: #cfd4e4;
  border: 1px solid #2c3244;
  border-radius: 6px;
  padding: 7px 9px;
  font-size: 12px;
  min-width: 180px;
}
.mini input:focus {
  outline: none;
  border-color: #e8b04b;
}
.probe-steps {
  margin-top: 12px;
  border-top: 1px dashed #2c3244;
  padding-top: 10px;
}
.probe-step {
  display: flex;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid #171b26;
}
.probe-step .code {
  flex: 0 0 42px;
  font-family: 'Consolas', 'Menlo', monospace;
  font-size: 12px;
  color: #9aa3bd;
}
.probe-step .code.ok {
  color: #7dd087;
}
.probe-step .code.bad {
  color: #e06060;
}
.probe-step .what {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  font-size: 12px;
  color: #cfd4e4;
}
.probe-step .url {
  font-family: 'Consolas', 'Menlo', monospace;
  font-size: 10px;
  word-break: break-all;
}
.probe-step .raw {
  font-family: 'Consolas', 'Menlo', monospace;
  font-size: 10px;
  color: #7a8299;
  background: #0b0d12;
  border-radius: 4px;
  padding: 4px 6px;
  word-break: break-all;
  max-height: 90px;
  overflow: hidden;
}
</style>

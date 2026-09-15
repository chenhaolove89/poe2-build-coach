<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { matchItemMods, parseItemText } from '@poe2coach/core'
import type { GameItem, StatMatch } from '@poe2coach/core'
import { bilingual, currencyName, dialect, t } from '../i18n'
import { realm, realmId } from '../settings'
import {
  ensureRealmData,
  fetchLeagues,
  isDesktopRuntime,
  priceCheck,
  rateLimitState,
  rememberLeague,
  savedLeague,
  TradeError,
} from '../tradeClient'
import type { PriceCheckResult, RealmData } from '../tradeClient'

const emit = defineEmits<{ openSettings: [] }>()

const draft = ref('')
const item = ref<GameItem | null>(null)
const matches = ref<StatMatch[]>([])
const parseError = ref<string | null>(null)
const queryError = ref<string | null>(null)
const loading = ref(false)
const result = ref<PriceCheckResult | null>(null)
const leagues = ref<string[]>([])
const league = ref('')
const onlineOnly = ref(true)
const copied = ref(false)

/** The active realm's mod templates and currency labels. */
const data = ref<RealmData | null>(null)
const desktop = isDesktopRuntime()
const needsSession = computed(() => realm.value.loginRequired)

/** Refreshed by hand: the request log is not reactive, so a computed would freeze at its first value. */
const limit = ref(rateLimitState())

const RARITY_ZH: Record<string, string> = {
  NORMAL: '普通',
  MAGIC: '魔法',
  RARE: '稀有',
  UNIQUE: '传奇',
  RELIC: '圣物',
  CURRENCY: '通货',
  GEM: '宝石',
}

const KIND_ZH: Record<string, string> = {
  explicit: '显式',
  implicit: '隐式',
  fractured: '裂变',
  crafted: '制作',
  enchant: '魔附',
  rune: '符文',
  pseudo: '综合',
}

/**
 * Item names come from the player's own client, so the dictionary usually has
 * nothing for them — a 国服 rare is already called "祸害 魔甲". bilingual()
 * falls through to the realm's language for exactly that case.
 */
function label(en: string | null | undefined): string {
  if (!en) return '—'
  return bilingual(en) || '—'
}

/** Mod lines are the player's own text too, and need no dictionary. */
function modLine(text: string): string {
  return bilingual(text) || text
}

async function loadRealm() {
  try {
    data.value = await ensureRealmData()
  } catch (e) {
    queryError.value = t(e instanceof Error ? e.message : String(e))
  }
  rematch()
}

async function loadLeagues() {
  league.value = savedLeague() ?? ''
  try {
    leagues.value = await fetchLeagues()
    if (!league.value || !leagues.value.includes(league.value)) league.value = leagues.value[0] ?? ''
  } catch {
    /* league list is a convenience; the check below reports real problems */
  } finally {
    limit.value = rateLimitState()
  }
}

onMounted(async () => {
  // The stat packs are local JSON, so matching works in a browser preview too.
  // Only the league list needs the API, which a browser cannot reach.
  await loadRealm()
  if (desktop) await loadLeagues()
})

/**
 * The templates belong to the realm, so a switch invalidates the match: the
 * same mod line resolves against "生命上限 #" on 国服 and "#最大生命" on 台服.
 */
watch(realmId, async () => {
  result.value = null
  queryError.value = null
  data.value = null
  leagues.value = []
  await loadRealm()
  await loadLeagues()
})

/** Parsing and stat matching are local, so they work even without the API. */
function onParse() {
  parseError.value = null
  queryError.value = null
  result.value = null
  item.value = null
  matches.value = []
  try {
    item.value = parseItemText(draft.value)
    rematch()
  } catch (e) {
    parseError.value = String(e)
  }
}

function rematch() {
  if (!item.value || !data.value) return
  matches.value = matchItemMods(item.value, data.value.statIndex)
}

async function onCheck() {
  if (!item.value) return
  if (!desktop) {
    queryError.value = t('浏览器预览无法直连官方 API(跨域被拦),请使用桌面版查价。')
    return
  }
  if (needsSession.value) {
    queryError.value = t('国服需要在设置里填入登录后的 POESESSID 才能查询。')
    emit('openSettings')
    return
  }
  if (!league.value) {
    queryError.value = t('请先选择联赛。')
    return
  }
  loading.value = true
  queryError.value = null
  result.value = null
  try {
    result.value = await priceCheck(item.value, { league: league.value, online: onlineOnly.value })
    rememberLeague(league.value)
  } catch (e) {
    const message = e instanceof TradeError ? e.message : String(e)
    queryError.value = t(message)
  } finally {
    loading.value = false
    limit.value = rateLimitState()
  }
}

async function copyQuery() {
  if (!result.value) return
  try {
    await navigator.clipboard.writeText(JSON.stringify(result.value.built.tradeQuery.query, null, 2))
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    queryError.value = t('复制失败,请手动选中下面的内容。')
  }
}

/** The same search, on the realm's own site — for the parts this tool does not do. */
const tradeUrl = computed(() => {
  if (!league.value) return realm.value.siteBase
  return `${realm.value.siteBase}/search/poe2/${encodeURIComponent(league.value)}`
})

const currency = computed(() => data.value?.currency ?? {})
const currencyLabel = (id: string | null | undefined) => currencyName(id, currency.value)

const matched = computed(() => matches.value.filter((m) => m.statId))
const unmatched = computed(() => matches.value.filter((m) => !m.statId))
/** Uniques are searched by name, so no mod got a filter — say so instead of showing "0 filters". */
const isUnique = computed(() => (item.value?.rarity ?? '').toUpperCase() === 'UNIQUE')
</script>

<template>
  <div class="price-wrap">
    <p class="meta dim">
      {{ t('粘贴一件装备(游戏内 Ctrl+C 或 PoB 物品文本),工具会把它翻译成官方交易站的查询条件并取回实时挂单。只调用官方只读接口,不模拟按键、不读取游戏内存。') }}
    </p>

    <div class="realm-line">
      <span class="realm-tag">{{ t(realm.label) }}</span>
      <span class="dim">{{ realm.apiBase.replace('https://', '') }}</span>
      <a class="dim link" :href="tradeUrl" target="_blank" rel="noreferrer">{{ t('在交易站打开') }} ↗</a>
      <button class="mini" @click="emit('openSettings')">{{ t('切换服务器') }}</button>
    </div>

    <div v-if="!desktop" class="notice warn">
      {{ t('当前是浏览器预览环境,官方接口不带跨域许可,无法取回价格。词缀匹配是本地计算,这里仍可正常查看。') }}
    </div>

    <div v-else-if="needsSession" class="notice warn">
      {{ t('国服交易站不对外开放匿名查询。请在「设置」里填入登录 poe.game.qq.com 后的 POESESSID 再查价;下面的词缀匹配不受影响。') }}
      <button class="mini" @click="emit('openSettings')">{{ t('去设置') }}</button>
    </div>

    <div class="controls">
      <label class="dim">{{ t('联赛') }}</label>
      <select v-model="league" class="league">
        <option v-if="!leagues.length" :value="league">{{ league || t('(未加载)') }}</option>
        <option v-for="l in leagues" :key="l" :value="l">{{ l }}</option>
      </select>
      <label class="check dim">
        <input v-model="onlineOnly" type="checkbox" />
        {{ t('仅在线卖家') }}
      </label>
      <span class="dim limit">
        {{ t('本机配额') }}:{{ limit.usedInWindow }} / {{ limit.maxInWindow }} {{ t('次每') }} {{ limit.windowSeconds }} {{ t('秒') }}
      </span>
    </div>

    <textarea
      v-model="draft"
      rows="6"
      :placeholder="
        t(
          'Rarity: RARE\nDoom Tread\nRuneforged Wanderer Shoes\n...\n+129 to maximum Life\n\n也可以直接粘贴国服/台服客户端的物品文本',
        )
      "
      spellcheck="false"
    />
    <div class="btn-row">
      <button :disabled="!draft.trim()" @click="onParse">{{ t('解析物品') }}</button>
      <button class="primary" :disabled="!item || loading" @click="onCheck">
        {{ loading ? t('查询中…') : t('查价') }}
      </button>
    </div>
    <p v-if="parseError" class="error">{{ parseError }}</p>
    <p v-if="queryError" class="error">{{ queryError }}</p>

    <template v-if="item">
      <h2>{{ label(item.name ?? item.base) }}</h2>
      <div class="meta-line dim">
        {{ t(RARITY_ZH[item.rarity ?? ''] ?? item.rarity ?? '—') }}
        <span v-if="item.base && item.name"> · {{ label(item.base) }}</span>
        <span v-if="item.itemLevel"> · {{ t('物品等级') }} {{ item.itemLevel }}</span>
        <span v-if="item.itemClass"> · {{ t('类型') }} {{ dialect(item.itemClass) }}</span>
      </div>

      <h3>{{ t('词缀匹配') }}({{ matched.length }} / {{ matches.length }})</h3>
      <p v-if="!data" class="dim note">{{ t('正在载入该服的词缀模板…') }}</p>
      <div class="mods">
        <div v-for="(m, i) in matches" :key="i" class="mod" :class="{ hit: m.statId }">
          <span class="mark">{{ m.statId ? '✓' : '·' }}</span>
          <span class="text">{{ modLine(m.text) }}</span>
          <span class="tag dim">{{ t(KIND_ZH[m.kind] ?? m.kind) }}</span>
          <span v-if="m.statId" class="id dim">{{ m.statId }}</span>
          <span v-else class="id dim">{{ t('未收录模板,不参与查询') }}</span>
        </div>
      </div>
      <p v-if="unmatched.length" class="dim note">
        {{ t('未匹配的行大多是装备自带属性(伤害、暴击、攻速等)或该服独有的措辞,不影响其余词缀的查询。') }}
      </p>
    </template>

    <template v-if="result">
      <div v-if="result.relaxed" class="notice warn">
        {{ t('在线卖家暂无挂单,已放宽为包含离线卖家的全部挂单(共') }} {{ result.total }} {{ t('条)。离线卖家未必能成交,低价单可能已经失效。') }}
      </div>

      <h2>{{ t('价格') }}</h2>
      <div v-if="result.summary.priced" class="summary">
        <div class="stat">
          <span class="dim">{{ t('最低') }}</span>
          <b>{{ result.summary.min }} {{ currencyLabel(result.summary.currency) }}</b>
        </div>
        <div class="stat">
          <span class="dim">{{ t('中位') }}</span>
          <b>{{ result.summary.median }} {{ currencyLabel(result.summary.currency) }}</b>
        </div>
        <div class="stat">
          <span class="dim">{{ t('最高') }}</span>
          <b>{{ result.summary.max }} {{ currencyLabel(result.summary.currency) }}</b>
        </div>
        <div class="stat">
          <span class="dim">{{ t('命中总数') }}</span>
          <b>{{ result.total }}</b>
        </div>
        <div class="stat">
          <span class="dim">{{ t('这批在线') }}</span>
          <b>{{ result.summary.onlineCount }} / {{ result.summary.priced }}</b>
        </div>
      </div>

      <p class="dim note">
        <template v-if="result.built.used.length">
          {{ t('以你这条词缀的数值为下限搜索(找"不低于此"的同类),共') }} {{ result.built.used.length }}
          {{ t('条词缀进入过滤') }}<template v-if="result.built.skipped.length"
          >,{{ result.built.skipped.length }} {{ t('条未参与') }}</template
          >。
        </template>
        <template v-else-if="isUnique">
          {{ t('传奇按名字查询:词缀波动只影响小幅溢价,卡具体数值会找不到卖家。') }}
        </template>
        {{ t('挂单来自官方实时数据,卖家是否在线以游戏内为准。') }}
      </p>

      <div v-if="result.summary.byCurrency.length > 1" class="dim note">
        {{ t('混合币种') }}:{{ result.summary.byCurrency.map((c) => `${currencyLabel(c.currency)}×${c.count}`).join('、') }}({{ t('统计基于') }}
        {{ currencyLabel(result.summary.currency) }})
      </div>

      <div v-if="result.summary.listings.length" class="listings">
        <div v-for="(l, i) in result.summary.listings" :key="i" class="listing">
          <span class="price">{{ l.amount }} {{ currencyLabel(l.currency) }}</span>
          <span class="name">{{ l.name ? label(l.name) : dialect(l.typeLine ?? '') }}</span>
          <span class="dim">
            <template v-if="l.itemLevel">ilvl {{ l.itemLevel }} · </template>{{ l.modCount }} {{ t('词缀') }}
            <template v-if="l.corrupted"> · {{ t('已腐化') }}</template>
            <template v-if="!l.online"> · {{ t('离线') }}</template>
          </span>
        </div>
      </div>
      <p v-else class="dim note">
        {{ onlineOnly ? t('在线卖家没有挂单') : t('这个条件没有任何挂单') }}<template v-if="result.summary.unpriced"
          >({{ result.summary.unpriced }} {{ t('条挂单未标价') }})</template
        >{{ t(',可以放宽词缀、取消"仅在线卖家",或换联赛再试。') }}
      </p>

      <div class="btn-row">
        <button @click="copyQuery">{{ copied ? t('已复制') : t('复制查询 JSON') }}</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.price-wrap {
  max-width: 860px;
}
.meta {
  margin-bottom: 10px;
  line-height: 1.6;
}
.realm-line {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  flex-wrap: wrap;
  font-size: 11px;
}
.realm-tag {
  color: #e8b04b;
  background: #1f1a10;
  border: 1px solid #4a3d20;
  border-radius: 10px;
  padding: 2px 10px;
  font-size: 11px;
}
.link {
  text-decoration: none;
}
.link:hover {
  color: #e8b04b;
}
button.mini {
  background: none;
  border: 1px solid #2c3244;
  color: #9aa3bd;
  border-radius: 10px;
  padding: 2px 10px;
  font-size: 11px;
  cursor: pointer;
}
button.mini:hover {
  border-color: #e8b04b;
  color: #e8b04b;
}
.notice {
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 12px;
  margin-bottom: 12px;
  line-height: 1.7;
}
.notice.warn {
  background: #241f14;
  border: 1px solid #4a3d20;
  color: #d9a441;
}
.controls {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.league {
  background: #0b0d12;
  color: #cfd4e4;
  border: 1px solid #2c3244;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 13px;
}
.limit {
  font-size: 11px;
  margin-left: auto;
}
.check {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}
.check input {
  accent-color: #e8b04b;
  cursor: pointer;
  margin: 0;
}
textarea {
  width: 100%;
  background: #0b0d12;
  color: #cfd4e4;
  border: 1px solid #2c3244;
  border-radius: 6px;
  padding: 10px;
  font-family: 'Consolas', 'Menlo', monospace;
  font-size: 12px;
  resize: vertical;
}
textarea:focus {
  outline: none;
  border-color: #e8b04b;
}
.btn-row {
  display: flex;
  gap: 8px;
  margin: 10px 0 4px;
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
.error {
  color: #e06060;
  font-size: 12px;
  margin: 6px 0;
  line-height: 1.6;
}
h2 {
  font-size: 16px;
  color: #e8b04b;
  margin: 18px 0 8px;
}
h3 {
  font-size: 13px;
  color: #cfd4e4;
  margin: 14px 0 8px;
  font-weight: 600;
}
.meta-line {
  font-size: 12px;
}
.mods {
  border: 1px solid #232939;
  border-radius: 8px;
  overflow: hidden;
}
.mod {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 6px 10px;
  font-size: 12px;
  border-bottom: 1px solid #1a1f2c;
}
.mod:last-child {
  border-bottom: none;
}
.mod.hit {
  background: #10131b;
}
.mark {
  color: #5b6379;
  width: 12px;
}
.mod.hit .mark {
  color: #7dd087;
}
.text {
  color: #cfd4e4;
  flex: 1;
}
.tag {
  font-size: 10px;
  border: 1px solid #2c3244;
  border-radius: 8px;
  padding: 0 8px;
}
.id {
  font-size: 10px;
  font-family: 'Consolas', 'Menlo', monospace;
}
.summary {
  display: flex;
  gap: 26px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
}
.stat b {
  color: #d9a441;
  font-size: 15px;
}
.note {
  font-size: 11px;
  line-height: 1.7;
  margin-bottom: 8px;
}
.listings {
  border: 1px solid #232939;
  border-radius: 8px;
  overflow: hidden;
  margin-top: 8px;
}
.listing {
  display: flex;
  gap: 12px;
  align-items: baseline;
  padding: 7px 10px;
  font-size: 12px;
  border-bottom: 1px solid #1a1f2c;
}
.listing:last-child {
  border-bottom: none;
}
.listing .price {
  color: #7dd087;
  font-weight: 600;
  min-width: 96px;
}
.listing .name {
  flex: 1;
}
.listing .dim {
  font-size: 11px;
}
</style>

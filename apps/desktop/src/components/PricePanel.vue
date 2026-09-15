<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { matchItemMods, parseItemText } from '@poe2coach/core'
import type { GameItem, StatMatch } from '@poe2coach/core'
import { nameZh } from '../nameZh'
import {
  fetchLeagues,
  getStatIndex,
  isDesktopRuntime,
  priceCheck,
  rateLimitState,
  rememberLeague,
  savedLeague,
  TradeError,
} from '../tradeClient'
import type { PriceCheckResult } from '../tradeClient'

const draft = ref('')
const item = ref<GameItem | null>(null)
const matches = ref<StatMatch[]>([])
const parseError = ref<string | null>(null)
const queryError = ref<string | null>(null)
const loading = ref(false)
const result = ref<PriceCheckResult | null>(null)
const leagues = ref<string[]>([])
const league = ref(savedLeague() ?? savedLeague() ?? '')
const copied = ref(false)

const desktop = isDesktopRuntime()
const limit = computed(() => rateLimitState())

const RARITY_ZH: Record<string, string> = {
  NORMAL: '普通',
  MAGIC: '魔法',
  RARE: '稀有',
  UNIQUE: '传奇',
  RELIC: '圣物',
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

function bilingual(en: string | null | undefined): string {
  if (!en) return '—'
  const zh = nameZh(en)
  return zh ? `${zh} ${en}` : en
}

const matched = computed(() => matches.value.filter((m) => m.statId))
const unmatched = computed(() => matches.value.filter((m) => !m.statId))

onMounted(async () => {
  if (!desktop) return
  try {
    leagues.value = await fetchLeagues()
    if (!league.value && leagues.value.length > 0) league.value = leagues.value[0]
  } catch {
    /* league list is a convenience; the check below reports real problems */
  }
})

/** Parsing and stat matching are local, so they work even without the API. */
function onParse() {
  parseError.value = null
  queryError.value = null
  result.value = null
  item.value = null
  matches.value = []
  try {
    const parsed = parseItemText(draft.value)
    item.value = parsed
    matches.value = matchItemMods(parsed, getStatIndex())
  } catch (e) {
    parseError.value = String(e)
  }
}

async function onCheck() {
  if (!item.value) return
  if (!desktop) {
    queryError.value = '浏览器预览无法直连官方 API(跨域被拦),请使用桌面版查价。'
    return
  }
  if (!league.value) {
    queryError.value = '请先选择联赛。'
    return
  }
  loading.value = true
  queryError.value = null
  result.value = null
  try {
    result.value = await priceCheck(item.value, { league: league.value })
    rememberLeague(league.value)
  } catch (e) {
    queryError.value = e instanceof TradeError ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function copyQuery() {
  if (!result.value) return
  try {
    await navigator.clipboard.writeText(JSON.stringify(result.value.built.tradeQuery.query, null, 2))
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    queryError.value = '复制失败,请手动选中下面的内容。'
  }
}
</script>

<template>
  <div class="price-wrap">
    <p class="meta dim">
      粘贴一件装备(游戏内 Ctrl+C 或 PoB 物品文本),工具会把它翻译成官方交易站的查询条件并取回实时挂单。
      只调用官方只读接口,不模拟按键、不读取游戏内存。
    </p>

    <div v-if="!desktop" class="notice warn">
      当前是浏览器预览环境,官方接口不带跨域许可,无法取回价格。词缀匹配是本地计算,这里仍可正常查看。
    </div>

    <div class="controls">
      <label class="dim">联赛</label>
      <select v-model="league" class="league">
        <option v-if="!leagues.length" :value="league">{{ league || '(未加载)' }}</option>
        <option v-for="l in leagues" :key="l" :value="l">{{ l }}</option>
      </select>
      <span class="dim limit">
        本机配额:{{ limit.usedInWindow }} / {{ limit.maxInWindow }} 次每 {{ limit.windowSeconds }} 秒
      </span>
    </div>

    <textarea
      v-model="draft"
      rows="6"
      placeholder="Rarity: RARE&#10;Doom Tread&#10;Runeforged Wanderer Shoes&#10;...&#10;+129 to maximum Life"
      spellcheck="false"
    />
    <div class="btn-row">
      <button :disabled="!draft.trim()" @click="onParse">解析物品</button>
      <button class="primary" :disabled="!item || loading" @click="onCheck">
        {{ loading ? '查询中…' : '查价' }}
      </button>
    </div>
    <p v-if="parseError" class="error">{{ parseError }}</p>
    <p v-if="queryError" class="error">{{ queryError }}</p>

    <template v-if="item">
      <h2>{{ bilingual(item.name ?? item.base) }}</h2>
      <div class="meta-line dim">
        {{ RARITY_ZH[item.rarity ?? ''] ?? item.rarity ?? '—' }}
        <span v-if="item.base && item.name"> · {{ bilingual(item.base) }}</span>
        <span v-if="item.itemLevel"> · 物品等级 {{ item.itemLevel }}</span>
        <span v-if="item.itemClass"> · 类型 {{ item.itemClass }}</span>
      </div>

      <h3>词缀匹配({{ matched.length }} / {{ matches.length }})</h3>
      <div class="mods">
        <div v-for="(m, i) in matches" :key="i" class="mod" :class="{ hit: m.statId }">
          <span class="mark">{{ m.statId ? '✓' : '·' }}</span>
          <span class="text">{{ m.text }}</span>
          <span class="tag dim">{{ KIND_ZH[m.kind] ?? m.kind }}</span>
          <span v-if="m.statId" class="id dim">{{ m.statId }}</span>
          <span v-else class="id dim">未收录模板,不参与查询</span>
        </div>
      </div>
    </template>

    <template v-if="result">
      <h2>价格</h2>
      <div v-if="result.summary.priced" class="summary">
        <div class="stat">
          <span class="dim">最低</span>
          <b>{{ result.summary.min }} {{ result.summary.currency }}</b>
        </div>
        <div class="stat">
          <span class="dim">中位</span>
          <b>{{ result.summary.median }} {{ result.summary.currency }}</b>
        </div>
        <div class="stat">
          <span class="dim">最高</span>
          <b>{{ result.summary.max }} {{ result.summary.currency }}</b>
        </div>
        <div class="stat">
          <span class="dim">命中总数</span>
          <b>{{ result.total }}</b>
        </div>
      </div>

      <p class="dim note">
        以你这条词缀的数值为下限搜索(找"不低于此"的同类),共 {{ result.built.used.length }} 条词缀进入过滤<template
          v-if="result.built.skipped.length"
        >,{{ result.built.skipped.length }} 条未参与</template
        >。挂单来自官方实时数据,卖家是否在线以游戏内为准。
      </p>

      <div v-if="result.summary.byCurrency.length > 1" class="dim note">
        混合币种:{{ result.summary.byCurrency.map((c) => `${c.currency}×${c.count}`).join('、') }}(统计基于
        {{ result.summary.currency }})
      </div>

      <div v-if="result.summary.listings.length" class="listings">
        <div v-for="(l, i) in result.summary.listings" :key="i" class="listing">
          <span class="price">{{ l.amount }} {{ l.currency }}</span>
          <span class="name">{{ bilingual(l.name ?? l.typeLine) }}</span>
          <span class="dim">
            <template v-if="l.itemLevel">ilvl {{ l.itemLevel }} · </template>{{ l.modCount }} 词缀
            <template v-if="l.corrupted"> · 已腐化</template>
          </span>
        </div>
      </div>
      <p v-else class="dim note">
        这个条件没有在线挂单<template v-if="result.summary.unpriced">
          ({{ result.summary.unpriced }} 条挂单未标价)</template
        >,可以放宽词缀或换联赛再试。
      </p>

      <div class="btn-row">
        <button @click="copyQuery">{{ copied ? '已复制' : '复制查询 JSON' }}</button>
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
.notice {
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 12px;
  margin-bottom: 12px;
  line-height: 1.6;
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

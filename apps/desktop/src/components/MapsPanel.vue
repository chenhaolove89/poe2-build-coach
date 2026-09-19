<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import mapsJson from '@poe2coach/data/maps.json'
import topologyJson from '@poe2coach/data/map-topology.json'
import { bilingual, dialect, t, zhName } from '../i18n'
import MapTopology from './MapTopology.vue'

interface MapEntry {
  name: string
  navigation: number | null
  backtracking: number | null
  layout: 'linear' | 'open' | 'maze' | 'special'
  biomes: string[]
  recommended: string[]
  boss: string | null
}

const DATA = mapsJson as unknown as { source: string; maps: MapEntry[] }
const TOPOLOGY = (topologyJson as unknown as { maps: Record<string, string[]> }).maps

const LAYOUT_LABEL: Record<string, string> = {
  linear: '直线型',
  open: '开放型',
  maze: '迷宫型',
  special: '特殊区域',
}
const BIOME_LABEL: Record<string, string> = {
  Desert: '沙漠',
  'Ezomyte City': '埃佐米特城',
  'Faridun City': '法里顿城',
  Forest: '森林',
  Grass: '草原',
  Mountain: '山地',
  Swamp: '沼泽',
  'Vaal City': '瓦尔城',
  Water: '水域',
}
const MECH_LABEL: Record<string, string> = { Breach: '裂隙' }

// ------------------------------------------------------------------ favorites & notes

const FAV_KEY = 'poe2coach.maps.favorites'
const NOTES_KEY = 'poe2coach.maps.notes'

const favorites = ref<Set<string>>(loadSet(FAV_KEY))
const notes = ref<Record<string, string>>(loadNotes())

function loadSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function saveSet(key: string, set: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]))
  } catch {
    /* storage off — favourites just do not persist */
  }
}

function loadNotes(): Record<string, string> {
  try {
    const raw = localStorage.getItem(NOTES_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function toggleFav(name: string) {
  const next = new Set(favorites.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  favorites.value = next
  saveSet(FAV_KEY, next)
}

// ------------------------------------------------------------------ search & filters

const query = ref('')
const layoutFilter = ref<'all' | 'linear' | 'open' | 'maze' | 'special'>('all')
const favOnly = ref(false)

function matches(m: MapEntry): boolean {
  if (favOnly.value && !favorites.value.has(m.name)) return false
  if (layoutFilter.value !== 'all' && m.layout !== layoutFilter.value) return false
  const q = query.value.trim().toLowerCase()
  if (!q) return true
  // Matched against the variant on screen, so a 繁體 reader can type 繁體.
  return (
    m.name.toLowerCase().includes(q) ||
    (zhName(m.name) ?? '').includes(q) ||
    (m.boss ?? '').toLowerCase().includes(q) ||
    (zhName(m.boss) ?? '').includes(q)
  )
}

const isFiltering = computed(() => favOnly.value || layoutFilter.value !== 'all' || query.value.trim().length > 0)

interface MapGroup {
  key: 'linear' | 'open' | 'maze' | 'special'
  label: string
  maps: MapEntry[]
}

const GROUPS: MapGroup[] = (['linear', 'open', 'maze', 'special'] as const).map((key) => ({
  key,
  label: LAYOUT_LABEL[key],
  maps: DATA.maps.filter((m) => m.layout === key),
}))

const openGroups = ref<Set<string>>(
  new Set(GROUPS.filter((g) => g.key === 'linear' || g.key === 'open').map((g) => g.key)),
)

function toggleGroup(key: string) {
  const next = new Set(openGroups.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  openGroups.value = next
}

function visibleMaps(g: MapGroup): MapEntry[] {
  return g.maps.filter(matches)
}

// ------------------------------------------------------------------ detail overlay

const detail = ref<MapEntry | null>(null)
const variant = ref(0)
const noteDraft = ref('')

/** POE2WAY renders a handful of layout variants per map; not all maps are mapped. */
const variants = computed(() => (detail.value ? (TOPOLOGY[detail.value.name.toLowerCase()] ?? []) : []))
const currentSvg = computed(() => variants.value[variant.value] ?? null)

function openDetail(m: MapEntry) {
  detail.value = m
  variant.value = 0
  noteDraft.value = notes.value[m.name] ?? ''
}

function closeDetail() {
  detail.value = null
}

function saveNote() {
  if (!detail.value) return
  const next = { ...notes.value }
  if (noteDraft.value.trim()) next[detail.value.name] = noteDraft.value
  else delete next[detail.value.name]
  notes.value = next
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify(next))
  } catch {
    /* storage off */
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeDetail()
}

watch(detail, (value) => {
  if (value) window.addEventListener('keydown', onKeydown)
  else window.removeEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

// ------------------------------------------------------------------ display helpers

function navLabel(n: number | null): string {
  if (n == null) return '—'
  const stars = '★'.repeat(n) + '☆'.repeat(4 - n)
  return `${n} ${stars}`
}

function biomeZh(b: string): string {
  return BIOME_LABEL[b] ? t(BIOME_LABEL[b]) : dialect(b)
}

function mechLabel(r: string): string {
  return MECH_LABEL[r] ? t(MECH_LABEL[r]) : dialect(r)
}

const topoCount = computed(() => Object.keys(TOPOLOGY).length)
const favCount = computed(() => favorites.value.size)
</script>

<template>
  <div class="maps-wrap">
    <div class="summary card">
      <div class="sum-row">
        <span class="sum-item"><b class="gold">{{ DATA.maps.length }}</b> {{ t('个地区') }}</span>
        <span class="sum-item"><b class="blue">{{ topoCount }}</b> {{ t('张拓扑图') }}</span>
        <span class="sum-item">
          <b class="green">{{ DATA.maps.filter((m) => m.layout === 'linear').length }}</b> {{ t('直线') }}
          · <b class="blue2">{{ DATA.maps.filter((m) => m.layout === 'open').length }}</b> {{ t('开放') }}
          · <b class="orange">{{ DATA.maps.filter((m) => m.layout === 'maze').length }}</b> {{ t('迷宫') }}
        </span>
        <span class="sum-item">⭐ <b class="gold">{{ favCount }}</b> {{ t('张收藏') }}</span>
      </div>
      <p class="dim small">
        {{ t('跑图/回头路为 POE2WAY 社区评分(4 最好):直线型=沿主线推进,开放型=大面积开阔,迷宫型=岔路多易迷路。') }}
        {{ t('点⭐收藏常刷的图;点行看大图与笔记。') }}
      </p>
    </div>

    <div class="toolbar card">
      <input v-model="query" class="search" :placeholder="t('搜索地图或 Boss…')" spellcheck="false" />
      <label class="hd dim">
        <input v-model="favOnly" type="checkbox" />
        {{ t('只看收藏') }}
      </label>
      <div class="filters">
        <button
          v-for="opt in [['all', '全部'], ['linear', '直线型'], ['open', '开放型'], ['maze', '迷宫型'], ['special', '特殊']]"
          :key="opt[0]"
          class="filter"
          :class="{ active: layoutFilter === opt[0] }"
          @click="layoutFilter = opt[0] as typeof layoutFilter"
        >
          {{ t(opt[1]) }}
        </button>
      </div>
    </div>

    <div
      v-for="g in GROUPS"
      :key="g.key"
      v-show="!isFiltering || visibleMaps(g).length"
      class="group card"
      :class="{ open: openGroups.has(g.key) || isFiltering }"
    >
      <button class="group-head" @click="toggleGroup(g.key)">
        <span class="tri">{{ openGroups.has(g.key) || isFiltering ? '▾' : '▸' }}</span>
        <span class="group-name">{{ t(g.label) }}</span>
        <span class="dim count">
          {{ visibleMaps(g).length }} / {{ g.maps.length }}
        </span>
      </button>
      <p v-if="g.key === 'special' && (openGroups.has(g.key) || isFiltering)" class="dim small group-note">
        {{ t('这些地区布局没有统一规律(结构特殊或随变体差异大), 以拓扑图和实际进图为准。') }}
      </p>
      <div v-show="openGroups.has(g.key) || isFiltering" class="rows">
        <div
          v-for="m in visibleMaps(g)"
          :key="m.name"
          class="row-card"
          :class="{ fav: favorites.has(m.name) }"
          @click="openDetail(m)"
        >
          <button class="star" :class="{ on: favorites.has(m.name) }" :title="t('收藏')" @click.stop="toggleFav(m.name)">
            {{ favorites.has(m.name) ? '★' : '☆' }}
          </button>
          <div class="row-main">
            <div class="row-line">
              <span class="map-name">{{ bilingual(m.name) }}</span>
              <span v-if="favorites.has(m.name)" class="chip fav-chip">⭐</span>
              <span v-for="(mech, mi) in m.recommended.map(mechLabel)" :key="mi" class="chip mech-chip">{{ mech }}</span>
            </div>
            <div class="row-line dim">
              <span class="score">{{ t('跑图') }} {{ navLabel(m.navigation) }}</span>
              <span class="score">{{ t('回头') }} {{ navLabel(m.backtracking) }}</span>
              <span>{{ m.biomes.map(biomeZh).join(' / ') || '—' }}</span>
            </div>
            <div v-if="m.boss" class="row-boss">Boss:{{ bilingual(m.boss) }}</div>
            <div v-if="notes[m.name]" class="row-note dim">📝 {{ notes[m.name] }}</div>
          </div>
          <div v-if="TOPOLOGY[m.name.toLowerCase()]" class="thumb">
            <MapTopology :svg="TOPOLOGY[m.name.toLowerCase()][0]" :compact="true" />
          </div>
        </div>
      </div>
    </div>
    <div v-if="!GROUPS.some((g) => visibleMaps(g).length)" class="dim empty">{{ t('没有匹配的地图。') }}</div>
    <div class="source dim">{{ t('数据来源:POE2WAY(poe2way.com/atlas),评分为社区参考;拓扑图为社区手绘示意图。') }}</div>

    <div v-if="detail" class="overlay" @click.self="closeDetail">
      <div class="detail">
        <div class="detail-head">
          <div>
            <h2>
              <button class="star big" :class="{ on: favorites.has(detail.name) }" :title="t('收藏')" @click="toggleFav(detail.name)">
                {{ favorites.has(detail.name) ? '★' : '☆' }}
              </button>
              {{ bilingual(detail.name) }}
            </h2>
            <p class="dim sub">
              {{ t(LAYOUT_LABEL[detail.layout]) }} · {{ t('生态') }} {{ detail.biomes.map(biomeZh).join(' / ') || '—' }}
            </p>
          </div>
          <button class="close" :title="t('关闭(Esc)')" @click="closeDetail">✕</button>
        </div>

        <div class="detail-scores">
          <div class="dscore">
            <span class="dim">{{ t('跑图难度') }}</span>
            <b>{{ navLabel(detail.navigation) }}</b>
          </div>
          <div class="dscore">
            <span class="dim">{{ t('回头路') }}</span>
            <b>{{ navLabel(detail.backtracking) }}</b>
          </div>
          <div class="dscore">
            <span class="dim">{{ t('推荐机制') }}</span>
            <b>{{ detail.recommended.map(mechLabel).join(' / ') || '—' }}</b>
          </div>
        </div>

        <div v-if="detail.boss" class="detail-boss">
          <span class="dim">Boss</span> {{ bilingual(detail.boss) }}
        </div>

        <template v-if="currentSvg">
          <div class="topo-tabs">
            <button
              v-for="(_, i) in variants"
              :key="i"
              class="tab"
              :class="{ active: i === variant }"
              @click="variant = i"
            >
              {{ t('布局') }} {{ i + 1 }}
            </button>
            <span class="dim tab-note">{{ t('共') }} {{ variants.length }} {{ t('种布局变体') }}</span>
          </div>
          <MapTopology v-if="currentSvg" :svg="currentSvg" />
          <p class="dim topo-note">
            {{ t('社区手绘拓扑(官方风格重绘):绿=入口,蓝=节点,紫=特殊,红=Boss(常在最远端)。同一地区进去的固定是其中一种变体。') }}
          </p>
        </template>
        <p v-else class="dim topo-missing">{{ t('社区暂未收录该地区的拓扑图,可参考布局类型判断走法。') }}</p>

        <div class="detail-note">
          <label class="dim small">{{ t('我的笔记') }}</label>
          <textarea
            v-model="noteDraft"
            class="note-text"
            rows="2"
            :placeholder="t('记一点自己的心得, 自动保存')"
            @input="saveNote"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.maps-wrap {
  max-width: 960px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.card {
  background: #10131b;
  border: 1px solid #232939;
  border-radius: 8px;
}
.summary {
  padding: 12px 14px;
}
.sum-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  font-size: 12px;
  color: #9aa3bd;
  margin-bottom: 6px;
}
.sum-item b {
  font-size: 13px;
}
.gold {
  color: #e8b04b;
}
.blue {
  color: #7aa5d9;
}
.blue2 {
  color: #5aa0d0;
}
.green {
  color: #7dd087;
}
.orange {
  color: #e0885a;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 10px 14px;
}
.search {
  flex: 1 1 200px;
  min-width: 180px;
  background: #0b0d12;
  border: 1px solid #2c3244;
  border-radius: 6px;
  color: #cfd4e4;
  font-size: 12px;
  padding: 6px 10px;
}
.search:focus {
  outline: none;
  border-color: #4a3d20;
}
.hd {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.filters {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.filter {
  background: #1a1f2c;
  border: 1px solid #2c3244;
  color: #8a93ad;
  border-radius: 12px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.filter.active {
  color: #e8b04b;
  border-color: #e8b04b;
}
.group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  background: none;
  border: none;
  color: #cfd4e4;
  padding: 10px 14px;
  cursor: pointer;
  text-align: left;
}
.group-head:hover .group-name {
  color: #e8b04b;
}
.tri {
  color: #6b7390;
  font-size: 12px;
}
.group-name {
  font-size: 14px;
  font-weight: 600;
}
.count {
  margin-left: auto;
  font-size: 12px;
}
.group-note {
  padding: 0 14px 8px 32px;
  margin: 0;
}
.rows {
  border-top: 1px solid #1a1f2c;
}
.row-card {
  display: flex;
  gap: 10px;
  padding: 9px 14px;
  border-bottom: 1px solid #141826;
  cursor: pointer;
  align-items: flex-start;
}
.row-card:hover {
  background: #121623;
}
.row-card.fav {
  background: #13161f;
}
.star {
  flex: 0 0 22px;
  background: none;
  border: none;
  color: #4a5270;
  font-size: 15px;
  cursor: pointer;
  padding: 0;
  line-height: 1.3;
}
.star.on {
  color: #e8b04b;
}
.row-main {
  flex: 1;
  min-width: 0;
}
.row-line {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  align-items: baseline;
}
.map-name {
  font-size: 13px;
  font-weight: 600;
  color: #e8b04b;
}
.score {
  font-size: 11px;
  color: #9aa3bd;
  white-space: nowrap;
}
.row-boss {
  font-size: 11px;
  color: #d9a441;
  margin-top: 2px;
}
.row-note {
  font-size: 11px;
  margin-top: 2px;
  color: #c9c0a0;
}
.chip {
  font-size: 10px;
  border-radius: 8px;
  padding: 0 7px;
  line-height: 16px;
  border: 1px solid #2c3244;
  color: #9aa3bd;
  white-space: nowrap;
}
.mech-chip {
  color: #6fa8dc;
  border-color: #2c4258;
}
.fav-chip {
  border: none;
  padding: 0;
}
.thumb {
  flex: 0 0 118px;
  height: 78px;
  background: #080a0f;
  border: 1px solid #1d2331;
  border-radius: 6px;
  overflow: hidden;
  align-self: center;
}
.thumb :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
.empty {
  padding: 20px 0;
}
.source {
  font-size: 11px;
}
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(4, 6, 10, 0.78);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  z-index: 50;
}
.detail {
  background: #0e1119;
  border: 1px solid #2c3244;
  border-radius: 12px;
  padding: 18px 20px 20px;
  width: min(720px, 100%);
  max-height: 86vh;
  overflow-y: auto;
}
.detail-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.detail-head h2 {
  font-size: 18px;
  color: #e8b04b;
  display: flex;
  align-items: center;
  gap: 8px;
}
.star.big {
  font-size: 20px;
}
.sub {
  font-size: 12px;
  margin-top: 2px;
}
.close {
  background: transparent;
  border: 1px solid #2c3244;
  color: #8a93ad;
  border-radius: 6px;
  width: 28px;
  height: 28px;
  cursor: pointer;
}
.close:hover {
  color: #e8b04b;
  border-color: #e8b04b;
}
.detail-scores {
  display: flex;
  gap: 24px;
  margin: 14px 0 6px;
  flex-wrap: wrap;
}
.dscore {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
}
.detail-boss {
  font-size: 13px;
  color: #d9a441;
  margin-bottom: 12px;
}
.topo-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 0 8px;
  flex-wrap: wrap;
}
.tab {
  background: #1a1f2c;
  border: 1px solid #2c3244;
  color: #8a93ad;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.tab.active {
  color: #e8b04b;
  border-color: #e8b04b;
}
.tab-note {
  font-size: 11px;
  margin-left: auto;
}
.topo {
  background: #080a0f;
  border: 1px solid #1d2331;
  border-radius: 8px;
  padding: 10px;
  height: 340px;
}
.topo :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
.topo-note,
.topo-missing {
  font-size: 11px;
  margin-top: 8px;
  line-height: 1.6;
}
.topo-missing {
  padding: 18px 0;
}
.detail-note {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.note-text {
  width: 100%;
  box-sizing: border-box;
  background: #0b0d12;
  border: 1px solid #2c3244;
  border-radius: 6px;
  color: #c9c0a0;
  font-size: 12px;
  padding: 6px 8px;
  resize: vertical;
}
.note-text:focus {
  outline: none;
  border-color: #4a3d20;
}
</style>

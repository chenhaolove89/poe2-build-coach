<script setup lang="ts">
/**
 * 地图页 —— the endgame area table.
 *
 * The table is keyed by the game's area *code* (`MapDeforestation`), not by name,
 * for two reasons that both bite in practice: names repeat (seven areas are called
 * "Precursor Tower") and the code cannot be derived from the name (`MapSavanna` is
 * "Savannah"). That code is also what the client log writes, so it is the key the
 * 刷图 page joins on — a map starred here is the same map measured there.
 *
 * Favourites and notes are stored under the code, falling back to the name so a
 * favourite set saved before this table existed still lights up.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import topologyJson from '@poe2coach/data/map-topology.json'
import type { MapArea, MapKind, MapLayout } from '@poe2coach/core'
import {
  AREAS,
  AREA_CAPTURED,
  AREA_SOURCE,
  KIND_LABEL,
  KIND_ORDER,
  LAYOUT_LABEL,
  LAYOUT_ORDER,
} from '../mapData'
import { bilingual, dialect, t, zhName } from '../i18n'
import MapTopology from './MapTopology.vue'

const emit = defineEmits<{ openAtlas: [biome: string] }>()

const TOPOLOGY = (topologyJson as unknown as { maps: Record<string, string[]> }).maps

const BIOME_LABEL: Record<string, string> = {
  Desert: '沙漠',
  'Ezomyte City': '埃佐米特城',
  'Faridun City': '法里顿城',
  Forest: '森林',
  Grass: '草原',
  Mountain: '山地',
  Ocean: '海洋',
  Swamp: '沼泽',
  'Vaal City': '瓦尔城',
  Water: '水域',
}

// ------------------------------------------------------------------ favorites & notes

const FAV_KEY = 'poe2coach.maps.favorites'
const NOTES_KEY = 'poe2coach.maps.notes'

const favorites = ref<Set<string>>(loadSet(FAV_KEY))
const notes = ref<Record<string, string>>(loadNotes())

/** Stable storage key: the code when there is one, the name otherwise. */
function areaKey(a: MapArea): string {
  return a.code ?? a.name
}

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

/** A favourite saved under the bare name (before the table had codes) still counts. */
function isFav(a: MapArea): boolean {
  return favorites.value.has(areaKey(a)) || favorites.value.has(a.name)
}

function toggleFav(a: MapArea) {
  const next = new Set(favorites.value)
  const key = areaKey(a)
  if (next.has(key) || next.has(a.name)) {
    next.delete(key)
    next.delete(a.name)
  } else {
    next.add(key)
  }
  favorites.value = next
  saveSet(FAV_KEY, next)
}

function noteFor(a: MapArea): string {
  return notes.value[areaKey(a)] ?? notes.value[a.name] ?? ''
}

// ------------------------------------------------------------------ search & filters

const query = ref('')
const kindFilter = ref<'all' | MapKind>('map')
const layoutFilter = ref<'all' | MapLayout>('all')
const favOnly = ref(false)

function matches(m: MapArea): boolean {
  if (favOnly.value && !isFav(m)) return false
  if (kindFilter.value !== 'all' && m.kind !== kindFilter.value) return false
  if (layoutFilter.value !== 'all' && m.layout !== layoutFilter.value) return false
  const q = query.value.trim().toLowerCase()
  if (!q) return true
  // Matched against the variant on screen, so a 繁體 reader can type 繁體. The area
  // code is searchable too — it is what the log and the 刷图 page speak in.
  return (
    m.name.toLowerCase().includes(q) ||
    (m.code ?? '').toLowerCase().includes(q) ||
    (zhName(m.name) ?? '').includes(q) ||
    (m.boss ?? '').toLowerCase().includes(q) ||
    (zhName(m.boss) ?? '').includes(q)
  )
}

const filtered = computed(() => AREAS.filter(matches))

const groups = computed(() =>
  LAYOUT_ORDER.map((key) => ({
    key,
    label: LAYOUT_LABEL[key],
    areas: filtered.value.filter((a) => a.layout === key),
  })).filter((g) => g.areas.length > 0),
)

const openGroups = ref<Set<string>>(new Set(['linear', 'open']))

function toggleGroup(key: string) {
  const next = new Set(openGroups.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  openGroups.value = next
}

const isFiltering = computed(
  () => favOnly.value || layoutFilter.value !== 'all' || kindFilter.value !== 'map' || query.value.trim().length > 0,
)

const kindCounts = computed(() => {
  const counts = new Map<MapKind, number>()
  for (const a of AREAS) counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1)
  return counts
})

// ------------------------------------------------------------------ detail overlay

const detail = ref<MapArea | null>(null)
const variant = ref(0)
const noteDraft = ref('')

/** POE2WAY renders a handful of layout variants per map; not all maps are mapped. */
const variants = computed(() => (detail.value ? (TOPOLOGY[detail.value.name.toLowerCase()] ?? []) : []))
const currentSvg = computed(() => variants.value[variant.value] ?? null)

function openDetail(m: MapArea) {
  detail.value = m
  variant.value = 0
  noteDraft.value = noteFor(m)
}

function closeDetail() {
  detail.value = null
}

function saveNote() {
  if (!detail.value) return
  const next = { ...notes.value }
  const key = areaKey(detail.value)
  if (noteDraft.value.trim()) next[key] = noteDraft.value
  else delete next[key]
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

const topoCount = computed(() => Object.keys(TOPOLOGY).length)
const favCount = computed(() => favorites.value.size)
const mapCount = computed(() => AREAS.filter((a) => a.kind === 'map').length)
const ratedCount = computed(() => AREAS.filter((a) => a.kind === 'map' && a.navigation != null).length)
</script>

<template>
  <div class="maps-wrap">
    <div class="summary card">
      <div class="sum-row">
        <span class="sum-item"><b class="gold">{{ mapCount }}</b> {{ t('张可刷图') }}</span>
        <span class="sum-item"><b class="blue">{{ AREAS.length }}</b> {{ t('个地区') }}</span>
        <span class="sum-item"><b class="green">{{ topoCount }}</b> {{ t('张拓扑图') }}</span>
        <span class="sum-item">
          <b class="blue2">{{ ratedCount }}</b> {{ t('张有社区评分') }}
        </span>
        <span class="sum-item">⭐ <b class="gold">{{ favCount }}</b> {{ t('张收藏') }}</span>
      </div>
      <p class="dim small">
        {{ t('跑图/回头路为 POE2WAY 社区评分(4 最好):直线型=沿主线推进,开放型=大面积开阔,环形回绕=一圈走完不折返。') }}
        {{ t('点⭐收藏常刷的图;点行看大图与笔记。收藏按区域码记录,和刷图页的统计对得上。') }}
      </p>
    </div>

    <div class="toolbar card">
      <input v-model="query" class="search" :placeholder="t('搜索地图名 / Boss / 区域码…')" spellcheck="false" />
      <label class="hd dim">
        <input v-model="favOnly" type="checkbox" />
        {{ t('只看收藏') }}
      </label>
      <div class="filters">
        <button
          class="filter"
          :class="{ active: kindFilter === 'all' }"
          @click="kindFilter = 'all'"
        >
          {{ t('全部') }} {{ AREAS.length }}
        </button>
        <button
          v-for="k in KIND_ORDER"
          :key="k"
          class="filter"
          :class="{ active: kindFilter === k }"
          @click="kindFilter = k"
        >
          {{ t(KIND_LABEL[k]) }} {{ kindCounts.get(k) ?? 0 }}
        </button>
      </div>
      <div class="filters">
        <button class="filter" :class="{ active: layoutFilter === 'all' }" @click="layoutFilter = 'all'">
          {{ t('全部布局') }}
        </button>
        <button
          v-for="l in LAYOUT_ORDER"
          :key="l"
          class="filter"
          :class="{ active: layoutFilter === l }"
          @click="layoutFilter = l"
        >
          {{ t(LAYOUT_LABEL[l]) }}
        </button>
      </div>
    </div>

    <div
      v-for="g in groups"
      :key="g.key"
      v-show="!isFiltering || g.areas.length"
      class="group card"
      :class="{ open: openGroups.has(g.key) || isFiltering }"
    >
      <button class="group-head" @click="toggleGroup(g.key)">
        <span class="tri">{{ openGroups.has(g.key) || isFiltering ? '▾' : '▸' }}</span>
        <span class="group-name">{{ t(g.label) }}</span>
        <span class="dim count">{{ g.areas.length }}</span>
      </button>
      <p v-if="g.key === 'unknown' && (openGroups.has(g.key) || isFiltering)" class="dim small group-note">
        {{ t('社区还没有这些图布局的描述,这里如实留白 —— 不猜。以进图实际走法为准,顺手可记在笔记里。') }}
      </p>
      <p v-if="g.key === 'special' && (openGroups.has(g.key) || isFiltering)" class="dim small group-note">
        {{ t('传奇图/堡垒/首领场地/塔/藏身处等,不是普通可刷图,按需查看。') }}
      </p>
      <div v-show="openGroups.has(g.key) || isFiltering" class="rows">
        <div
          v-for="m in g.areas"
          :key="areaKey(m)"
          class="row-card"
          :class="{ fav: isFav(m) }"
          @click="openDetail(m)"
        >
          <button class="star" :class="{ on: isFav(m) }" :title="t('收藏')" @click.stop="toggleFav(m)">
            {{ isFav(m) ? '★' : '☆' }}
          </button>
          <div class="row-main">
            <div class="row-line">
              <span class="map-name">{{ bilingual(m.name) }}</span>
              <span v-if="isFav(m)" class="chip fav-chip">⭐</span>
              <span v-if="m.kind !== 'map'" class="chip kind-chip">{{ t(KIND_LABEL[m.kind]) }}</span>
              <span class="chip code-chip">{{ m.code ?? t('未收录') }}</span>
            </div>
            <div class="row-line dim">
              <span class="score">{{ t('跑图') }} {{ navLabel(m.navigation) }}</span>
              <span class="score">{{ t('回头') }} {{ navLabel(m.backtracking) }}</span>
              <span>{{ m.biomes.map(biomeZh).join(' / ') || '—' }}</span>
            </div>
            <div v-if="m.boss" class="row-boss">Boss:{{ bilingual(m.boss) }}</div>
            <div v-if="noteFor(m)" class="row-note dim">📝 {{ noteFor(m) }}</div>
          </div>
          <div v-if="TOPOLOGY[m.name.toLowerCase()]" class="thumb">
            <MapTopology :svg="TOPOLOGY[m.name.toLowerCase()][0]" :compact="true" />
          </div>
        </div>
      </div>
    </div>
    <div v-if="!groups.length" class="dim empty">{{ t('没有匹配的地区。') }}</div>
    <div class="source dim">
      {{
        t(
          '数据来源:PoB2 WorldAreas.lua(区域码与 Boss) + poe2wiki 地图表(生态与布局描述) + POE2WAY(社区评分,拓扑为社区手绘示意图)。',
        )
      }}
      <span class="raw-source" :title="AREA_SOURCE">{{ t('采集于') }} {{ AREA_CAPTURED }}</span>
    </div>

    <div v-if="detail" class="overlay" @click.self="closeDetail">
      <div class="detail">
        <div class="detail-head">
          <div>
            <h2>
              <button class="star big" :class="{ on: isFav(detail) }" :title="t('收藏')" @click="toggleFav(detail)">
                {{ isFav(detail) ? '★' : '☆' }}
              </button>
              {{ bilingual(detail.name) }}
            </h2>
            <p class="dim sub">
              {{ t(KIND_LABEL[detail.kind]) }} · {{ t(LAYOUT_LABEL[detail.layout]) }} · {{ t('生态') }}
              {{ detail.biomes.map(biomeZh).join(' / ') || '—' }}
            </p>
            <p class="dim sub code-line">
              {{ t('区域码') }} <code>{{ detail.code ?? t('未收录') }}</code>
              <span class="dim"> {{ t('（刷图页按它归账）') }}</span>
            </p>
          </div>
          <button class="close" :title="t('关闭(Esc)')" @click="closeDetail">✕</button>
        </div>

        <div v-if="detail.biomes.length" class="detail-atlas">
          <span class="dim small">{{ t('异界天赋里有一批节点只对特定生态生效:') }}</span>
          <button
            v-for="b in detail.biomes"
            :key="b"
            class="atlas-link"
            :title="t('在异界页按这个生态筛选节点')"
            @click="emit('openAtlas', b)"
          >
            {{ biomeZh(b) }} → {{ t('看异界节点') }}
          </button>
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
            <span class="dim">{{ t('布局') }}</span>
            <b>{{ t(LAYOUT_LABEL[detail.layout]) }}</b>
          </div>
        </div>

        <div v-if="detail.boss" class="detail-boss">
          <span class="dim">Boss</span> {{ bilingual(detail.boss) }}
        </div>

        <p v-if="detail.note" class="detail-note-prose">
          <span class="dim">{{ t('社区描述') }}</span> {{ detail.note }}
        </p>

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
.kind-chip {
  color: #c98fd0;
  border-color: #4a3050;
}
.code-chip {
  color: #6b7390;
  font-family: ui-monospace, Consolas, monospace;
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
  line-height: 1.6;
}
.raw-source {
  margin-left: 6px;
  color: #4a5270;
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
.code-line code {
  color: #9fb4d8;
  background: #141a26;
  border: 1px solid #232939;
  border-radius: 4px;
  padding: 0 5px;
  font-size: 11px;
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
.detail-atlas {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 8px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid #1a1f2c;
}
.atlas-link {
  background: #1a1f2c;
  border: 1px solid #2c3244;
  color: #7aa5d9;
  border-radius: 10px;
  padding: 3px 9px;
  font-size: 11px;
  cursor: pointer;
}
.atlas-link:hover {
  color: #e8b04b;
  border-color: #e8b04b;
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
.detail-note-prose {
  font-size: 12px;
  color: #c9c0a0;
  line-height: 1.6;
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

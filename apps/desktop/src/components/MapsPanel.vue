<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import mapsJson from '@poe2coach/data/maps.json'
import topologyJson from '@poe2coach/data/map-topology.json'
import { nameZh, nameZhThenEn } from '../nameZh'

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

const query = ref('')
const layoutFilter = ref<'all' | 'linear' | 'open' | 'maze' | 'special'>('all')
const detail = ref<MapEntry | null>(null)
const variant = ref(0)

const filtered = computed(() =>
  DATA.maps.filter((m) => {
    if (layoutFilter.value !== 'all' && m.layout !== layoutFilter.value) return false
    const q = query.value.trim().toLowerCase()
    if (!q) return true
    return (
      m.name.toLowerCase().includes(q) ||
      (nameZh(m.name) ?? '').includes(q) ||
      (m.boss ?? '').toLowerCase().includes(q) ||
      (nameZh(m.boss) ?? '').includes(q)
    )
  }),
)

function navLabel(n: number | null): string {
  if (n == null) return '—'
  const stars = '★'.repeat(n) + '☆'.repeat(4 - n)
  return `${n} ${stars}`
}

function biomeZh(b: string): string {
  return BIOME_LABEL[b] ?? b
}

function bilingual(en: string): string {
  return nameZhThenEn(en)
}

/** POE2WAY renders a handful of layout variants per map; not all maps are mapped. */
const variants = computed(() => (detail.value ? (TOPOLOGY[detail.value.name.toLowerCase()] ?? []) : []))
const currentSvg = computed(() => variants.value[variant.value] ?? null)

function openDetail(m: MapEntry) {
  detail.value = m
  variant.value = 0
}

function closeDetail() {
  detail.value = null
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeDetail()
}

watch(detail, (value) => {
  if (value) window.addEventListener('keydown', onKeydown)
  else window.removeEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="maps-wrap">
    <div class="meta dim">
      共 {{ DATA.maps.length }} 个地区 · 跑图/回头路为 POE2WAY 社区评分(4 最好)。布局:直线型=沿主线推进,开放型=大面积开阔,迷宫型=岔路多易迷路。点开卡片看地区拓扑。
    </div>

    <div class="controls">
      <input v-model="query" class="search" placeholder="搜索地图或 Boss…" spellcheck="false" />
      <div class="filters">
        <button
          v-for="opt in [['all', '全部'], ['linear', '直线型'], ['open', '开放型'], ['maze', '迷宫型'], ['special', '特殊']]"
          :key="opt[0]"
          class="filter"
          :class="{ active: layoutFilter === opt[0] }"
          @click="layoutFilter = opt[0] as typeof layoutFilter"
        >
          {{ opt[1] }}
        </button>
      </div>
    </div>

    <div class="map-grid">
      <div
        v-for="m in filtered"
        :key="m.name"
        class="map-card"
        :class="{ mapped: !!TOPOLOGY[m.name.toLowerCase()] }"
        @click="openDetail(m)"
      >
        <div class="map-head">
          <span class="map-name">{{ bilingual(m.name) }}</span>
          <span class="layout-badge" :class="m.layout">{{ LAYOUT_LABEL[m.layout] }}</span>
        </div>
        <div v-if="m.layout !== 'special'" class="scores">
          <span class="score" title="跑图难度(4=最容易)">跑图 {{ navLabel(m.navigation) }}</span>
          <span class="score" title="回头路程度(4=几乎不回头)">回头 {{ navLabel(m.backtracking) }}</span>
        </div>
        <div class="row dim">生态:{{ m.biomes.map(biomeZh).join(' / ') || '—' }}</div>
        <div v-if="m.boss" class="row boss">Boss:{{ bilingual(m.boss) }}</div>
        <div v-if="m.recommended.length" class="row mech">
          推荐机制:{{ m.recommended.map((r) => MECH_LABEL[r] ?? r).join(' / ') }}
        </div>
        <div class="open-hint">{{ TOPOLOGY[m.name.toLowerCase()] ? '查看拓扑 →' : '查看详情 →' }}</div>
      </div>
    </div>
    <div v-if="!filtered.length" class="dim empty">没有匹配的地图。</div>
    <div class="source dim">数据来源:POE2WAY(poe2way.com/atlas),评分为社区参考;拓扑图为社区手绘示意图。</div>

    <div v-if="detail" class="overlay" @click.self="closeDetail">
      <div class="detail">
        <div class="detail-head">
          <div>
            <h2>{{ bilingual(detail.name) }}</h2>
            <p class="dim sub">
              {{ LAYOUT_LABEL[detail.layout] }} · 生态 {{ detail.biomes.map(biomeZh).join(' / ') || '—' }}
            </p>
          </div>
          <button class="close" title="关闭(Esc)" @click="closeDetail">✕</button>
        </div>

        <div class="detail-scores">
          <div class="dscore">
            <span class="dim">跑图难度</span>
            <b>{{ navLabel(detail.navigation) }}</b>
          </div>
          <div class="dscore">
            <span class="dim">回头路</span>
            <b>{{ navLabel(detail.backtracking) }}</b>
          </div>
          <div class="dscore">
            <span class="dim">推荐机制</span>
            <b>{{ detail.recommended.map((r) => MECH_LABEL[r] ?? r).join(' / ') || '—' }}</b>
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
              布局 {{ i + 1 }}
            </button>
            <span class="dim tab-note">共 {{ variants.length }} 种布局变体</span>
          </div>
          <div class="topo" v-html="currentSvg" />
          <p class="dim topo-note">
            社区手绘拓扑:圆点=房间/节点,连线=通路。同一地区进去的固定是其中一种变体。
          </p>
        </template>
        <p v-else class="dim topo-missing">社区暂未收录该地区的拓扑图,可参考布局类型判断走法。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.maps-wrap {
  max-width: 860px;
}
.meta {
  margin-bottom: 12px;
  line-height: 1.6;
}
.controls {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.search {
  flex: 1;
  min-width: 220px;
  background: #0b0d12;
  color: #cfd4e4;
  border: 1px solid #2c3244;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 13px;
}
.search:focus {
  outline: none;
  border-color: #e8b04b;
}
.filters {
  display: flex;
  gap: 4px;
}
.filter {
  background: #1a1f2c;
  border: 1px solid #2c3244;
  color: #8a93ad;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
}
.filter.active {
  color: #e8b04b;
  border-color: #e8b04b;
}
.map-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 10px;
}
.map-card {
  background: #10131b;
  border: 1px solid #232939;
  border-radius: 8px;
  padding: 10px 12px;
  cursor: pointer;
  transition: border-color 0.12s ease, transform 0.12s ease;
}
.map-card:hover {
  border-color: #3b4459;
}
.map-card.mapped .open-hint {
  color: #e8b04b;
}
.open-hint {
  margin-top: 8px;
  font-size: 11px;
  color: #6b7387;
}
.map-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.map-name {
  font-size: 14px;
  color: #e8b04b;
  font-weight: 600;
}
.layout-badge {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 8px;
  border: 1px solid #2c3244;
  color: #8a93ad;
}
.layout-badge.linear {
  color: #7dd087;
  border-color: #2f4a38;
}
.layout-badge.open {
  color: #5aa0d0;
  border-color: #2c4258;
}
.layout-badge.maze {
  color: #e0885a;
  border-color: #4a352c;
}
.scores {
  display: flex;
  gap: 12px;
  margin-bottom: 4px;
}
.score {
  font-size: 11px;
  color: #cfd4e4;
}
.row {
  font-size: 11px;
  margin-top: 2px;
}
.boss {
  color: #d9a441;
}
.mech {
  color: #6fa8dc;
}
.empty {
  padding: 20px 0;
}
.source {
  margin-top: 16px;
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
</style>

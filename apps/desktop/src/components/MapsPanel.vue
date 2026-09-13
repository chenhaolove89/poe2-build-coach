<script setup lang="ts">
import { computed, ref } from 'vue'
import mapsJson from '@poe2coach/data/maps.json'
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
</script>

<template>
  <div class="maps-wrap">
    <div class="meta dim">
      共 {{ DATA.maps.length }} 个地区 · 跑图/回头路为 POE2WAY 社区评分(4 最好)。布局:直线型=沿主线推进,开放型=大面积开阔,迷宫型=岔路多易迷路。
    </div>

    <div class="controls">
      <input v-model="query" class="search" placeholder="搜索地图或 Boss…" spellcheck="false" />
      <div class="filters">
        <button
          v-for="opt in [
            ['all', '全部'],
            ['linear', '直线型'],
            ['open', '开放型'],
            ['maze', '迷宫型'],
            ['special', '特殊'],
          ]"
          :key="opt[0]"
          class="filter"
          :class="{ active: layoutFilter === opt[0] }"
          @click="layoutFilter = opt[0] as any"
        >
          {{ opt[1] }}
        </button>
      </div>
    </div>

    <div class="map-grid">
      <div v-for="m in filtered" :key="m.name" class="map-card">
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
      </div>
    </div>
    <div v-if="!filtered.length" class="dim empty">没有匹配的地图。</div>
    <div class="source dim">数据来源:POE2WAY(poe2way.com/atlas),评分为社区参考。</div>
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
</style>

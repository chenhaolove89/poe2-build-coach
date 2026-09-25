<script setup lang="ts">
/**
 * 按图统计 —— which map the money actually came from.
 *
 * This is the half of 刷图策略 that nobody else can produce. There is no
 * authoritative PoE2 map tier list and no credible per-hour figure for any
 * farming strategy, so importing advice would mean inventing it. What the app
 * does have is the player's own runs: the log's timeline joined to the ledger's
 * money by area code, grouped per map.
 *
 * Every figure here is a measurement, and the page says so out loud — a map run
 * once is a sample of one, a run whose code is not in the table is flagged
 * rather than dropped, and income the rates could not price is counted instead
 * of being read as zero.
 */
import { computed, ref } from 'vue'
import { REFERENCE_CURRENCY, type MapRunSummary } from '@poe2coach/core'
import { LAYOUT_LABEL } from '../mapData'
import { currencyName, t } from '../i18n'
import { measuredRatesNote, measuredRows } from '../farmMeasured'
import { requestMapDetail } from '../mapFocus'

const props = defineProps<{
  labels: Record<string, string>
}>()

const emit = defineEmits<{ openMap: [code: string] }>()

type SortKey = 'net' | 'perRun' | 'perHour' | 'runs'

const sortKey = ref<SortKey>('net')

/** The shared singleton computes these from the live session; the page sorts. */
const rows = measuredRows

const sorted = computed(() => {
  const list = [...rows.value]
  const key = sortKey.value
  list.sort((a, b) => {
    const av = a[key]
    const bv = b[key]
    // A row with nothing to divide by sorts last rather than being treated as zero.
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    return bv - av
  })
  return list
})

const unknownCount = computed(() => rows.value.filter((r) => !r.known).length)
const unpricedCount = computed(() => rows.value.reduce((sum, r) => sum + r.unpriced, 0))
const totalRuns = computed(() => rows.value.reduce((sum, r) => sum + r.runs, 0))

// ------------------------------------------------------------------ display

const reference = computed(() => currencyName(REFERENCE_CURRENCY, props.labels))

function amount(value: number | null): string {
  if (value == null) return '—'
  const abs = Math.abs(value)
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2
  return value.toFixed(digits)
}

function duration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function levelsOf(row: MapRunSummary): string {
  if (row.levels.length === 0) return '—'
  return row.levels.join('/')
}

/** The name the player's own client showed, when it differs from the table's. */
function clientAlias(row: MapRunSummary): string | null {
  return row.clientName && row.clientName !== row.name ? row.clientName : null
}

/** The layout in the reader's words, or nothing when the table has no answer. */
function layoutLabel(row: MapRunSummary): string | null {
  if (!row.layout) return null
  return t(LAYOUT_LABEL[row.layout])
}

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'net', label: '净收益' },
  { key: 'perRun', label: '每图' },
  { key: 'perHour', label: '每小时' },
  { key: 'runs', label: '次数' },
]
</script>

<template>
  <div class="map-stats">
    <div class="head">
      <h3>{{ t('按图统计') }}</h3>
      <span class="dim small">
        {{ t('本场刷了') }} {{ totalRuns }} {{ t('张图,') }}{{ rows.length }} {{ t('个不同地区') }}
      </span>
      <span class="spacer" />
      <span class="dim small">{{ t('排序') }}</span>
      <button
        v-for="s in SORTS"
        :key="s.key"
        class="sort"
        :class="{ active: sortKey === s.key }"
        @click="sortKey = s.key"
      >
        {{ t(s.label) }}
      </button>
    </div>

    <p v-if="rows.length === 0" class="dim small empty">
      {{ t('还没有刷到地图。开始记录后,每张图的收益会按区域码自动归到这里。') }}
    </p>

    <template v-else>
      <table class="tbl">
        <thead>
          <tr>
            <th class="name-col">{{ t('地图') }}</th>
            <th>{{ t('次数') }}</th>
            <th>{{ t('净收益') }}</th>
            <th>{{ t('每图') }}</th>
            <th>{{ t('每小时') }}</th>
            <th>{{ t('均时') }}</th>
            <th>{{ t('等级') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in sorted"
            :key="r.code ?? r.clientName"
            :class="{ routable: r.code }"
            :title="r.code ? t('点开在地图页看这张图的布局与笔记') : undefined"
            @click="r.code && emit('openMap', r.code)"
          >
            <td class="name-col">
              <span class="map-name">{{ r.name }}</span>
              <span v-if="clientAlias(r)" class="alias dim">{{ clientAlias(r) }}</span>
              <span v-if="!r.known" class="flag unknown" :title="t('地图表里没有这个区域码')">表外</span>
              <span v-if="layoutLabel(r)" class="chip">{{ layoutLabel(r) }}</span>
            </td>
            <td class="num">{{ r.runs }}</td>
            <td class="num strong">{{ amount(r.net) }}</td>
            <td class="num">{{ amount(r.perRun) }}</td>
            <td class="num">{{ amount(r.perHour) }}</td>
            <td class="num dim">{{ duration(r.netMs / Math.max(1, r.runs)) }}</td>
            <td class="num dim">{{ levelsOf(r) }}</td>
          </tr>
        </tbody>
      </table>

      <p class="dim small note">
        {{ t('单位为') }}{{ reference }}{{ t(',只计汇率覆盖到的账目。') }}
        <template v-if="unpricedCount > 0">
          {{ unpricedCount }}{{ t('条账目没有汇率,未计入 —— 不猜。') }}
        </template>
        <template v-if="unknownCount > 0">
          {{ unknownCount }}{{ t('个地区不在地图表里(标「表外」),已照常统计,可在「地图」页核对。') }}
        </template>
      </p>
      <p v-if="measuredRatesNote" class="dim small note">{{ measuredRatesNote }}</p>
      <p class="dim small note">
        {{ t('「次数」是样本量:只刷过一次的图,收益说明不了什么。「等级」混着不同等级时,均值为混合样本。') }}
      </p>
    </template>
  </div>
</template>

<style scoped>
.map-stats {
  margin-top: 14px;
  border-top: 1px solid #1a1f2c;
  padding-top: 12px;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.head h3 {
  font-size: 13px;
  color: #cfd4e4;
  font-weight: 600;
}
.spacer {
  flex: 1;
}
.sort {
  background: #1a1f2c;
  border: 1px solid #2c3244;
  color: #8a93ad;
  border-radius: 10px;
  padding: 2px 9px;
  font-size: 11px;
  cursor: pointer;
}
.sort.active {
  color: #e8b04b;
  border-color: #e8b04b;
}
.empty {
  padding: 10px 0;
}
.tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.tbl th {
  text-align: right;
  font-weight: 500;
  color: #6b7390;
  font-size: 11px;
  padding: 4px 8px;
  border-bottom: 1px solid #232939;
  white-space: nowrap;
}
.tbl th.name-col {
  text-align: left;
}
/* Rows whose area code is in the map table open that map's detail on click. */
.tbl tr.routable {
  cursor: pointer;
}
.tbl tr.routable:hover td {
  background: rgba(126, 224, 163, 0.06);
}
.tbl td {
  padding: 6px 8px;
  border-bottom: 1px solid #141826;
  color: #cfd4e4;
}
.tbl td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.tbl td.strong {
  color: #e8b04b;
  font-weight: 600;
}
.name-col {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
}
.map-name {
  color: #cfd4e4;
}
.alias {
  font-size: 11px;
}
.chip {
  font-size: 10px;
  border-radius: 8px;
  padding: 0 6px;
  line-height: 15px;
  border: 1px solid #2c3244;
  color: #6b7390;
}
.flag {
  font-size: 10px;
  border-radius: 8px;
  padding: 0 6px;
  line-height: 15px;
}
.flag.unknown {
  color: #e0885a;
  border: 1px solid #5a3a24;
}
.note {
  margin-top: 6px;
  line-height: 1.6;
}
</style>

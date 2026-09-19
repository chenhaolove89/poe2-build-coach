<script setup lang="ts">
/**
 * The session's income, drawn: the cumulative net curve over time, and what
 * each map run produced.
 *
 * Both charts draw in the reference currency (divine), which requires rates —
 * fetched live from the official exchange and cached in farmRates. A currency
 * without a rate is never invented into the chart: it is reported under it as
 * unpriced, so the curve only ever shows value the rates actually covered.
 *
 * The charts are hand-drawn SVG rather than a chart library: the app already
 * speaks fluent SVG (the tree, the zone sketches), a curve and some bars do
 * not justify a dependency, and the styling has to match the page anyway.
 */
import { computed, onMounted, ref, watch } from 'vue'
import {
  cumulativeNetSeries,
  incomePerMap,
  ledgerValueIn,
  unpricedTotals,
  type AreaVisit,
  type LedgerEntry,
  type RateTable,
} from '@poe2coach/core'
import { currencyName, t } from '../i18n'
import { fetchLeagues, isDesktopRuntime, rememberLeague, savedLeague } from '../tradeClient'
import { ensureRates } from '../farmRates'

const props = defineProps<{
  entries: LedgerEntry[]
  visits: AreaVisit[]
  startAt: number
  now: number
  labels: Record<string, string>
}>()

const rates = ref<RateTable>({})
const missing = ref<string[]>([])
const ratesNote = ref<string | null>(null)
const loadingRates = ref(false)

const currencies = computed(() => [...new Set(props.entries.map((e) => e.currency))])

const hasPriced = computed(() => props.entries.some((e) => ledgerValueIn(e, rates.value) != null))

/** Latest runs only — a long session's first maps are not the news. */
const BAR_ROWS = 15
const mapIncomes = computed(() => incomePerMap(props.visits, props.entries, rates.value).slice(-BAR_ROWS))

const curve = computed(() => {
  const lastEntry = props.entries.reduce((acc, e) => Math.max(acc, e.at), props.startAt)
  return cumulativeNetSeries(props.entries, rates.value, props.startAt, Math.max(props.now, lastEntry))
})

const unpriced = computed(() => unpricedTotals(props.entries, rates.value))

async function loadRates(): Promise<void> {
  if (!isDesktopRuntime() || props.entries.length === 0) return
  const wanted = currencies.value.filter((c) => c !== 'divine' && !rates.value[c])
  if (wanted.length === 0) return
  loadingRates.value = true
  ratesNote.value = null
  try {
    let league = savedLeague()
    if (!league) {
      league = (await fetchLeagues())[0] ?? ''
      if (league) rememberLeague(league)
    }
    if (!league) {
      ratesNote.value = t('无法确定赛季,汇率没得查,图表只计神圣。')
      return
    }
    const result = await ensureRates(wanted, league)
    rates.value = { ...rates.value, ...result.rates }
    missing.value = result.missing
  } catch (e) {
    ratesNote.value = e instanceof Error ? e.message : String(e)
  } finally {
    loadingRates.value = false
  }
}

// New bookings arrive all the time; a currency seen for the first time needs
// its rate before it can join the curve.
watch(currencies, loadRates)
onMounted(loadRates)

// ------------------------------------------------------------------ the curve

const W = 720
const H = 200
const PAD = { l: 52, r: 14, t: 14, b: 26 }

const curveGeo = computed(() => {
  const points = curve.value
  const ys = points.map((p) => p.net)
  let lo = Math.min(0, ...ys)
  let hi = Math.max(0, ...ys)
  if (lo === hi) {
    lo = -1
    hi = 1
  }
  const padY = (hi - lo) * 0.12
  lo -= padY
  hi += padY
  const x0 = points[0].at
  const x1 = points[points.length - 1].at
  const px = (at: number) => PAD.l + ((at - x0) / Math.max(1, x1 - x0)) * (W - PAD.l - PAD.r)
  const py = (net: number) => PAD.t + (1 - (net - lo) / (hi - lo)) * (H - PAD.t - PAD.b)
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.at).toFixed(1)},${py(p.net).toFixed(1)}`).join(' ')
  const zeroY = py(0)
  const area = `${line} L${px(x1).toFixed(1)},${zeroY.toFixed(1)} L${px(x0).toFixed(1)},${zeroY.toFixed(1)} Z`
  return { points, px, py, line, area, zeroY, lo, hi, x0, x1, up: (points[points.length - 1].net ?? 0) >= 0 }
})

const xTicks = computed(() => {
  const { x0, x1 } = curveGeo.value
  const ticks: { at: number; x: number }[] = []
  for (let i = 0; i <= 3; i++) {
    const at = x0 + ((x1 - x0) * i) / 3
    ticks.push({ at, x: curveGeo.value.px(at) })
  }
  return ticks
})

const yTicks = computed(() => {
  const { lo, hi, py } = curveGeo.value
  const marks = [...new Set([0, hi - (hi - lo) * 0.12, lo + (hi - lo) * 0.12])]
  return marks.map((v) => ({ v, y: py(v) }))
})

const hover = ref<number | null>(null)

function onHover(event: MouseEvent): void {
  const svg = event.currentTarget as SVGSVGElement
  const rect = svg.getBoundingClientRect()
  const x = ((event.clientX - rect.left) / rect.width) * W
  const { points, px } = curveGeo.value
  let best = 0
  let bestDist = Infinity
  points.forEach((p, i) => {
    const d = Math.abs(px(p.at) - x)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  })
  hover.value = best
}

// ------------------------------------------------------------------- the bars

const BW = 720
const NAME_W = 190
const NEG_W = 70

const barGeo = computed(() => {
  const rows = mapIncomes.value
  const maxPos = Math.max(0, ...rows.map((m) => m.net))
  const maxNeg = Math.max(0, ...rows.map((m) => -m.net))
  const posAvail = BW - NAME_W - 74
  const scale =
    maxPos > 0 && maxNeg > 0
      ? Math.min(posAvail / maxPos, NEG_W / maxNeg)
      : maxPos > 0
        ? posAvail / maxPos
        : maxNeg > 0
          ? NEG_W / maxNeg
          : 1
  const zeroX = NAME_W + NEG_W
  const rowH = 26
  const height = rows.length * rowH + 8
  return { rows, scale, zeroX, rowH, height }
})

function barRect(net: number): { x: number; w: number } {
  const { scale, zeroX } = barGeo.value
  const w = Math.abs(net) * scale
  return net >= 0 ? { x: zeroX, w } : { x: zeroX - w, w }
}

/** `2.5D` — divine is the unit everywhere on this page's charts. */
function fmt(net: number): string {
  const abs = Math.abs(net)
  const num = abs >= 10 ? Math.round(net).toString() : (Math.round(net * 10) / 10).toString()
  return `${num}D`
}

function clockOf(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<template>
  <div class="charts">
    <p v-if="entries.length === 0" class="dim small">{{ t('还没有记账。入账之后,这里会画出收益曲线。') }}</p>
    <template v-else>
      <p v-if="loadingRates" class="dim small">{{ t('汇率获取中…') }}</p>
      <p v-if="ratesNote" class="dim small warn-note">{{ ratesNote }}</p>

      <template v-if="hasPriced">
        <h4>{{ t('累计净收益') }}<span class="dim"> · {{ t('单位: 神圣石') }}</span></h4>
        <svg
          :viewBox="`0 0 ${W} ${H}`"
          class="chart"
          @mousemove="onHover"
          @mouseleave="hover = null"
        >
          <line
            v-for="tick in yTicks"
            :key="`g${tick.v}`"
            :x1="PAD.l"
            :x2="W - PAD.r"
            :y1="tick.y"
            :y2="tick.y"
            class="grid"
          />
          <line :x1="PAD.l" :x2="W - PAD.r" :y1="curveGeo.zeroY" :y2="curveGeo.zeroY" class="zero" />
          <text
            v-for="tick in yTicks"
            :key="`y${tick.v}`"
            :x="PAD.l - 6"
            :y="tick.y + 3"
            class="axis"
            text-anchor="end"
          >
            {{ fmt(tick.v) }}
          </text>
          <text v-for="tick in xTicks" :key="`x${tick.at}`" :x="tick.x" :y="H - 8" class="axis" text-anchor="middle">
            {{ clockOf(tick.at) }}
          </text>
          <path :d="curveGeo.area" :class="curveGeo.up ? 'area up' : 'area down'" />
          <path :d="curveGeo.line" :class="curveGeo.up ? 'line up' : 'line down'" />
          <g v-if="hover != null && curveGeo.points[hover]">
            <circle
              :cx="curveGeo.px(curveGeo.points[hover].at)"
              :cy="curveGeo.py(curveGeo.points[hover].net)"
              r="3.5"
              class="dot"
            />
            <text
              :x="Math.min(Math.max(curveGeo.px(curveGeo.points[hover].at), PAD.l + 30), W - PAD.r - 30)"
              :y="Math.max(curveGeo.py(curveGeo.points[hover].net) - 8, 12)"
              class="hover-label"
              text-anchor="middle"
            >
              {{ fmt(curveGeo.points[hover].net) }} · {{ clockOf(curveGeo.points[hover].at) }}
            </text>
          </g>
        </svg>

        <template v-if="mapIncomes.length">
          <h4>{{ t('每张图的收益') }}<span class="dim"> · {{ t('图后卖货算进上一张图;只计有汇率的账') }}</span></h4>
          <svg :viewBox="`0 0 ${BW} ${barGeo.height}`" class="chart bars">
            <line
              :x1="barGeo.zeroX"
              :x2="barGeo.zeroX"
              :y1="2"
              :y2="barGeo.height - 6"
              class="zero"
            />
            <g v-for="(m, i) in barGeo.rows" :key="`${m.startAt}-${i}`" :transform="`translate(0 ${i * barGeo.rowH})`">
              <text :x="NAME_W - 6" :y="17" class="bar-name" text-anchor="end">
                {{ m.name.length > 12 ? `${m.name.slice(0, 11)}…` : m.name }}
              </text>
              <rect
                v-if="m.net !== 0"
                :x="barRect(m.net).x"
                :y="6"
                :width="Math.max(barRect(m.net).w, 1)"
                :height="14"
                :class="m.net >= 0 ? 'bar up' : 'bar down'"
                rx="2"
              />
              <text
                :x="m.net >= 0 ? barRect(m.net).x + barRect(m.net).w + 5 : barRect(m.net).x - 5"
                :y="17"
                class="axis"
                :text-anchor="m.net >= 0 ? 'start' : 'end'"
              >
                {{ m.entryCount > 0 ? fmt(m.net) : '·' }}
              </text>
            </g>
          </svg>
        </template>
      </template>
      <p v-else class="dim small">
        {{ t('记下的账没有一条有汇率,画不出换算后的图表。') }}
      </p>

      <p v-if="unpriced.length" class="dim small">
        {{ t('未计入图表:') }}
        <span v-for="u in unpriced" :key="u.currency" class="other">
          {{ currencyName(u.currency, labels) }}×{{ u.count }}
        </span>
        <template v-if="missing.length"> · {{ t('这些通货没有查到挂单:') }} {{ missing.join(', ') }}</template>
      </p>
    </template>
  </div>
</template>

<style scoped>
.charts {
  margin-top: 12px;
  border-top: 1px dashed #232939;
  padding-top: 10px;
}
.charts h4 {
  margin: 10px 0 4px;
  font-size: 12px;
  color: #8a93ad;
  font-weight: 500;
}
.chart {
  width: 100%;
  height: auto;
  display: block;
  background: #0b0d12;
  border: 1px solid #1d2230;
  border-radius: 6px;
}
.grid {
  stroke: #171b26;
  stroke-width: 1;
}
.zero {
  stroke: #3b4258;
  stroke-width: 1;
  stroke-dasharray: 3 3;
}
.axis {
  fill: #6b7390;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.area {
  opacity: 0.18;
}
.area.up {
  fill: #7dd087;
}
.area.down {
  fill: #e06c6c;
}
.line {
  fill: none;
  stroke-width: 2;
}
.line.up {
  stroke: #7dd087;
}
.line.down {
  stroke: #e06c6c;
}
.dot {
  fill: #ffd979;
}
.hover-label {
  fill: #ffd979;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.bar.up {
  fill: #7dd087;
}
.bar.down {
  fill: #e06c6c;
}
.bar-name {
  fill: #cfd4e4;
  font-size: 11px;
}
.warn-note {
  color: #d9a441;
}
.other {
  margin-left: 6px;
}
.dim {
  color: #6b7390;
  font-size: 11px;
}
.small {
  font-size: 11px;
}
</style>

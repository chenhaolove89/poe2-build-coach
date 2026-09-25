/**
 * The player's own per-map measurements, wherever a map is named.
 *
 * The farm page already joins the log's timeline to the ledger's money by area
 * code, but it kept the join to itself — the map page and the atlas page name
 * the very same maps and had no idea what the player's own runs earned there.
 * The session state behind the farm page is a module singleton, so the join can
 * be one too: these computeds read the same session the farm page renders, and
 * a map row anywhere can carry its measurement.
 *
 * Honesty rules travel with the numbers:
 *   - rates load lazily and only when the ledger has something to price. A
 *     session with no bookings still measures time (runs, mean duration), which
 *     needs no network at all;
 *   - a failed rate fetch leaves the money out rather than reading zero;
 *   - `runs` goes everywhere the figures go, because a map run once is a
 *     sample of one.
 */
import { computed, ref, watch } from 'vue'
import {
  buildSession,
  REFERENCE_CURRENCY,
  summariseRunsByMap,
  type MapRunSummary,
  type RateTable,
} from '@poe2coach/core'
import { farm, ledger } from './farmSession'
import { AREA_INDEX } from './mapData'
import { ensureRates } from './farmRates'
import { currencyName, t } from './i18n'
import { ensureRealmData, isDesktopRuntime, resolveLeague } from './tradeClient'

/**
 * The session's per-map summaries — the same rows the farm page's table shows,
 * rebuilt from the live session whenever it moves.
 */
export const measuredRows = computed<MapRunSummary[]>(() => {
  if (farm.startedAt == null) return []
  const session = buildSession(farm.follow.events, { startedAt: farm.startedAt })
  return summariseRunsByMap(session.visits, ledger.value, rates.value, AREA_INDEX, farm.now)
})

const rates = ref<RateTable>({})
export const measuredRatesNote = ref<string | null>(null)

/** The realm's own currency labels, for the unit in a badge ("神圣石/时"). */
const currencyLabels = ref<Record<string, string>>({})
ensureRealmData()
  .then((data) => {
    currencyLabels.value = data.currency
  })
  .catch(() => {
    /* badges fall back to the raw id */
  })

/** What the player measured on one map this session, or null when never run. */
export function measuredFor(code: string | null): MapRunSummary | null {
  if (!code) return null
  for (const row of measuredRows.value) if (row.code === code) return row
  return null
}

let ratesLoading = false

/**
 * Fill whatever currencies the ledger used and the table lacks. The ten-minute
 * rate cache and the guard make repeat calls free, so several pages asking is
 * still one fetch.
 */
export async function loadMeasuredRates(): Promise<void> {
  if (ratesLoading || !isDesktopRuntime() || ledger.value.length === 0) return
  const wanted = [...new Set(ledger.value.map((e) => e.currency))].filter(
    (c) => c !== REFERENCE_CURRENCY && rates.value[c] == null,
  )
  if (wanted.length === 0) return
  ratesLoading = true
  try {
    const league = await resolveLeague()
    if (!league) {
      measuredRatesNote.value = t('无法确定赛季,汇率没得查,只计神圣。')
      return
    }
    const result = await ensureRates(wanted, league)
    rates.value = { ...rates.value, ...result.rates }
  } catch (e) {
    measuredRatesNote.value = e instanceof Error ? e.message : String(e)
  } finally {
    ratesLoading = false
  }
}
// Bookings arrive by polling, so each new entry (and each new session) is a
// reason to look for rates. A currency already covered is skipped above.
watch(
  () => ledger.value.length,
  () => void loadMeasuredRates(),
)
watch(
  () => farm.startedAt,
  () => void loadMeasuredRates(),
)

function amount(value: number): string {
  const abs = Math.abs(value)
  return value.toFixed(abs >= 100 ? 0 : abs >= 10 ? 1 : 2)
}

function shortDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * The compact line for a map-table or atlas row: "本场 3 次 · 37.2 神圣石/时",
 * or, when the rates (or the bookings) are missing, the time alone —
 * "本场 3 次 · 4:32/次". Empty when this session never ran the map, which is
 * how a template decides whether to show the badge at all.
 */
export function measuredBadgeFor(code: string | null): string {
  const row = measuredFor(code)
  if (!row) return ''
  const runs = `${t('本场')} ${row.runs} ${t('次')}`
  if (row.perHour != null) {
    return `${runs} · ${amount(row.perHour)} ${currencyName(REFERENCE_CURRENCY, currencyLabels.value)}${t('/时')}`
  }
  return `${runs} · ${shortDuration(row.netMs / Math.max(1, row.runs))}${t('/次')}`
}

/**
 * The full detail-overlay line: sample size, net per run, per hour, mean
 * duration — and the footnotes that keep it honest (one run proves nothing;
 * income no rate covered is missing rather than zero). Null when the map was
 * not run this session.
 */
export function measuredDetailLine(code: string | null): string | null {
  const row = measuredFor(code)
  if (!row) return null
  const unit = currencyName(REFERENCE_CURRENCY, currencyLabels.value)
  const mean = shortDuration(row.netMs / Math.max(1, row.runs))
  const parts = [`${t('本场')} ${row.runs} ${t('次')}`]
  if (row.perRun != null) parts.push(`${t('净')} ${amount(row.perRun)} ${unit}${t('/次')}`)
  if (row.perHour != null) parts.push(`${amount(row.perHour)} ${unit}${t('/时')}`)
  parts.push(`${t('均时')} ${mean}`)
  const notes: string[] = []
  if (row.runs === 1) notes.push(t('只刷过一次,说明不了什么。'))
  if (row.unpriced > 0) notes.push(t('有账目没有汇率,未计入 —— 不猜。'))
  return `${parts.join(` ${t('·')} `)}${notes.length ? `(${notes.join('')})` : ''}`
}

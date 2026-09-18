<script setup lang="ts">
/**
 * 刷图收益统计 —— the farming session page.
 *
 * Two halves that are deliberately different in kind:
 *
 *  - **The clock is automatic.** The client log records area transitions, so
 *    maps run, time in a map, loading time and deaths all come for free. The
 *    page follows the log from a byte offset while it is running.
 *  - **The money is by hand.** The log does not contain a single drop or pickup
 *    event — verified by counting keywords in a real 国服 log — so income is
 *    whatever the player pastes in. Claiming otherwise would be inventing data.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  buildSession,
  emptyFollow,
  ingestChunk,
  parseItemText,
  parseLogLines,
  resumeEvents,
  summariseLedger,
  summariseSession,
  visitNetMs,
} from '@poe2coach/core'
import type { FollowState, GameItem, LedgerEntry, LogEvent } from '@poe2coach/core'
import { currencyName, dialect, t } from '../i18n'
import {
  findClientLog,
  readLogFrom,
  readLogTail,
  rememberLogPath,
  savedLogPath,
} from '../farmClient'
import {
  ensureRealmData,
  fetchLeagues,
  isDesktopRuntime,
  priceCheck,
  rememberLeague,
  savedLeague,
  TradeError,
} from '../tradeClient'

/** How much of the log to read back when a session starts, to find the area. */
const TAIL_BYTES = 64 * 1024
const POLL_MS = 1000
/** Visits shown in the list; a long session runs into the hundreds. */
const VISIT_ROWS = 60

const desktop = isDesktopRuntime()
const path = ref(savedLogPath())
const following = ref(false)
const follow = ref<FollowState>(emptyFollow())
const startedAt = ref<number | null>(null)
const now = ref(Date.now())
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const finding = ref(false)

let timer: number | null = null

const session = computed(() =>
  startedAt.value == null ? null : buildSession(follow.value.events, { startedAt: startedAt.value }),
)
const summary = computed(() => (session.value ? summariseSession(session.value, now.value) : null))

/** Newest first, because the last map is the one being asked about. */
const visits = computed(() => [...(session.value?.visits ?? [])].reverse().slice(0, VISIT_ROWS))

// ---------------------------------------------------------------- the ledger

const ledger = ref<LedgerEntry[]>([])
const paste = ref('')
const amount = ref<number | null>(null)
const currency = ref('exalted')
const priceNote = ref<string | null>(null)
const pricing = ref(false)
/** Realm currency labels, for showing "exalted" as 崇高石. */
const labels = ref<Record<string, string>>({})

const ledgerSummary = computed(() => summariseLedger(ledger.value, summary.value?.totalMs ?? 0))

/** Parsed on input so the label is filled before the player books anything. */
const parsed = computed<GameItem | null>(() => {
  if (!paste.value.trim()) return null
  try {
    return parseItemText(paste.value)
  } catch {
    return null
  }
})
const pasteLabel = computed(() => parsed.value?.name ?? parsed.value?.base ?? '')

const CURRENCIES = ['exalted', 'divine', 'chaos', 'alch', 'regal', 'mirror']

/**
 * Only the ids the realm's currency pack actually names.
 *
 * An id the pack does not know would render as the bare id ("alchemy"), and a
 * ledger booked in a currency nobody can read is worse than a shorter list. The
 * selected value is always kept, so a price result in an unusual currency still
 * shows.
 */
const currencyOptions = computed(() => {
  if (Object.keys(labels.value).length === 0) return CURRENCIES
  const known = CURRENCIES.filter((id) => labels.value[id])
  return known.length > 0 ? known : CURRENCIES
})

function currencyLabel(id: string): string {
  const label = currencyName(id, labels.value)
  return label === id ? id : `${label} ${id}`
}

function book(kind: 'income' | 'cost') {
  const value = amount.value
  if (value == null || !Number.isFinite(value) || value <= 0) {
    priceNote.value = t('先填一个大于 0 的数量。')
    return
  }
  ledger.value = [
    ...ledger.value,
    {
      id: `${Date.now()}-${ledger.value.length}`,
      at: Date.now(),
      label: pasteLabel.value || t('未命名'),
      amount: value,
      currency: currency.value,
      kind,
    },
  ]
  paste.value = ''
  amount.value = null
  priceNote.value = null
}

function unbook(id: string) {
  ledger.value = ledger.value.filter((entry) => entry.id !== id)
}

/**
 * Fill the amount from the trade site.
 *
 * The league is the one the 查价 page last used, and is fetched on demand
 * because a player who never opened that page has not picked one. The trade
 * site's rate limit is shared with that page — `priceCheck` enforces it — so a
 * burst here is refused rather than spent.
 */
async function onPrice() {
  const item = parsed.value
  if (!item) {
    priceNote.value = t('先把物品文本(Ctrl+C 复制)粘贴进来。')
    return
  }
  pricing.value = true
  priceNote.value = null
  try {
    let league = savedLeague()
    if (!league) {
      league = (await fetchLeagues())[0] ?? ''
      if (league) rememberLeague(league)
    }
    if (!league) throw new TradeError(t('无法确定当前赛季。'), 'no_league')
    const result = await priceCheck(item, { league })
    const s = result.summary
    if (s.median == null) {
      priceNote.value = t('这次搜索没有带价格的挂单,可以手动填一个数。')
      return
    }
    amount.value = Math.round(s.median * 100) / 100
    if (s.currency) currency.value = s.currency
    priceNote.value = `${t('中位价')} ${s.median} ${currencyName(s.currency, labels.value)} · ${s.priced} ${t('条挂单')}${result.relaxed ? t('(含离线卖家)') : ''}`
  } catch (e) {
    priceNote.value = e instanceof Error ? e.message : String(e)
  } finally {
    pricing.value = false
  }
}

// ------------------------------------------------------------- following it

function stopFollowing() {
  following.value = false
  if (timer != null) {
    clearInterval(timer)
    timer = null
  }
  now.value = Date.now()
}

async function onFind() {
  finding.value = true
  error.value = null
  try {
    const found = await findClientLog()
    if (found) {
      path.value = found
      rememberLogPath(found)
      notice.value = t('已找到游戏日志。')
    } else {
      notice.value = t('没找到日志。游戏没在运行时无法从进程反查,请手动粘贴 Client.txt 的完整路径(在游戏安装目录的 logs 文件夹里)。')
    }
  } finally {
    finding.value = false
  }
}

async function start() {
  const target = path.value.trim()
  error.value = null
  notice.value = null
  if (!target) {
    error.value = t('先指定 Client.txt 的路径。')
    return
  }
  try {
    // Read the end of the log first: the player is already somewhere, and
    // tailing from the end would leave the tracker blind until they next change
    // area — a whole map away.
    const tail = await readLogTail(target, TAIL_BYTES)
    const at = Date.now()
    follow.value = { offset: tail.offset, events: resumeEvents(tail.lines, at), resets: 0 }
    startedAt.value = at
    ledger.value = []
    path.value = target
    rememberLogPath(target)
    following.value = true
    now.value = at
    timer = window.setInterval(tick, POLL_MS)
    if (follow.value.events.length === 0) {
      notice.value = t('开始记录了。日志里还没看到当前区域,下次进图就会跟上。')
    }
  } catch (e) {
    error.value = String(e)
  }
}

async function tick() {
  if (!following.value) return
  now.value = Date.now()
  try {
    const chunk = await readLogFrom(path.value.trim(), follow.value.offset)
    const before = follow.value.resets
    follow.value = ingestChunk(follow.value, chunk)
    if (follow.value.resets > before) {
      notice.value = t('日志被游戏重写了,之前的记录已清空,从这一行继续。')
    }
  } catch (e) {
    error.value = `${t('读取日志失败:')}${e instanceof Error ? e.message : String(e)}`
    stopFollowing()
  }
}

/** Feed a made-up session through the real pipeline, to see the page working. */
function preview() {
  const lines = demoLines()
  const events: LogEvent[] = parseLogLines(lines)
  if (events.length === 0) return
  startedAt.value = events[0].at
  follow.value = { offset: 0, events, resets: 0 }
  following.value = false
  now.value = Date.now()
  error.value = null
  notice.value = t('这是示例数据,不是你的日志。点「开始记录」会清掉它。')
}

/**
 * A plausible log: a hideout, three maps and the walk back between each.
 *
 * The opening banner, the `Generating level … area …` line and the `[SCENE] Set
 * Source` pair are exactly the shapes the real client writes; only the timing is
 * made up. The area names are written Simplified and run through `dialect`,
 * because a real log carries whatever language the client is set to and the demo
 * should read like one.
 */
function demoLines(): string[] {
  const out: string[] = []
  let clock = Date.now() - 22 * 60_000
  const stamp = (ms: number) => {
    const d = new Date(ms)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  }
  const push = (message: string, advance = 0) => {
    clock += advance
    out.push(`${stamp(clock)} [INFO Client 8224] ${message}`)
  }
  const scene = (name: string, advance = 0) => push(`[SCENE] Set Source [${dialect(name, 'zh-Hans')}]`, advance)
  const HIDEOUT = '藏身处：海岸'

  out.push(`${stamp(clock)} ***** LOG FILE OPENING *****`)
  push('Generating level 1 area "HideoutShoreline" with seed 1')
  scene(HIDEOUT)
  push(`[LOADING SCREEN] (${dialect(HIDEOUT, 'zh-Hans')}) Duration = 3.5 seconds`)
  const maps: [string, string][] = [
    ['MapDeforestation', '毁坏的林场'],
    ['MapSand', '沙地'],
    ['MapOasis', '绿洲'],
  ]
  for (const [index, [code, name]] of maps.entries()) {
    push(`Generating level 79 area "${code}" with seed 42`, 25_000)
    scene(name)
    push(`[LOADING SCREEN] (${dialect(name, 'zh-Hans')}) Duration = 2.5 seconds`, 2_000)
    // A death and a level-up, so those counters are exercised too.
    if (index === 0) push(': 阿蛮 has been slain.', 40_000)
    if (index === 1) push(': 阿蛮 is now level 91', 40_000)
    scene(HIDEOUT, index === 1 ? 15_000 : 95_000)
    push(`[LOADING SCREEN] (${dialect(HIDEOUT, 'zh-Hans')}) Duration = 2 seconds`, 2_000)
  }
  return out
}

// ------------------------------------------------------------------ display

function duration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function clockOf(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

const KIND_LABEL: Record<string, string> = { map: '地图', hideout: '藏身处', other: '其他' }

onMounted(async () => {
  try {
    labels.value = (await ensureRealmData()).currency
  } catch {
    /* labels are cosmetic; the raw currency id still shows */
  }
})

// A realm switch changes the currency labels and nothing else here — the log is
// the same file either way.
onBeforeUnmount(stopFollowing)
</script>

<template>
  <div class="farm">
    <div class="bar">
      <label class="field wide">
        <span class="dim">{{ t('客户端日志') }}</span>
        <input
          v-model="path"
          class="path"
          spellcheck="false"
          :placeholder="t('游戏安装目录\\logs\\Client.txt')"
          :disabled="following"
        />
      </label>
      <button :disabled="!desktop || finding || following" @click="onFind">
        {{ finding ? t('查找中…') : t('自动查找') }}
      </button>
      <span class="spacer" />
      <button v-if="!following" class="primary" :disabled="!desktop" @click="start">
        {{ t('开始记录') }}
      </button>
      <button v-else class="danger" @click="stopFollowing">{{ t('停止记录') }}</button>
      <button :disabled="following" :title="t('用一段编造的日志看这一页长什么样')" @click="preview">
        {{ t('示例预览') }}
      </button>
    </div>

    <div class="body">
      <p v-if="!desktop" class="notice warn">{{ t('读取游戏日志需要桌面版。浏览器预览里可以点「示例预览」看界面。') }}</p>
      <p v-if="error" class="notice warn">{{ error }}</p>
      <p v-if="notice" class="notice dim">{{ notice }}</p>

      <section v-if="summary" class="live">
        <div class="live-head">
          <span class="dot" :class="{ on: following }" />
          <span v-if="summary.current" class="area">
            <b>{{ dialect(summary.current.name) }}</b>
            <span v-if="summary.current.level" class="dim">Lv{{ summary.current.level }}</span>
            <span class="kind" :class="summary.current.kind">{{ t(KIND_LABEL[summary.current.kind]) }}</span>
            <span v-if="summary.current.code" class="dim mono">{{ summary.current.code }}</span>
          </span>
          <span v-else class="dim">{{ t('还没看到区域。进一次图就会跟上。') }}</span>
          <span class="spacer" />
          <span class="elapsed">{{ duration(summary.totalMs) }}</span>
        </div>

        <div class="grid">
          <div class="stat">
            <span class="k">{{ t('地图数') }}</span>
            <span class="v">{{ summary.mapCount }}</span>
          </div>
          <div class="stat">
            <span class="k">{{ t('每小时') }}</span>
            <span class="v">{{ summary.mapsPerHour.toFixed(1) }}</span>
          </div>
          <div class="stat">
            <span class="k">{{ t('每图均时') }}</span>
            <span class="v">{{ duration(summary.avgMapMs) }}</span>
          </div>
          <div class="stat">
            <span class="k">{{ t('净刷图') }}</span>
            <span class="v">{{ duration(summary.netMapMs) }}</span>
          </div>
          <div class="stat">
            <span class="k">{{ t('非刷图') }}</span>
            <span class="v">{{ duration(summary.otherMs) }}</span>
          </div>
          <div class="stat">
            <span class="k">{{ t('读图') }}</span>
            <span class="v">{{ duration(summary.loadingMs) }}</span>
          </div>
          <div class="stat">
            <span class="k">{{ t('死亡') }}</span>
            <span class="v">{{ summary.deaths }}</span>
          </div>
          <div class="stat">
            <span class="k">{{ t('等级') }}</span>
            <span class="v">{{ summary.lastLevel ?? '—' }}</span>
          </div>
        </div>
      </section>

      <section v-if="summary" class="card">
        <h3>{{ t('本场收益') }}<span class="dim"> · {{ t('日志里没有掉落事件,产出靠你粘贴记账') }}</span></h3>
        <div class="grid">
          <div class="stat">
            <span class="k">{{ t('收入') }}</span>
            <span class="v good">{{ ledgerSummary.income }}</span>
          </div>
          <div class="stat">
            <span class="k">{{ t('成本') }}</span>
            <span class="v bad">{{ ledgerSummary.cost }}</span>
          </div>
          <div class="stat">
            <span class="k">{{ t('净') }}</span>
            <span class="v" :class="ledgerSummary.net >= 0 ? 'good' : 'bad'">{{ ledgerSummary.net }}</span>
          </div>
          <div class="stat">
            <span class="k">{{ t('每小时净') }}</span>
            <span class="v" :class="ledgerSummary.netPerHour >= 0 ? 'good' : 'bad'">
              {{ ledgerSummary.netPerHour.toFixed(1) }}
            </span>
          </div>
        </div>
        <p class="unit dim">
          {{ t('单位:') }}{{ ledgerSummary.currency ? currencyLabel(ledgerSummary.currency) : t('暂无') }}
          <template v-if="ledgerSummary.others.length">
            · {{ t('另有') }}
            <span v-for="o in ledgerSummary.others" :key="o.currency" class="other">
              {{ currencyName(o.currency, labels) }}×{{ o.count }}
            </span>
            {{ t('未换算(汇率会过期,不猜)') }}
          </template>
        </p>

        <div class="book">
          <textarea
            v-model="paste"
            rows="3"
            spellcheck="false"
            :placeholder="t('把物品文本粘贴进来(游戏里 Ctrl+C 复制),或直接填数量')"
          />
          <div class="book-row">
            <span class="parsed dim">{{ pasteLabel || t('未识别出物品名') }}</span>
            <button :disabled="!parsed || pricing || !desktop" @click="onPrice">
              {{ pricing ? t('查价中…') : t('查价填入') }}
            </button>
            <input v-model.number="amount" class="amount" type="number" min="0" step="0.01" :placeholder="t('数量')" />
            <select v-model="currency">
              <option v-for="c in currencyOptions" :key="c" :value="c">{{ currencyLabel(c) }}</option>
              <option v-if="!currencyOptions.includes(currency)" :value="currency">{{ currency }}</option>
            </select>
            <button class="good-btn" @click="book('income')">{{ t('记收入') }}</button>
            <button class="bad-btn" @click="book('cost')">{{ t('记成本') }}</button>
          </div>
          <p v-if="priceNote" class="notice dim tight">{{ priceNote }}</p>
        </div>

        <div v-for="entry in [...ledger].reverse()" :key="entry.id" class="ledger-row">
          <span class="tag" :class="entry.kind">{{ entry.kind === 'income' ? t('收入') : t('成本') }}</span>
          <span class="label">{{ dialect(entry.label) }}</span>
          <span class="amt" :class="entry.kind">
            {{ entry.kind === 'income' ? '+' : '−' }}{{ entry.amount }} {{ currencyName(entry.currency, labels) }}
          </span>
          <span class="dim small">{{ clockOf(entry.at) }}</span>
          <span class="del" @click="unbook(entry.id)">✕</span>
        </div>
        <p v-if="!ledger.length" class="dim small">
          {{ t('查价页面的限流和这里共用,一次查价两个请求,太频繁会被官方拦。') }}
        </p>
      </section>

      <section v-if="summary && visits.length" class="card">
        <h3>{{ t('区域记录') }}<span class="dim"> · {{ t('最近') }} {{ visits.length }}</span></h3>
        <div class="runs">
          <div class="run head">
            <span>{{ t('区域') }}</span>
            <span>{{ t('类型') }}</span>
            <span class="num">{{ t('用时') }}</span>
            <span class="num">{{ t('读图') }}</span>
            <span class="num">{{ t('开始') }}</span>
          </div>
          <div v-for="(v, i) in visits" :key="`${v.startAt}-${i}`" class="run" :class="{ open: v.endAt == null }">
            <span class="area-cell">
              <b>{{ dialect(v.name) }}</b>
              <span v-if="v.code" class="dim mono">{{ v.code }}</span>
            </span>
            <span><span class="kind" :class="v.kind">{{ t(KIND_LABEL[v.kind]) }}</span></span>
            <span class="num">{{ duration(visitNetMs(v, now)) }}</span>
            <span class="num dim">{{ v.loadingMs ? duration(v.loadingMs) : '—' }}</span>
            <span class="num dim">{{ clockOf(v.startAt) }}</span>
          </div>
        </div>
        <p class="dim small">
          {{ t('净刷图 + 非刷图 + 读图 = 全程,不会多也不会少。用时按进出区域的时间差算,已扣掉读图;主菜单、崩溃后重进游戏都算「非刷图」。') }}
        </p>
      </section>

      <section v-if="!summary" class="card empty">
        <h3>{{ t('怎么用') }}</h3>
        <ol>
          <li>{{ t('游戏开着的时候点「自动查找」,它会问游戏进程要安装目录,再拼上 logs\\Client.txt;找不到就手动粘贴完整路径。') }}</li>
          <li>{{ t('点「开始记录」。它会先读日志结尾,认出你现在站在哪个区域,然后每秒读一次新增的行。') }}</li>
          <li>{{ t('打图。地图数、每图耗时、读图时间、死亡都自动出来。') }}</li>
          <li>{{ t('掉了值钱的东西,在游戏里 Ctrl+C 复制,粘到「本场收益」里记一笔;门票成本同理。') }}</li>
        </ol>
        <p class="dim small">
          {{ t('只读:这个功能只打开日志文件读取,不写入、不碰游戏客户端。游戏日志里没有掉落事件,所以产出永远是你手动记的,不是它猜的。') }}
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.farm {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  width: 100%;
  max-width: 1100px;
}
.bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: #10131b;
  border-bottom: 1px solid #232939;
  flex-wrap: wrap;
}
.field {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.field.wide {
  flex: 1;
  min-width: 320px;
}
.path {
  flex: 1;
  background: #0b0d12;
  color: #cfd4e4;
  border: 1px solid #2c3244;
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 12px;
}
.path:focus {
  outline: none;
  border-color: #e8b04b;
}
.spacer {
  flex: 1;
}
.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px 24px;
}
.live,
.card {
  background: #10131b;
  border: 1px solid #232939;
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 12px;
}
.live {
  border-color: #2f3a52;
}
.live-head {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: #cfd4e4;
  margin-bottom: 10px;
}
.live-head .area {
  display: flex;
  align-items: center;
  gap: 8px;
}
.live-head b {
  color: #ffd979;
  font-size: 15px;
}
.elapsed {
  font-variant-numeric: tabular-nums;
  font-size: 18px;
  color: #e8b04b;
  font-weight: 600;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #4a5270;
  flex: none;
}
.dot.on {
  background: #7dd087;
  box-shadow: 0 0 6px #7dd087;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 8px;
}
.stat {
  background: #0b0d12;
  border: 1px solid #1d2230;
  border-radius: 6px;
  padding: 7px 9px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.stat .k {
  font-size: 11px;
  color: #6b7390;
}
.stat .v {
  font-size: 16px;
  color: #cfd4e4;
  font-variant-numeric: tabular-nums;
}
.stat .v.good {
  color: #7dd087;
}
.stat .v.bad {
  color: #e06c6c;
}
h3 {
  font-size: 13px;
  color: #8a93ad;
  margin: 0 0 10px;
}
.unit {
  margin: 8px 0 0;
}
.other {
  margin-left: 6px;
}
.book {
  margin-top: 10px;
  border-top: 1px dashed #232939;
  padding-top: 10px;
}
.book textarea {
  width: 100%;
  box-sizing: border-box;
  background: #0b0d12;
  color: #cfd4e4;
  border: 1px solid #2c3244;
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 12px;
  resize: vertical;
  font-family: inherit;
}
.book textarea:focus {
  outline: none;
  border-color: #e8b04b;
}
.book-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  flex-wrap: wrap;
}
.parsed {
  flex: 1;
  min-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.amount {
  width: 90px;
  background: #0b0d12;
  color: #cfd4e4;
  border: 1px solid #2c3244;
  border-radius: 6px;
  padding: 5px 7px;
  font-size: 12px;
}
select {
  background: #0b0d12;
  color: #cfd4e4;
  border: 1px solid #2c3244;
  border-radius: 6px;
  padding: 5px 7px;
  font-size: 12px;
}
button {
  background: #1a1f2c;
  border: 1px solid #2c3244;
  color: #cfd4e4;
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 12px;
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
button.danger {
  border-color: #6d3a3a;
  color: #e06c6c;
}
button.good-btn {
  border-color: #2f4a38;
  color: #7dd087;
}
button.bad-btn {
  border-color: #4a3030;
  color: #d98a8a;
}
.ledger-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  padding: 3px 0;
  border-bottom: 1px solid #171b26;
}
.tag {
  font-size: 10.5px;
  border-radius: 8px;
  padding: 0 6px;
  border: 1px solid #2c3244;
}
.tag.income {
  color: #7dd087;
  border-color: #2f4a38;
}
.tag.cost {
  color: #e06c6c;
  border-color: #4a3030;
}
.ledger-row .label {
  flex: 1;
  color: #cfd4e4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.amt {
  font-variant-numeric: tabular-nums;
}
.amt.income {
  color: #7dd087;
}
.amt.cost {
  color: #e06c6c;
}
.del {
  color: #7a5a5a;
  cursor: pointer;
  padding: 0 4px;
}
.del:hover {
  color: #e06c6c;
}
.runs {
  display: flex;
  flex-direction: column;
}
.run {
  display: grid;
  /* Capped, because a name column that stretches the width of the window puts
     the numbers a screen away from the area they belong to. */
  grid-template-columns: minmax(170px, 300px) 76px 76px 64px 76px;
  max-width: 640px;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  padding: 4px 2px;
  border-bottom: 1px solid #171b26;
}
.run.head {
  color: #6b7390;
  font-size: 11px;
  border-bottom-color: #232939;
}
.run.open {
  background: #14180f;
}
.run .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.area-cell {
  display: flex;
  align-items: baseline;
  gap: 8px;
  overflow: hidden;
}
.area-cell b {
  color: #cfd4e4;
  font-weight: 500;
}
.mono {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 10.5px;
}
.kind {
  font-size: 10.5px;
  border-radius: 8px;
  padding: 0 6px;
  border: 1px solid #2c3244;
  color: #9aa3bd;
}
.kind.map {
  color: #e8b04b;
  border-color: #4a3f22;
}
.kind.hideout {
  color: #7dd087;
  border-color: #2f4a38;
}
.notice {
  margin: 0 0 10px;
  padding: 6px 10px;
  font-size: 11.5px;
  line-height: 1.6;
  background: #171b26;
  border-radius: 6px;
}
.notice.tight {
  margin-top: 6px;
}
.notice.dim {
  color: #8a93ad;
}
.notice.warn {
  background: #241f14;
  color: #d9a441;
}
.card.empty ol {
  margin: 0;
  padding-left: 20px;
  font-size: 12px;
  line-height: 1.9;
  color: #cfd4e4;
}
.dim {
  color: #6b7390;
  font-size: 11px;
}
.small {
  font-size: 11px;
}
</style>

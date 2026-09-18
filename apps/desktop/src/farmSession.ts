/**
 * The farming session, kept outside the page that displays it.
 *
 * The page is one of several views and Vue unmounts it when the player looks at
 * something else — their tree, a price check. A session that reset itself
 * because of that would be useless, so the state and the polling live here as a
 * module singleton and the page only renders them. Coming back finds the clock
 * still running.
 *
 * What is deliberately *not* here: the display language, the currency labels and
 * the formatting. Those belong to the page.
 */
import { reactive, ref } from 'vue'
import { emptyFollow, ingestChunk, parseLogLines, resumeEvents } from '@poe2coach/core'
import type { FollowState, LedgerEntry } from '@poe2coach/core'
import { readLogFrom, readLogTail, rememberLogPath, savedLogPath } from './farmClient'
import { isDesktopRuntime } from './tradeClient'

/**
 * How much of the log to read back when a session starts.
 *
 * Enough to cover a map's worth of chatter, so the area the player is already
 * standing in is found without walking the whole file.
 */
const TAIL_BYTES = 64 * 1024
const POLL_MS = 1000

export const farm = reactive({
  /** The log being followed, or the one that was typed last. */
  path: savedLogPath(),
  following: false,
  follow: emptyFollow() as FollowState,
  /** When the player pressed 开始; null before the first session. */
  startedAt: null as number | null,
  /** Ticks once a second while following, so durations move. */
  now: Date.now(),
  error: null as string | null,
  notice: null as string | null,
  /** Times the log was replaced under us. */
  resets: 0,
})

/** The session's book. Cleared when a new session starts, kept across views. */
export const ledger = ref<LedgerEntry[]>([])

let timer: number | null = null

/** Start following the log at `path`, resuming from the area already loaded. */
export async function startFarmSession(path: string): Promise<void> {
  if (!isDesktopRuntime()) throw new Error('读取游戏日志需要桌面版。')
  farm.error = null
  farm.notice = null

  // Read the end of the log first: the player is already somewhere, and tailing
  // from the end would leave the tracker blind until they next change area —
  // a whole map away.
  const tail = await readLogTail(path, TAIL_BYTES)
  const at = Date.now()
  farm.path = path
  farm.follow = { offset: tail.offset, events: resumeEvents(tail.lines, at), resets: 0 }
  farm.startedAt = at
  farm.now = at
  farm.resets = 0
  farm.following = true
  ledger.value = []
  rememberLogPath(path)
  if (farm.follow.events.length === 0) {
    farm.notice = '开始记录了。日志里还没看到当前区域,下次进图就会跟上。'
  }
  if (timer != null) clearInterval(timer)
  timer = window.setInterval(tick, POLL_MS)
}

export function stopFarmSession(): void {
  farm.following = false
  farm.now = Date.now()
  if (timer != null) {
    clearInterval(timer)
    timer = null
  }
}

/**
 * Load a made-up session through the real pipeline, so the page can be seen
 * working without the game running. Not a mock: the lines go through the same
 * parser and the same session builder as a live log.
 */
export function previewFarmSession(lines: string[]): void {
  const events = parseLogLines(lines)
  if (events.length === 0) return
  stopFarmSession()
  farm.startedAt = events[0].at
  farm.follow = { offset: 0, events, resets: 0 }
  farm.now = Date.now()
  farm.error = null
  farm.notice = '这是示例数据,不是你的日志。点「开始记录」会清掉它。'
}

async function tick(): Promise<void> {
  if (!farm.following) return
  farm.now = Date.now()
  try {
    const chunk = await readLogFrom(farm.path.trim(), farm.follow.offset)
    const before = farm.resets
    farm.follow = ingestChunk(farm.follow, chunk)
    farm.resets = farm.follow.resets
    if (farm.resets > before) {
      farm.notice = '日志被游戏重写了,之前的记录已清空,从这一行继续。'
    }
  } catch (e) {
    farm.error = `读取日志失败:${e instanceof Error ? e.message : String(e)}`
    stopFarmSession()
  }
}

export function addLedgerEntry(entry: Omit<LedgerEntry, 'id' | 'at'>): void {
  ledger.value = [...ledger.value, { ...entry, id: `${Date.now()}-${ledger.value.length}`, at: Date.now() }]
}

export function removeLedgerEntry(id: string): void {
  ledger.value = ledger.value.filter((e) => e.id !== id)
}

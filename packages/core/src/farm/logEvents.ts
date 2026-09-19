/**
 * Turn Client.txt lines into a timeline.
 *
 * The client log is the only *automatic* data source this app has for a farming
 * session, and what it holds is narrow: area transitions, loading times, deaths
 * and level-ups. It does not record a single drop or pickup — measured on a real
 * 国服 log, 755 Client lines with zero item events, matching the exhaustive event
 * list of Exiled-Exchange-2 and the author of 易刷 saying outright that his
 * tracker only knows about items you Ctrl+C'd. So everything here is timing, and
 * the loot side has to be entered by hand.
 *
 * Format, as observed:
 *
 *   2026/06/29 22:18:37 ***** LOG FILE OPENING *****
 *   2026/06/29 22:18:37 [DEBUG Client 8224] Generating level 79 area "MapDeforestation" with seed 569701987
 *   2026/06/29 22:18:37 [INFO Client 8224] [SCENE] Set Source [毁坏的林场]
 *   2026/06/29 22:18:37 [INFO Client 8224] [LOADING SCREEN] (藏身处：海岸) Duration = 3.5 seconds
 *
 * Two things that surprise people:
 *
 * - **Area codes are English even on the Chinese client** (`MapDeforestation`),
 *   while `[SCENE] Set Source` carries the localized name. So one line gives a
 *   stable key and the next gives something a player can read.
 * - **PoE2 never writes `You have entered X.`** — that is PoE1, and a lot of
 *   third-party regex tables still carry it. Area entry has to be recognised as
 *   the `Generating level … area …` / `Set Source` pair instead.
 */

/** One recognised log line. Unrecognised lines are dropped, not guessed at. */
export type LogEvent =
  | { kind: 'logOpen'; at: number }
  /** A new area instance was generated: the English code plus its monster level. */
  | { kind: 'area'; at: number; code: string; level: number | null }
  /** The client switched to an area; `name` is what the player's client calls it. */
  | { kind: 'scene'; at: number; name: string }
  | { kind: 'loading'; at: number; name: string; seconds: number }
  | { kind: 'death'; at: number }
  | { kind: 'levelUp'; at: number; level: number }
  /** Peer-to-peer trade whisper (asking to buy an item or buying from someone). */
  | {
      kind: 'tradeWhisper'
      at: number
      direction: 'incoming' | 'outgoing'
      character: string
      item: string
      amount: number
      currency: string
      league: string
      raw: string
    }
  | { kind: 'tradeAccepted'; at: number }
  | { kind: 'tradeCancelled'; at: number }

/**
 * `2026/06/29 22:18:37`, optionally with a millisecond fraction. Read as local
 * time, which is what the client writes.
 */
const TIMESTAMP = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,3}))?/

/** `[INFO Client 8224]` and its siblings, including the WeGame wrapper's. */
const CLIENT_TAG = /\[(?:DEBUG|INFO|WARN|ERROR|NOTICE|FATAL) Client \d+\]\s*/

/** Some builds interpose a millisecond counter and a hex hash before the tag. */
const LEADING_JUNK = /^\d{1,3}\s+[0-9a-fA-F]{6,}\s+/

const LOG_OPEN = /^\*+ LOG FILE OPENING \*+/
const AREA = /^Generating level (\d+) area "([^"]+)"/
const SCENE = /^\[SCENE\] Set Source \[(.+?)\]\s*$/
const LOADING = /^\[LOADING SCREEN\] \((.+?)\) Duration = ([\d.]+) seconds/

/**
 * Death lines. The English form is the client's own wording; the Chinese ones
 * are unverified guesses — the only real log available had zero deaths in it, so
 * there was nothing to pin them against. They are deliberately narrow, and a
 * pattern that never matches costs nothing but a zero.
 */
const DEATH = /has been slain|已被击杀|你已死亡|你被击杀/

/** `: Name is now level 42` — again English-only, for the same reason. */
const LEVEL_UP = / is now level (\d+)/

const TRADE_ACCEPTED = /^:?\s*Trade accepted\.?$/i
const TRADE_CANCELLED = /^:?\s*Trade cancelled\.?$/i

/**
 * Trade whisper patterns:
 * English: @From Character: Hi, I would like to buy your Item listed for 5 divine in Standard (stash tab ...)
 * Chinese 1: @来自 角色: 你好，我想购买你的 物品 标价为 5 神圣石 于 赛季 (仓库页 ...)
 * Chinese 2: @来自 角色: 你好，我想购买你在 赛季 标价为 5 神圣石 的 物品 (仓库页 ...)
 */
const WHISPER_EN =
  /^@(From|To)\s+(?:<[^>]+>\s+)?([^:]+):\s*(?:Hi,\s*)?I\s+(?:would like|d like)\s+to buy your\s+(.+?)\s+listed for\s+([\d.]+)\s+(.+?)\s+in\s+([^(]+?)(?:\s*\(.*)?$/i

const WHISPER_ZH_1 =
  /^@(来自|來自|向)\s+(?:<[^>]+>\s+)?([^:]+):\s*(?:你好[，,]\s*)?我想(?:购买|購買|买|買)?\s*(?:你的)?\s*(.+?)\s*(?:标价为|標價為|标价|標價|标为|標為|售价为|售價為)\s*([\d.]+)\s*(.+?)\s*[于於]\s*([^(]+?)(?:\s*\(.*)?$/i

const WHISPER_ZH_2 =
  /^@(来自|來自|向)\s+(?:<[^>]+>\s+)?([^:]+):\s*(?:你好[，,]\s*)?我想(?:购买|購買|买|買)?\s*你在\s*(.+?)\s*(?:标价为|標價為|标价|標價|标为|標為|售价为|售價為)\s*([\d.]+)\s*(.+?)\s*的\s*(.+?)(?:\s*\(.*)?$/i

export function normalizeCurrency(raw: string): string {
  const s = raw.trim().toLowerCase()
  if (/^(?:divine(?: orb|s)?|神圣石?|神聖石?)$/i.test(s)) return 'divine'
  if (/^(?:chaos(?: orb)?|混沌石?)$/i.test(s)) return 'chaos'
  if (/^(?:exalted(?: orb)?|exalt|崇高石?)$/i.test(s)) return 'exalted'
  if (/^(?:mirror(?: of kalandra)?|卡兰德的魔镜|卡蘭德的魔鏡|魔镜|魔鏡)$/i.test(s)) return 'mirror'
  if (/^(?:alch(?:emy)?|orb of alchemy|点金石?|點金石?)$/i.test(s)) return 'alch'
  if (/^(?:regal(?: orb)?|富豪石?)$/i.test(s)) return 'regal'
  return s
}

/** Area display names that are screens rather than places. */
const NOT_AN_AREA = new Set(['(null)', '(unknown)', 'null', 'unknown'])

function timestampOf(line: string): number | null {
  const m = TIMESTAMP.exec(line)
  if (!m) return null
  const [, y, mo, d, h, mi, s, frac] = m
  const at = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))
  const ms = at.getTime()
  if (Number.isNaN(ms)) return null
  return frac ? ms + Number(frac.padEnd(3, '0')) : ms
}

/** The message part of a line, with the timestamp and the client tag removed. */
function messageOf(line: string): string {
  const rest = line.slice(TIMESTAMP.exec(line)![0].length).trimStart()
  const tag = CLIENT_TAG.exec(rest)
  if (tag) return rest.slice(tag.index + tag[0].length)
  return rest.replace(LEADING_JUNK, '')
}

/** True when a `[SCENE] Set Source` name is a loading screen or the main menu. */
export function isScreenName(name: string): boolean {
  return NOT_AN_AREA.has(name.trim().toLowerCase())
}

/**
 * Classify an area by its code. Only the map prefix is load-bearing: it is how
 * "did I run a map" is answered, and it holds for every endgame area because the
 * export names them all `Map<Something>`. Everything else is lumped together as
 * not-a-map rather than guessed at, since campaign zones and towns share no
 * prefix worth trusting.
 */
export function areaKindOf(code: string | null): 'map' | 'hideout' | 'other' {
  if (!code) return 'other'
  if (/^Map/i.test(code)) return 'map'
  if (/^Hideout/i.test(code)) return 'hideout'
  return 'other'
}

/** Parse one log line. Returns null for anything not part of the timeline. */
export function parseLogLine(line: string): LogEvent | null {
  const trimmed = line.replace(/\r$/, '').trim()
  if (!trimmed) return null
  const at = timestampOf(trimmed)
  if (at == null) return null
  const msg = messageOf(trimmed)

  if (LOG_OPEN.test(msg)) return { kind: 'logOpen', at }

  const area = AREA.exec(msg)
  if (area) return { kind: 'area', at, code: area[2], level: Number(area[1]) }

  const scene = SCENE.exec(msg)
  if (scene) return { kind: 'scene', at, name: scene[1].trim() }

  const loading = LOADING.exec(msg)
  if (loading) {
    const seconds = Number(loading[2])
    if (!Number.isFinite(seconds)) return null
    return { kind: 'loading', at, name: loading[1].trim(), seconds }
  }

  if (DEATH.test(msg)) return { kind: 'death', at }

  const level = LEVEL_UP.exec(msg)
  if (level) return { kind: 'levelUp', at, level: Number(level[1]) }

  if (TRADE_ACCEPTED.test(msg)) return { kind: 'tradeAccepted', at }
  if (TRADE_CANCELLED.test(msg)) return { kind: 'tradeCancelled', at }

  const whisperEn = WHISPER_EN.exec(msg)
  if (whisperEn) {
    const direction = whisperEn[1].toLowerCase() === 'from' ? 'incoming' : 'outgoing'
    return {
      kind: 'tradeWhisper',
      at,
      direction,
      character: whisperEn[2].trim(),
      item: whisperEn[3].trim(),
      amount: Number(whisperEn[4]),
      currency: normalizeCurrency(whisperEn[5]),
      league: whisperEn[6].trim(),
      raw: msg,
    }
  }

  const whisperZh1 = WHISPER_ZH_1.exec(msg)
  if (whisperZh1) {
    const direction = whisperZh1[1] === '向' ? 'outgoing' : 'incoming'
    return {
      kind: 'tradeWhisper',
      at,
      direction,
      character: whisperZh1[2].trim(),
      item: whisperZh1[3].trim(),
      amount: Number(whisperZh1[4]),
      currency: normalizeCurrency(whisperZh1[5]),
      league: whisperZh1[6].trim(),
      raw: msg,
    }
  }

  const whisperZh2 = WHISPER_ZH_2.exec(msg)
  if (whisperZh2) {
    const direction = whisperZh2[1] === '向' ? 'outgoing' : 'incoming'
    return {
      kind: 'tradeWhisper',
      at,
      direction,
      character: whisperZh2[2].trim(),
      item: whisperZh2[6].trim(),
      amount: Number(whisperZh2[4]),
      currency: normalizeCurrency(whisperZh2[5]),
      league: whisperZh2[3].trim(),
      raw: msg,
    }
  }

  return null
}

/** Parse a batch of lines, keeping the events and dropping the noise. */
export function parseLogLines(lines: readonly string[]): LogEvent[] {
  const events: LogEvent[] = []
  for (const line of lines) {
    const event = parseLogLine(line)
    if (event) events.push(event)
  }
  return events
}

import { describe, expect, it } from 'vitest'
import {
  areaKindOf,
  buildSession,
  currentAreaOf,
  emptyFollow,
  ingestChunk,
  isScreenName,
  normalizeCurrency,
  parseLogLine,
  parseLogLines,
  resumeEvents,
  summariseLedger,
  summariseSession,
  tradeToLedgerEntry,
} from '../src/index.js'
import type { CompletedTrade, LedgerEntry, LogChunk, LogEvent } from '../src/index.js'

/** Build a log line the way the client writes it, from a base time in seconds. */
function line(base: number, seconds: number, message: string): string {
  const at = new Date(base + seconds * 1000)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  const stamp = `${at.getFullYear()}/${p(at.getMonth() + 1)}/${p(at.getDate())} ${p(at.getHours())}:${p(at.getMinutes())}:${p(at.getSeconds())}`
  return `${stamp} [INFO Client 8224] ${message}`
}

const T0 = new Date(2026, 5, 29, 22, 18, 37).getTime()

describe('parseLogLine', () => {
  it('reads the four line shapes the client actually writes', () => {
    // The opening banner has no [INFO Client] tag at all.
    expect(parseLogLine('2026/06/29 22:18:37 ***** LOG FILE OPENING *****')).toEqual({ kind: 'logOpen', at: T0 })

    expect(parseLogLine(line(T0, 0, 'Generating level 79 area "MapDeforestation" with seed 569701987'))).toEqual({
      kind: 'area',
      at: T0,
      code: 'MapDeforestation',
      level: 79,
    })

    expect(parseLogLine(line(T0, 0, '[SCENE] Set Source [毁坏的林场]'))).toEqual({
      kind: 'scene',
      at: T0,
      name: '毁坏的林场',
    })

    expect(parseLogLine(line(T0, 0, '[LOADING SCREEN] (藏身处：海岸) Duration = 3.5 seconds'))).toEqual({
      kind: 'loading',
      at: T0,
      name: '藏身处：海岸',
      seconds: 3.5,
    })
  })

  it('reads a debug-level line and one with the millisecond/hash prefix', () => {
    expect(
      parseLogLine('2026/06/29 22:18:37 [DEBUG Client 8224] Generating level 1 area "HideoutShoreline" with seed 1'),
    ).toMatchObject({ kind: 'area', code: 'HideoutShoreline', level: 1 })

    expect(parseLogLine('2026/06/29 22:18:37 123 4f2a91c0 [INFO Client 8224] [SCENE] Set Source [海岸藏身处]')).toEqual({
      kind: 'scene',
      at: T0,
      name: '海岸藏身处',
    })
  })

  it('drops the 国服 noise instead of mistaking it for a timeline event', () => {
    const noise = [
      '',
      '   ',
      '[WeGamePlatform] access token refresh ok',
      'wegame_helper_sdk is not enabled',
      '2026/06/29 22:18:56 [INFO Client 8224] Async connecting to 43.145.11.40:20481',
      '2026/06/29 22:18:56 [INFO Client 8224] [VULKAN] device created',
      '2026/06/29 22:18:56 [WARN Client 8224] [VIDEO] Failed to open Bink file',
      '2026/06/29 22:18:56 [WARN Client 8224] MavenJewelRadiusKeystones is not supported',
      '2026/06/29 22:18:56 [INFO Client 8224] 使用物品失败： 此物品无法再新增任何属性。',
      'not a log line at all',
    ]
    expect(parseLogLines(noise)).toEqual([])
  })

  it('recognises a level-up and treats a missing Chinese death wording as no event', () => {
    expect(parseLogLine(line(T0, 3, ': 阿蛮 is now level 42'))).toEqual({ kind: 'levelUp', at: T0 + 3000, level: 42 })
    // Unverified Chinese wording must not turn a chat line into a death.
    expect(parseLogLine(line(T0, 4, '@From 买家: 你那个装备死了没'))).toBeNull()
  })
})

describe('area classification', () => {
  it('calls only the Map-prefixed codes maps', () => {
    expect(areaKindOf('MapDeforestation')).toBe('map')
    expect(areaKindOf('HideoutShoreline')).toBe('hideout')
    expect(areaKindOf('Abyss_Pinnacle')).toBe('other')
    expect(areaKindOf('TheRiverbank')).toBe('other')
    expect(areaKindOf(null)).toBe('other')
  })

  it('knows a screen is not a place', () => {
    expect(isScreenName('(null)')).toBe(true)
    expect(isScreenName('(unknown)')).toBe(true)
    expect(isScreenName('毁坏的林场')).toBe(false)
  })
})

/** A farming loop: hideout → map → hideout → map → hideout. */
function farmingLoop(): LogEvent[] {
  const scene = (t: number, name: string): LogEvent => ({ kind: 'scene', at: T0 + t * 1000, name })
  const area = (t: number, code: string): LogEvent => ({ kind: 'area', at: T0 + t * 1000, code, level: 79 })
  const loading = (t: number, name: string, seconds: number): LogEvent => ({
    kind: 'loading',
    at: T0 + t * 1000,
    name,
    seconds,
  })
  return [
    area(0, 'HideoutShoreline'),
    scene(0, '海岸藏身处'),
    loading(0, '海岸藏身处', 4),
    area(10, 'MapDeforestation'),
    scene(10, '毁坏的林场'),
    loading(11, '毁坏的林场', 3),
    scene(70, '海岸藏身处'),
    loading(71, '海岸藏身处', 2),
    area(75, 'MapSand'),
    scene(75, '沙地'),
    scene(115, '海岸藏身处'),
    { kind: 'death', at: T0 + 30_000 },
    { kind: 'death', at: T0 + 95_000 },
  ]
}

describe('buildSession', () => {
  it('records one visit per scene change and closes it on the next', () => {
    const session = buildSession(farmingLoop(), { startedAt: T0 })
    expect(session.visits.map((v) => [v.name, v.kind])).toEqual([
      ['海岸藏身处', 'hideout'],
      ['毁坏的林场', 'map'],
      ['海岸藏身处', 'hideout'],
      ['沙地', 'map'],
      ['海岸藏身处', 'hideout'],
    ])
    expect(session.visits[1].code).toBe('MapDeforestation')
    expect(session.visits[1].level).toBe(79)
    // Each visit ends when the next scene is set.
    expect(session.visits[1].startAt).toBe(T0 + 10_000)
    expect(session.visits[1].endAt).toBe(T0 + 70_000)
    expect(session.visits[4].endAt).toBeNull()
    expect(session.deaths).toBe(2)
  })

  it('remembers an area by name, because a return trip generates no code', () => {
    const events: LogEvent[] = [
      { kind: 'area', at: T0, code: 'HideoutShoreline', level: 1 },
      { kind: 'scene', at: T0, name: '海岸藏身处' },
      { kind: 'area', at: T0 + 10_000, code: 'MapDeforestation', level: 79 },
      { kind: 'scene', at: T0 + 10_000, name: '毁坏的林场' },
      // Walking back out: the hideout instance already exists, so no code.
      { kind: 'scene', at: T0 + 70_000, name: '海岸藏身处' },
    ]
    const session = buildSession(events, { startedAt: T0 })
    expect(session.visits.map((v) => [v.name, v.kind, v.code])).toEqual([
      ['海岸藏身处', 'hideout', 'HideoutShoreline'],
      ['毁坏的林场', 'map', 'MapDeforestation'],
      ['海岸藏身处', 'hideout', null],
    ])
    expect(summariseSession(session, T0 + 90_000)).toMatchObject({ mapCount: 1, mapMs: 60_000, otherMs: 30_000 })
  })

  it('charges a loading screen to the visit that was open when it appeared', () => {
    const session = buildSession(farmingLoop(), { startedAt: T0 })
    expect(session.visits.map((v) => v.loadingMs)).toEqual([4000, 3000, 2000, 0, 0])
    expect(session.looseLoadingMs).toBe(0)
  })

  it('does not open a visit for a loading screen or the main menu', () => {
    const events: LogEvent[] = [
      { kind: 'scene', at: T0, name: '海岸藏身处' },
      { kind: 'scene', at: T0 + 5000, name: '(null)' },
      { kind: 'scene', at: T0 + 9000, name: '(unknown)' },
      { kind: 'scene', at: T0 + 20_000, name: '毁坏的林场' },
    ]
    const session = buildSession(events, { startedAt: T0 })
    expect(session.visits.map((v) => v.name)).toEqual(['海岸藏身处', '毁坏的林场'])
    // The 11 seconds in menus are not in any visit, so they land in `otherMs`.
    expect(session.visits[0].endAt).toBe(T0 + 5000)
    expect(session.visits[1].startAt).toBe(T0 + 20_000)
  })

  it('ends the current visit when the client restarts, and keeps the session', () => {
    const events: LogEvent[] = [
      { kind: 'scene', at: T0, name: '毁坏的林场' },
      { kind: 'logOpen', at: T0 + 60_000 },
      { kind: 'scene', at: T0 + 70_000, name: '沙地' },
    ]
    const session = buildSession(events, { startedAt: T0 })
    expect(session.restarts).toBe(1)
    expect(session.visits[0].endAt).toBe(T0 + 60_000)
    expect(session.visits[1].startAt).toBe(T0 + 70_000)
  })

  it('starts the clock at the player, not at the first event', () => {
    const events: LogEvent[] = [{ kind: 'scene', at: T0 + 120_000, name: '毁坏的林场' }]
    expect(buildSession(events, { startedAt: T0 }).startedAt).toBe(T0)
    expect(buildSession(events).startedAt).toBe(T0 + 120_000)
  })
})

describe('summariseSession', () => {
  it('counts maps, subtracts loading, and measures the clock from the start', () => {
    const session = buildSession(farmingLoop(), { startedAt: T0 })
    const now = T0 + 150_000
    const s = summariseSession(session, now)

    expect(s.totalMs).toBe(150_000)
    expect(s.mapCount).toBe(2)
    // 60s + 40s wall clock, of which 3s of loading belongs to the first map.
    expect(s.mapMs).toBe(100_000)
    expect(s.netMapMs).toBe(97_000)
    expect(s.avgMapMs).toBe(48_500)
    expect(s.mapsPerHour).toBeCloseTo(48, 5)
    expect(s.loadingMs).toBe(9000)
    expect(s.otherMs).toBe(44_000)
    expect(s.deaths).toBe(2)
    expect(s.current?.name).toBe('海岸藏身处')
  })

  it('splits the session into three parts that add back up to the clock', () => {
    const session = buildSession(farmingLoop(), { startedAt: T0 })
    const s = summariseSession(session, T0 + 150_000)
    expect(s.netMapMs + s.otherMs + s.loadingMs).toBe(s.totalMs)
  })

  it('never reports a negative share when loading is longer than the map it is charged to', () => {
    // A very slow load into a map the player leaves immediately.
    const events: LogEvent[] = [
      { kind: 'area', at: T0, code: 'MapSand', level: 79 },
      { kind: 'scene', at: T0, name: '沙地' },
      { kind: 'loading', at: T0 + 1000, name: '沙地', seconds: 30 },
      { kind: 'scene', at: T0 + 2000, name: '海岸藏身处' },
    ]
    const s = summariseSession(buildSession(events, { startedAt: T0 }), T0 + 2000)
    expect(s.mapMs).toBe(2000)
    expect(s.netMapMs).toBe(0)
    expect(s.otherMs).toBe(0)
    expect(s.loadingMs).toBe(30_000)
    expect(s.netMapMs).toBeGreaterThanOrEqual(0)
  })

  it('counts an open visit against now, so the clock runs while you play', () => {
    const events: LogEvent[] = [
      { kind: 'area', at: T0, code: 'MapDeforestation', level: 79 },
      { kind: 'scene', at: T0, name: '毁坏的林场' },
    ]
    const session = buildSession(events, { startedAt: T0 })
    expect(summariseSession(session, T0 + 30_000).avgMapMs).toBe(30_000)
    expect(summariseSession(session, T0 + 90_000).avgMapMs).toBe(90_000)
  })

  it('reports zero rather than NaN for a session that has not run a map', () => {
    const s = summariseSession(buildSession([], { startedAt: T0 }), T0)
    expect(s.mapCount).toBe(0)
    expect(s.avgMapMs).toBe(0)
    expect(s.mapsPerHour).toBe(0)
    expect(s.current).toBeNull()
  })

  it('reports the last level-up reached', () => {
    const events: LogEvent[] = [
      { kind: 'levelUp', at: T0, level: 90 },
      { kind: 'levelUp', at: T0 + 1000, level: 91 },
    ]
    expect(summariseSession(buildSession(events, { startedAt: T0 }), T0 + 1000).lastLevel).toBe(91)
  })
})

describe('summariseLedger', () => {
  const entry = (kind: 'income' | 'cost', amount: number, currency = 'exalted'): LedgerEntry => ({
    id: `${kind}-${amount}-${currency}`,
    at: T0,
    label: '测试',
    amount,
    currency,
    kind,
  })

  it('totals the most-used currency and leaves the rest visible', () => {
    const s = summariseLedger([entry('income', 10), entry('income', 5), entry('cost', 3), entry('income', 2, 'chaos')], 3_600_000)
    expect(s.currency).toBe('exalted')
    expect(s.income).toBe(15)
    expect(s.cost).toBe(3)
    expect(s.net).toBe(12)
    expect(s.netPerHour).toBe(12)
    expect(s.entries).toBe(4)
    expect(s.others).toEqual([{ currency: 'chaos', count: 1 }])
  })

  it('is empty rather than wrong on an empty book', () => {
    const s = summariseLedger([], 3_600_000)
    expect(s).toMatchObject({ currency: null, income: 0, cost: 0, net: 0, netPerHour: 0, entries: 0, others: [] })
  })

  it('does not divide by a zero-length session', () => {
    expect(summariseLedger([entry('income', 4)], 0).netPerHour).toBe(0)
  })
})

describe('following the log', () => {
  const chunk = (lines: string[], offset: number, truncated = false): LogChunk => ({
    lines,
    offset,
    size: offset,
    truncated,
  })

  it('appends new events and remembers the offset', () => {
    let state = emptyFollow()
    state = ingestChunk(state, chunk([line(T0, 0, '[SCENE] Set Source [海岸]')], 100))
    state = ingestChunk(state, chunk([line(T0, 5, 'Generating level 79 area "MapSand" with seed 2')], 200))
    expect(state.offset).toBe(200)
    expect(state.events.map((e) => e.kind)).toEqual(['scene', 'area'])
    expect(state.resets).toBe(0)
  })

  it('still advances the offset when a read holds only noise', () => {
    const state = ingestChunk(emptyFollow(), chunk(['2026/06/29 22:18:56 [INFO Client 8224] [VULKAN] ok'], 64))
    expect(state).toMatchObject({ offset: 64, events: [], resets: 0 })
  })

  it('throws the old events away when the file was replaced, rather than mixing files', () => {
    let state = ingestChunk(emptyFollow(), chunk([line(T0, 0, '[SCENE] Set Source [海岸]')], 100))
    state = ingestChunk(state, chunk([line(T0, 60, '[SCENE] Set Source [林场]')], 40, true))
    expect(state.resets).toBe(1)
    expect(state.offset).toBe(40)
    expect(state.events.map((e) => (e.kind === 'scene' ? e.name : e.kind))).toEqual(['林场'])
  })
})

describe('resuming mid-session', () => {
  it('finds the area the player is already standing in', () => {
    const tail = [
      line(T0, 0, 'Generating level 79 area "MapDeforestation" with seed 1'),
      line(T0, 0, '[SCENE] Set Source [毁坏的林场]'),
    ]
    expect(currentAreaOf(tail)).toEqual({ code: 'MapDeforestation', level: 79, name: '毁坏的林场' })
  })

  it('has no answer when the last thing seen was the main menu', () => {
    const tail = [
      line(T0, 0, 'Generating level 79 area "MapDeforestation" with seed 1'),
      line(T0, 0, '[SCENE] Set Source [毁坏的林场]'),
      line(T0, 90, '[SCENE] Set Source [(null)]'),
    ]
    expect(currentAreaOf(tail)).toBeNull()
    expect(resumeEvents(tail, T0 + 120_000)).toEqual([])
  })

  it('stamps the resumed area at the session start, not at when it was entered', () => {
    const tail = [
      line(T0, 0, 'Generating level 79 area "MapDeforestation" with seed 1'),
      line(T0, 0, '[SCENE] Set Source [毁坏的林场]'),
    ]
    const at = T0 + 600_000
    expect(resumeEvents(tail, at)).toEqual([
      { kind: 'area', at, code: 'MapDeforestation', level: 79 },
      { kind: 'scene', at, name: '毁坏的林场' },
    ])
    // A map already open for ten minutes counts from zero, not from ten.
    const session = buildSession(resumeEvents(tail, at), { startedAt: at })
    expect(summariseSession(session, at + 60_000)).toMatchObject({ mapCount: 1, mapMs: 60_000, totalMs: 60_000 })
  })

  it('keeps the code it saw before the area it is standing in', () => {
    const tail = [
      line(T0, 0, 'Generating level 1 area "HideoutShoreline" with seed 1'),
      line(T0, 0, '[SCENE] Set Source [海岸藏身处]'),
      line(T0, 30, '[SCENE] Set Source [毁坏的林场]'),
    ]
    // The map was walked into through a portal, so no generating line followed.
    expect(currentAreaOf(tail)).toEqual({ code: 'HideoutShoreline', level: 1, name: '毁坏的林场' })
  })
})

describe('log to summary, end to end', () => {
  it('turns a real-shaped log into a session', () => {
    const lines = [
      '2026/06/29 22:18:37 ***** LOG FILE OPENING *****',
      line(T0, 0, 'Generating level 1 area "HideoutShoreline" with seed 1'),
      line(T0, 0, '[SCENE] Set Source [藏身处：海岸]'),
      line(T0, 0, '[LOADING SCREEN] (藏身处：海岸) Duration = 3.5 seconds'),
      line(T0, 30, 'Generating level 79 area "MapDeforestation" with seed 569701987'),
      line(T0, 30, '[SCENE] Set Source [毁坏的林场]'),
      line(T0, 33, '[LOADING SCREEN] (毁坏的林场) Duration = 2.5 seconds'),
      line(T0, 200, '[SCENE] Set Source [藏身处：海岸]'),
      line(T0, 205, '[WeGamePlatform] access token refresh ok'),
    ]
    const session = buildSession(parseLogLines(lines), { startedAt: T0 })
    const s = summariseSession(session, T0 + 240_000)
    expect(session.restarts).toBe(1)
    expect(s.mapCount).toBe(1)
    expect(s.mapMs).toBe(170_000)
    expect(s.netMapMs).toBe(167_500)
    expect(s.loadingMs).toBe(6000)
    expect(s.otherMs).toBe(66_500)
  })
})

describe('trade whisper and p2p trade parsing', () => {
  it('normalizes common currency names', () => {
    expect(normalizeCurrency('divine')).toBe('divine')
    expect(normalizeCurrency('Divine Orb')).toBe('divine')
    expect(normalizeCurrency('神圣石')).toBe('divine')
    expect(normalizeCurrency('神聖石')).toBe('divine')
    expect(normalizeCurrency('chaos')).toBe('chaos')
    expect(normalizeCurrency('混沌石')).toBe('chaos')
    expect(normalizeCurrency('exalted')).toBe('exalted')
    expect(normalizeCurrency('崇高石')).toBe('exalted')
    expect(normalizeCurrency('mirror')).toBe('mirror')
    expect(normalizeCurrency('卡兰德的魔镜')).toBe('mirror')
  })

  it('parses English trade whispers (incoming and outgoing)', () => {
    const incoming = line(
      T0,
      10,
      '@From <PRO> Slayer: Hi, I would like to buy your Tabula Rasa Simple Robe listed for 5 divine in Standard (stash tab "~b/o 5 divine"; position: left 2, top 3)',
    )
    expect(parseLogLine(incoming)).toEqual({
      kind: 'tradeWhisper',
      at: T0 + 10_000,
      direction: 'incoming',
      character: 'Slayer',
      item: 'Tabula Rasa Simple Robe',
      amount: 5,
      currency: 'divine',
      league: 'Standard',
      raw: expect.any(String),
    })

    const outgoing = line(
      T0,
      20,
      '@To Merchant: Hi, I would like to buy your Headhunter Heavy Belt listed for 50 divine in Settlers',
    )
    expect(parseLogLine(outgoing)).toMatchObject({
      kind: 'tradeWhisper',
      direction: 'outgoing',
      character: 'Merchant',
      item: 'Headhunter Heavy Belt',
      amount: 50,
      currency: 'divine',
      league: 'Settlers',
    })
  })

  it('parses Chinese trade whispers (国服 & 台服)', () => {
    const cn1 = line(
      T0,
      10,
      '@来自 <NB> 狂战士: 你好，我想购买你的 破晓之剑 标价为 2.5 神圣石 于 裂隙赛季 (仓库页 "出售"; 位置: 靠左 1, 靠顶 1)',
    )
    expect(parseLogLine(cn1)).toEqual({
      kind: 'tradeWhisper',
      at: T0 + 10_000,
      direction: 'incoming',
      character: '狂战士',
      item: '破晓之剑',
      amount: 2.5,
      currency: 'divine',
      league: '裂隙赛季',
      raw: expect.any(String),
    })

    const cn2 = line(
      T0,
      15,
      '@向 老王: 你好，我想购买你在 奥杜尔秘符 标价为 10 混沌石 的 禁断之肉 (仓库页 "买卖")',
    )
    expect(parseLogLine(cn2)).toMatchObject({
      kind: 'tradeWhisper',
      direction: 'outgoing',
      character: '老王',
      item: '禁断之肉',
      amount: 10,
      currency: 'chaos',
      league: '奥杜尔秘符',
    })

    const tw = line(
      T0,
      20,
      '@來自 傲嬌法師: 你好，我想購買你的 烈炎之翼 標價為 1 神聖石 於 降臨 (倉庫頁 "賣"; 位置: 靠左 2, 靠頂 3)',
    )
    expect(parseLogLine(tw)).toMatchObject({
      kind: 'tradeWhisper',
      direction: 'incoming',
      character: '傲嬌法師',
      item: '烈炎之翼',
      amount: 1,
      currency: 'divine',
      league: '降臨',
    })
  })

  it('parses trade accepted and trade cancelled lines', () => {
    expect(parseLogLine(line(T0, 30, 'Trade accepted.'))).toEqual({ kind: 'tradeAccepted', at: T0 + 30_000 })
    expect(parseLogLine(line(T0, 31, ': Trade accepted.'))).toEqual({ kind: 'tradeAccepted', at: T0 + 31_000 })
    expect(parseLogLine(line(T0, 32, 'Trade cancelled.'))).toEqual({ kind: 'tradeCancelled', at: T0 + 32_000 })
  })

  it('reconciles whisper with trade accepted in buildSession', () => {
    const lines = [
      line(T0, 0, 'Generating level 1 area "HideoutShoreline" with seed 1'),
      line(T0, 0, '[SCENE] Set Source [藏身处：海岸]'),
      line(T0, 10, '@来自 买家A: 你好，我想购买你的 崇高之愿 标价为 10 神圣石 于 奥杜尔秘符'),
      line(T0, 45, 'Trade accepted.'),
      line(T0, 60, '@向 卖家B: 你好，我想购买你的 门票 标价为 2 神圣石 于 奥杜尔秘符'),
      line(T0, 80, 'Trade accepted.'),
    ]
    const session = buildSession(parseLogLines(lines), { startedAt: T0 })
    expect(session.trades).toHaveLength(2)

    expect(session.trades[0]).toMatchObject({
      direction: 'incoming',
      character: '买家A',
      item: '崇高之愿',
      amount: 10,
      currency: 'divine',
    })

    expect(session.trades[1]).toMatchObject({
      direction: 'outgoing',
      character: '卖家B',
      item: '门票',
      amount: 2,
      currency: 'divine',
    })

    // Convert to ledger entries
    const entry0 = tradeToLedgerEntry(session.trades[0])
    expect(entry0).toMatchObject({
      kind: 'income',
      amount: 10,
      currency: 'divine',
      source: 'trade',
      label: '出售: 崇高之愿 (买家A)',
    })

    const entry1 = tradeToLedgerEntry(session.trades[1])
    expect(entry1).toMatchObject({
      kind: 'cost',
      amount: 2,
      currency: 'divine',
      source: 'trade',
      label: '购买: 门票 (卖家B)',
    })

    // Ledger summary handles source breakdown
    const summary = summariseLedger([entry0, entry1], 3600_000)
    expect(summary.income).toBe(10)
    expect(summary.cost).toBe(2)
    expect(summary.net).toBe(8)
    expect(summary.tradeIncome).toBe(10)
    expect(summary.tradeCost).toBe(2)
    expect(summary.dropIncome).toBe(0)
  })
})

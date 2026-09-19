/**
 * Fold the log timeline into per-area visits and a session summary.
 *
 * A visit is "one stretch of time the client had a given area loaded". Its
 * length is measured wall-clock, from the moment the scene was set to the moment
 * the next one was — which means the loading screen of the *next* area lands
 * inside it, because that is genuinely when the client spent that time. Loading
 * is tracked separately so the summary can subtract it and so a mis-attributed
 * load cannot move the session totals, only the per-visit split.
 */
import { areaKindOf, isScreenName } from './logEvents.js'
import type { LogEvent } from './logEvents.js'
import type { LedgerEntry } from './ledger.js'

export type AreaKind = 'map' | 'hideout' | 'other'

export interface CompletedTrade {
  id: string
  at: number
  direction: 'incoming' | 'outgoing'
  character: string
  item: string
  amount: number
  currency: string
  league: string
}

export function tradeToLedgerEntry(trade: CompletedTrade): LedgerEntry {
  return {
    id: `trade-${trade.id}`,
    at: trade.at,
    label:
      trade.direction === 'incoming'
        ? `出售: ${trade.item} (${trade.character})`
        : `购买: ${trade.item} (${trade.character})`,
    amount: trade.amount,
    currency: trade.currency,
    kind: trade.direction === 'incoming' ? 'income' : 'cost',
    source: 'trade',
  }
}

export interface AreaVisit {
  /** English area code from `Generating level …`, when one was seen. */
  code: string | null
  /** What the player's own client calls the area. */
  name: string
  kind: AreaKind
  /** Monster level of the instance, from the generating line. */
  level: number | null
  startAt: number
  /** Null while the visit is still open. */
  endAt: number | null
  /**
   * Loading-screen seconds attributed to this visit, in ms. Best-effort: the
   * client does not say which transition a loading line belongs to, so this can
   * land on either side of a boundary. `summariseSession` reports the session
   * total separately for that reason.
   */
  loadingMs: number
}

export interface FarmSession {
  /** When the session started — the moment the player pressed 开始. */
  startedAt: number
  /** Null while live; the caller passes `now` to the summary instead. */
  endedAt: number | null
  visits: AreaVisit[]
  deaths: number
  levelUps: { at: number; level: number }[]
  /** Times the game was restarted mid-session (`LOG FILE OPENING`). */
  restarts: number
  /** Loading time that could not be tied to any visit. */
  looseLoadingMs: number
  /** Successfully concluded peer-to-peer trades. */
  trades: CompletedTrade[]
}

export interface FarmSummary {
  /** Wall-clock length of the session. */
  totalMs: number
  /** Areas whose code says they are maps. */
  mapCount: number
  /** Wall-clock time spent with a map loaded. */
  mapMs: number
  /** `mapMs` minus the loading attributed to those visits. */
  netMapMs: number
  avgMapMs: number
  /** Maps per wall-clock hour, which is the number players compare. */
  mapsPerHour: number
  /**
   * Hideout, town and menu time, plus any stretch the log never accounted for.
   * Derived by subtraction so the headline figures partition the session: this
   * plus {@link netMapMs} plus {@link loadingMs} is exactly {@link totalMs}.
   */
  otherMs: number
  loadingMs: number
  deaths: number
  /** Highest level reached in this session, if any level-up was logged. */
  lastLevel: number | null
  restarts: number
  /** The area currently loaded, if the session is live and one is open. */
  current: AreaVisit | null
}

/**
 * Build the visit list from an event stream.
 *
 * `startedAt` is the player's own start, not the first event: the log is tailed
 * from the current end of file, so the first area change can be minutes after
 * the session began, and counting from the first event would silently drop that.
 */
export function buildSession(events: readonly LogEvent[], options: { startedAt?: number } = {}): FarmSession {
  const session: FarmSession = {
    startedAt: options.startedAt ?? events[0]?.at ?? Date.now(),
    endedAt: null,
    visits: [],
    deaths: 0,
    levelUps: [],
    restarts: 0,
    looseLoadingMs: 0,
    trades: [],
  }

  /** Code and level from the most recent `Generating level …` line. */
  let pendingCode: string | null = null
  let pendingLevel: number | null = null
  let current: AreaVisit | null = null
  const pendingWhispers: Extract<LogEvent, { kind: 'tradeWhisper' }>[] = []
  /**
   * Display name -> kind, learned the first time that area was generated.
   *
   * Only a *new* instance logs `Generating level … area …`, so walking back into
   * a hideout — or back through a portal into a map you already opened — gives a
   * `Set Source` line with no code at all. Without this, every return trip would
   * be filed as an unknown area and the hideout would never show up in the
   * breakdown, which is the opposite of what a farmer wants to see.
   */
  const kindByName = new Map<string, AreaKind>()

  const close = (at: number) => {
    if (current) current.endAt = at
    current = null
  }

  for (const event of events) {
    switch (event.kind) {
      case 'logOpen':
        // The client restarted, so whatever was loaded is gone. The session
        // itself survives — the player is still farming.
        session.restarts++
        close(event.at)
        pendingCode = null
        pendingLevel = null
        break

      case 'area':
        pendingCode = event.code
        pendingLevel = event.level
        break

      case 'scene': {
        close(event.at)
        if (isScreenName(event.name)) {
          // A loading screen or the main menu is not a place. Leaving `current`
          // null means the time is counted as neither map nor hideout, which is
          // what it is.
          pendingCode = null
          pendingLevel = null
          break
        }
        const code = pendingCode
        const kind = code ? areaKindOf(code) : kindByName.get(event.name) ?? 'other'
        if (code) kindByName.set(event.name, kind)
        current = {
          code,
          name: event.name,
          kind,
          level: pendingLevel,
          startAt: event.at,
          endAt: null,
          loadingMs: 0,
        }
        session.visits.push(current)
        pendingCode = null
        pendingLevel = null
        break
      }

      case 'loading': {
        const ms = Math.round(event.seconds * 1000)
        // The visit that is open when the line appears is the one whose clock
        // the loading screen is running against. Falling back to a visit by
        // name, then to the session, keeps a stray line from being lost.
        const target =
          current ?? [...session.visits].reverse().find((v) => v.name === event.name) ?? null
        if (target) target.loadingMs += ms
        else session.looseLoadingMs += ms
        break
      }

      case 'death':
        session.deaths++
        break

      case 'levelUp':
        session.levelUps.push({ at: event.at, level: event.level })
        break

      case 'tradeWhisper':
        pendingWhispers.push(event)
        break

      case 'tradeAccepted': {
        // Trade completed. Look back up to 10 minutes for the most recent whisper.
        const cutoff = event.at - 10 * 60_000
        let matchedIdx = -1
        for (let i = pendingWhispers.length - 1; i >= 0; i--) {
          if (pendingWhispers[i].at >= cutoff && pendingWhispers[i].at <= event.at) {
            matchedIdx = i
            break
          }
        }
        if (matchedIdx >= 0) {
          const matched = pendingWhispers.splice(matchedIdx, 1)[0]
          session.trades.push({
            id: `${event.at}-${matched.character}`,
            at: event.at,
            direction: matched.direction,
            character: matched.character,
            item: matched.item,
            amount: matched.amount,
            currency: matched.currency,
            league: matched.league,
          })
        }
        break
      }

      case 'tradeCancelled':
        break
    }
  }

  return session
}

/** Length of a visit, using `now` for one that is still open. */
export function visitMs(visit: AreaVisit, now: number): number {
  return Math.max(0, (visit.endAt ?? now) - visit.startAt)
}

/** How much of a visit was actually played, once its loading time is removed. */
export function visitNetMs(visit: AreaVisit, now: number): number {
  return Math.max(0, visitMs(visit, now) - visit.loadingMs)
}

/**
 * Reduce a session to the numbers a player wants after a farming run.
 *
 * The four headline figures — {@link netMapMs}, {@link otherMs},
 * {@link loadingMs} and the session clock — are a partition: they add up to
 * `totalMs` exactly. That is worth the arithmetic because adding up the numbers
 * on screen is the first thing anyone does with them, and an earlier version
 * that measured `otherMs` as "everything not in a map" double-counted the
 * loading that happened inside maps.
 */
export function summariseSession(session: FarmSession, now: number): FarmSummary {
  const end = session.endedAt ?? now
  const totalMs = Math.max(0, end - session.startedAt)

  let mapCount = 0
  let mapMs = 0
  let mapLoadingMs = 0
  let loadingMs = session.looseLoadingMs

  for (const visit of session.visits) {
    const ms = visitMs(visit, now)
    loadingMs += visit.loadingMs
    if (visit.kind !== 'map') continue
    mapCount++
    mapMs += ms
    mapLoadingMs += visit.loadingMs
  }

  const netMapMs = Math.max(0, mapMs - mapLoadingMs)
  const hours = totalMs / 3_600_000
  return {
    totalMs,
    mapCount,
    mapMs,
    netMapMs,
    avgMapMs: mapCount > 0 ? netMapMs / mapCount : 0,
    mapsPerHour: hours > 0 ? mapCount / hours : 0,
    otherMs: Math.max(0, totalMs - netMapMs - loadingMs),
    loadingMs,
    deaths: session.deaths,
    lastLevel: session.levelUps.length > 0 ? session.levelUps[session.levelUps.length - 1].level : null,
    restarts: session.restarts,
    current: session.visits.find((v) => v.endAt == null) ?? null,
  }
}

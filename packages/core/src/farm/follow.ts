/**
 * Following the log as it grows.
 *
 * The reading itself has to happen in Rust (the webview cannot open a file at a
 * path the user typed), but *what to do* with each read is plain logic, so it
 * lives here where it can be tested without a game running: keep a byte offset,
 * fold new lines into an event list, and notice when the file was replaced
 * underneath us.
 */
import { isScreenName, parseLogLines } from './logEvents.js'
import type { LogEvent } from './logEvents.js'

/** What a single read of the log returned. Mirrors the Rust `LogChunk`. */
export interface LogChunk {
  lines: string[]
  /** Byte offset to pass back on the next read. */
  offset: number
  size: number
  /**
   * The file was shorter than the offset we asked from, so it was truncated or
   * replaced — the game rewrote it, or the player deleted it mid-session.
   */
  truncated: boolean
}

export interface FollowState {
  offset: number
  events: LogEvent[]
  /** How many times the file was replaced under us, for the UI to mention. */
  resets: number
}

export function emptyFollow(): FollowState {
  return { offset: 0, events: [], resets: 0 }
}

/**
 * Fold one read into the follow state.
 *
 * A truncation replaces the event list rather than appending to it. Appending
 * would mix timestamps from two different files, and since the summary measures
 * visits by consecutive event times, out-of-order events would silently produce
 * negative-length visits. Losing the earlier part of the session is the honest
 * outcome — the log that described it no longer exists.
 */
export function ingestChunk(state: FollowState, chunk: LogChunk): FollowState {
  const fresh = parseLogLines(chunk.lines)
  if (chunk.truncated) {
    return { offset: chunk.offset, events: fresh, resets: state.resets + 1 }
  }
  if (fresh.length === 0) return { ...state, offset: chunk.offset }
  return { offset: chunk.offset, events: [...state.events, ...fresh], resets: state.resets }
}

/**
 * The area the player is standing in, read out of the end of the log.
 *
 * Needed because a session starts while the game is already running: tailing
 * from the current end of file means the next line is a whole map away, and
 * until then the tracker would have no idea where the player is.
 *
 * A `Set Source` naming a loading screen or the main menu clears the answer —
 * being at the main menu is not being in an area.
 */
export function currentAreaOf(lines: readonly string[]): { code: string | null; level: number | null; name: string } | null {
  let code: string | null = null
  let level: number | null = null
  let found: { code: string | null; level: number | null; name: string } | null = null

  for (const event of parseLogLines(lines)) {
    if (event.kind === 'area') {
      code = event.code
      level = event.level
    } else if (event.kind === 'scene') {
      if (isScreenName(event.name)) {
        found = null
        code = null
        level = null
      } else {
        found = { code, level, name: event.name }
      }
    }
  }
  return found
}

/**
 * Events that open a session with the area the player is already in.
 *
 * The area is stamped at the session's own start rather than at the time it was
 * really entered, because the session did not exist before that: a player who
 * presses 开始 ten minutes into a map should see that map counted from zero, not
 * ten minutes of farming they were not tracking.
 */
export function resumeEvents(lines: readonly string[], at: number): LogEvent[] {
  const area = currentAreaOf(lines)
  if (!area) return []
  const events: LogEvent[] = []
  if (area.code) events.push({ kind: 'area', at, code: area.code, level: area.level })
  events.push({ kind: 'scene', at, name: area.name })
  return events
}

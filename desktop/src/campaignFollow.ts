/**
 * Moving the campaign guide's pointer to wherever the player actually is.
 *
 * The client log announces every area transition with the area's display name
 * (`[SCENE] Set Source [名]`, with `[LOADING SCREEN] (名)` as a sometimes-only
 * companion), and the same log the farm session reads is the one that carries
 * them. This module tails that log for the app's lifetime — one small read a
 * second, the same order of cost as a running farm session — resolves each name
 * against the campaign data, and writes the shared pointer when the player
 * walks into a zone the guide knows. The pinned panel and the 剧情路线 tab both
 * read the pointer, so neither needs to know this exists: the panel watches
 * `storage` events, and the tab reads this module's reactive state.
 *
 * Deliberately not done here:
 *
 *  - **Ticking zones done.** Walking into a zone is not clearing it — the boss
 *    may well be alive. Ticks stay manual.
 *  - **Guessing.** A name nothing in the campaign answers to (maps, hideouts,
 *    boss arenas, the whole endgame) moves nothing.
 *
 * The log path is remembered per realm, because the realms are different
 * installs: a path remembered for 国服 is nonsense for 国际服.
 */
import { reactive, watch } from 'vue'
import {
  campaignNameIndex,
  currentAreaOf,
  emptyFollow,
  ingestChunk,
  resolveCampaignZone,
  type CampaignZoneRef,
  type FollowState,
} from '@poe2coach/core'
import { CAMPAIGN_ACTS, readPointer, writePointer, zoneKey } from './campaign'
import { findClientLog, readLogFrom, readLogTail, rememberLogPath, savedLogPathExact, savedLogPathLegacy } from './farmClient'
import { isDesktopRuntime } from './tradeClient'
import { realmId } from './settings'
import { toHant } from './i18n'

const TAIL_BYTES = 64 * 1024
const POLL_MS = 1000
/** When no log is known, how often to re-probe for one (the game may start later). */
const PROBE_MS = 30_000

/** Each zone's position across the whole campaign, keyed `actId:index`. */
const ORDER = new Map<string, number>()
{
  let order = 0
  for (const act of CAMPAIGN_ACTS) {
    for (let index = 0; index < act.zones.length; index++) {
      ORDER.set(`${act.id}:${index}`, order++)
    }
  }
}

/**
 * Every name every zone answers to, in play order.
 *
 * All three scripts go in regardless of realm: the Simplified spellings the
 * data is authored in, their Traditional renderings through the same
 * dictionary the UI converts with, and the English names for the English
 * client. The scripts share no characters, so a logged name can only ever be
 * ambiguous within one script, which the resolver settles by position.
 */
const NAME_INDEX = campaignNameIndex(
  CAMPAIGN_ACTS.flatMap((act) =>
    act.zones.flatMap((zone, index) => {
      const names = [zone.en]
      if (zone.zh) {
        names.push(zone.zh)
        const hant = toHant(zone.zh)
        if (hant !== zone.zh) names.push(hant)
      }
      const ref: CampaignZoneRef = {
        key: zoneKey(act, zone),
        act: act.id,
        index,
        order: ORDER.get(`${act.id}:${index}`) ?? 0,
      }
      return names.map((name) => ({ ref, name }))
    }),
  ),
)

export const campaignFollow = reactive({
  /** Polling a known log. */
  active: false,
  /** The log being tailed, or '' while none has been found yet. */
  path: '',
  /** The zone key the player was last resolved into, for the guide's badge. */
  zoneKey: null as string | null,
  /** What stopped following, shown as one line on the guide. */
  error: null as string | null,
})

let follow = emptyFollow() as FollowState
let timer: number | null = null
let probing = false

/** Resolve one logged name; nothing in the campaign → null. */
function resolve(name: string): CampaignZoneRef | null {
  const pointer = readPointer()
  const act = CAMPAIGN_ACTS.find((a) => a.id === pointer.act)
  const current: CampaignZoneRef | null = act
    ? {
        key: zoneKey(act, act.zones[pointer.index]),
        act: act.id,
        index: pointer.index,
        order: ORDER.get(`${act.id}:${pointer.index}`) ?? 0,
      }
    : null
  return resolveCampaignZone(NAME_INDEX, name, current)
}

/** Point the guide at a zone the player was resolved into. */
function applyZone(zone: CampaignZoneRef): void {
  campaignFollow.zoneKey = zone.key
  const pointer = readPointer()
  if (pointer.act !== zone.act || pointer.index !== zone.index) {
    writePointer({ act: zone.act, index: zone.index })
  }
}

async function tick(): Promise<void> {
  if (!campaignFollow.path) return
  try {
    const chunk = await readLogFrom(campaignFollow.path, follow.offset)
    const before = follow.events.length
    follow = ingestChunk(follow, chunk)
    const fresh = chunk.truncated ? follow.events : follow.events.slice(before)
    for (const event of fresh) {
      const name = event.kind === 'scene' || event.kind === 'loading' ? event.name : null
      if (!name) continue
      const zone = resolve(name)
      if (zone) applyZone(zone)
    }
  } catch (e) {
    campaignFollow.error = `读取日志失败：${e instanceof Error ? e.message : String(e)}`
    // Stop tailing, forget the path, and fall back to probing: the log may
    // have been deleted or moved, and the game's next start will bring a
    // fresh one that discovery can find again. Forgetting is what makes the
    // probe useful — a remembered-but-dead path would resolve forever.
    stopPolling()
    campaignFollow.path = ''
    rememberLogPath('')
    startProbe()
  }
}

function startPolling(): void {
  if (timer != null) clearInterval(timer)
  timer = window.setInterval(tick, POLL_MS)
  campaignFollow.active = true
}

/** Re-probe for a log every little while until one shows up. */
function startProbe(): void {
  if (timer != null) clearInterval(timer)
  timer = window.setInterval(async () => {
    if (await resolvePath()) {
      campaignFollow.error = null
      await resumeFromTail()
      startPolling()
    }
  }, PROBE_MS)
}

function stopPolling(): void {
  if (timer != null) {
    clearInterval(timer)
    timer = null
  }
  campaignFollow.active = false
}

/**
 * Read the end of the log once, so a player who opens the guide mid-zone is
 * pointed at the zone they are standing in rather than waiting to move.
 */
async function resumeFromTail(): Promise<void> {
  try {
    const tail = await readLogTail(campaignFollow.path, TAIL_BYTES)
    follow = { offset: tail.offset, events: [], resets: 0 }
    const area = currentAreaOf(tail.lines)
    if (!area) return
    const zone = resolve(area.name)
    if (zone) applyZone(zone)
  } catch {
    /* the first tick will surface a real error if the file is unreadable */
  }
}

/**
 * Find this realm's log, in order of trust: the path remembered for *this*
 * realm, then discovery — which prefers the running game's own install, the
 * one answer that is right on every distributor and on machines with both
 * realms installed — and last the one global path the pre-realm version
 * remembered, which may belong to the other realm's client and so is never
 * promoted into this realm's memory.
 */
async function resolvePath(): Promise<boolean> {
  const exact = savedLogPathExact()
  if (exact) {
    campaignFollow.path = exact
    return true
  }
  if (probing) return false
  probing = true
  try {
    const found = await findClientLog()
    if (found) {
      campaignFollow.path = found
      rememberLogPath(found)
      return true
    }
  } finally {
    probing = false
  }
  const legacy = savedLogPathLegacy()
  if (legacy) {
    campaignFollow.path = legacy
    return true
  }
  return false
}

async function ensureStarted(): Promise<void> {
  if (campaignFollow.active || !isDesktopRuntime()) return
  campaignFollow.error = null
  if (!campaignFollow.path && !(await resolvePath())) {
    campaignFollow.error = '未找到游戏日志，将在游戏运行后再试。'
    startProbe()
    return
  }
  await resumeFromTail()
  startPolling()
}

function restart(): void {
  stopPolling()
  campaignFollow.path = ''
  campaignFollow.zoneKey = null
  follow = emptyFollow()
  void ensureStarted()
}

/** The realm changed: a different install, a different log. Start over. */
watch(realmId, restart)

let inited = false

/**
 * Start following. Called once from the main window's App component — the
 * overlay windows share this module's code but must not run it: they have
 * their own (much narrower) capability, and two followers would race on the
 * pointer.
 */
export function initCampaignFollow(): void {
  if (inited) return
  inited = true
  void ensureStarted()
}

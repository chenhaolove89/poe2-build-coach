/**
 * Shared state for the campaign route guide, used by two windows at once: the
 * main window's 剧情路线 tab and the in-game pinned panel.
 *
 * The windows are separate webviews that share an origin, so localStorage is
 * the hand-off and `storage` events are the notification — the same mechanism
 * the tree overlay uses for the build. Three keys:
 *
 *  - `done`    — zones the player has cleared (checkbox ticks, both windows).
 *  - `pointer` — which zone the in-game panel is showing ({ act, index }).
 *  - `panel`   — the panel's own UI prefs (locked, collapsed).
 */
import campaignJson from '@poe2coach/data/campaign.json'
import mapsJson from '@poe2coach/data/campaign-maps.json'
import stepsJson from '@poe2coach/data/campaign-steps.json'

export interface CampaignReward {
  kind: string
  amount?: number
  note?: string
  ele?: string
  swappable?: boolean
  options?: string[]
}

export interface CampaignZone {
  en: string
  zh?: string
  objective: string
  /** Shape tag, e.g. 直线 / 环形 — how the zone tends to run. */
  layout?: string
  /** One or two sentences on how to run it: direction patterns, where the boss spawns. */
  route?: string
  rewards?: CampaignReward[]
}

export interface CampaignAct {
  id: string
  zh: string
  en: string
  levels: string
  note?: string
  zones: CampaignZone[]
}

const data = campaignJson as unknown as { gameVersion: string; acts: CampaignAct[] }

export const CAMPAIGN_ACTS: CampaignAct[] = data.acts
export const CAMPAIGN_GAME_VERSION = data.gameVersion

// ------------------------------------------------------------------ zone map specs

export interface CampaignMapSpot {
  x: number
  y: number
  k: string
  l?: string
}

export interface CampaignMapVariant {
  /** Tab label, e.g. 对面偏侧 / 对面正中. */
  name: string
  outline: [number, number][]
  spots: CampaignMapSpot[]
  path?: [number, number][]
}

export interface CampaignMapSpec {
  outline: [number, number][]
  spots: CampaignMapSpot[]
  /** Suggested run order as a polyline through the markers. */
  path?: [number, number][]
  /** How much the pattern can be trusted: 极高/高/中/低/已解… */
  conf?: string
  /** Known seed behaviour: rotation/mirror/entrance-swap notes. */
  variants?: string
  /** Genuinely different layouts worth their own tab (not just rotations). */
  altLayouts?: CampaignMapVariant[]
}

const MAPS = (mapsJson as unknown as { maps: Record<string, CampaignMapSpec> }).maps

/** The schematic map drawn for this zone, or null when none exists. */
export function mapFor(act: CampaignAct, zone: CampaignZone): CampaignMapSpec | null {
  return MAPS[`${act.id}:${zone.en}`] ?? null
}

export function zoneKey(act: CampaignAct, zone: CampaignZone): string {
  return `${act.id}:${zone.en}`
}

// ------------------------------------------------------------------ walkthrough steps

export interface CampaignStep {
  /** The action, e.g. 击败浮肿米勒. */
  t: string
  /** Optional pickup / encounter — shown with a 可选 badge, never gating. */
  opt?: boolean
  /** One-line hint under the action. */
  tip?: string
}

const STEPS = (
  stepsJson as unknown as {
    steps: Record<string, { steps: CampaignStep[] }>
  }
).steps

/** The step-by-step walkthrough for this zone, or empty when none. */
export function stepsFor(act: CampaignAct, zone: CampaignZone): CampaignStep[] {
  return STEPS[`${act.id}:${zone.en}`]?.steps ?? []
}

// ------------------------------------------------------------------ per-zone notes

const NOTES_KEY = 'poe2coach.campaign.notes'

/** All personal notes, keyed by zoneKey. */
export function readNotes(): Record<string, string> {
  try {
    const raw = localStorage.getItem(NOTES_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/** Set or clear (empty text) one zone's note and persist the whole blob. */
export function writeNote(key: string, text: string): void {
  try {
    const notes = readNotes()
    if (text.trim()) notes[key] = text
    else delete notes[key]
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes))
  } catch {
    /* storage full / unavailable */
  }
}

// ------------------------------------------------------------------ export / import

export interface CampaignBackup {
  version: string
  done: string[]
  pointer: { act: string; index: number } | null
  notes: Record<string, string>
  exportedAt: string
}

/** Snapshot of everything the campaign guide persists. */
export function exportProgress(): CampaignBackup {
  return {
    version: CAMPAIGN_GAME_VERSION,
    done: [...readDone()],
    pointer: readPointer(),
    notes: readNotes(),
    exportedAt: new Date().toISOString(),
  }
}

/** Restore a snapshot: replaces done/notes, keeps unknown keys, returns count. */
export function importProgress(b: CampaignBackup): number {
  if (!b || !Array.isArray(b.done)) return 0
  const next = new Set(b.done.filter((k): k is string => typeof k === 'string'))
  writeDone(next)
  try {
    if (b.notes && typeof b.notes === 'object') {
      localStorage.setItem(NOTES_KEY, JSON.stringify(b.notes))
    }
    if (b.pointer && typeof b.pointer.act === 'string') {
      writePointer({ act: b.pointer.act, index: b.pointer.index })
    }
  } catch {
    /* partial restore is fine */
  }
  return next.size
}

export function actById(id: string): CampaignAct | null {
  return CAMPAIGN_ACTS.find((a) => a.id === id) ?? null
}

/** Index of the act whose level band contains `lv`, or null when none does. */
export function actForLevel(lv: number): CampaignAct | null {
  for (const a of CAMPAIGN_ACTS) {
    const nums = a.levels.match(/\d+/g)?.map(Number) ?? []
    if (nums.length >= 2 && lv >= nums[0] && lv <= nums[nums.length - 1]) return a
  }
  return null
}

// ------------------------------------------------------------------ done ticks

const DONE_KEY = 'poe2coach.campaign.done'

export function readDone(): Set<string> {
  try {
    const raw = localStorage.getItem(DONE_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

export function writeDone(done: Set<string>): void {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify([...done]))
  } catch {
    /* storage off — ticks just do not persist */
  }
}

// ------------------------------------------------------------------ panel pointer

export interface CampaignPointer {
  act: string
  index: number
}

const POINTER_KEY = 'poe2coach.campaign.pointer'

export function readPointer(): CampaignPointer {
  try {
    const raw = localStorage.getItem(POINTER_KEY)
    if (raw) {
      const p = JSON.parse(raw) as CampaignPointer
      const act = actById(p.act)
      if (act && Number.isInteger(p.index) && p.index >= 0 && p.index < act.zones.length) return p
    }
  } catch {
    /* fall through to the default */
  }
  return { act: CAMPAIGN_ACTS[0].id, index: 0 }
}

export function writePointer(p: CampaignPointer): void {
  try {
    localStorage.setItem(POINTER_KEY, JSON.stringify(p))
  } catch {
    /* storage off */
  }
}

export function hasPointer(): boolean {
  try {
    return localStorage.getItem(POINTER_KEY) != null
  } catch {
    return false
  }
}

// ------------------------------------------------------------------ panel prefs

export interface CampaignPanelPrefs {
  locked: boolean
  collapsed: boolean
}

const PANEL_KEY = 'poe2coach.campaign.panel'

export function readPanelPrefs(): CampaignPanelPrefs {
  try {
    const raw = localStorage.getItem(PANEL_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<CampaignPanelPrefs>
      return { locked: !!p.locked, collapsed: !!p.collapsed }
    }
  } catch {
    /* fall through */
  }
  // Collapsed by default: the pinned panel is a one-line companion over the
  // game until the player expands it.
  return { locked: false, collapsed: true }
}

export function writePanelPrefs(prefs: CampaignPanelPrefs): void {
  try {
    localStorage.setItem(PANEL_KEY, JSON.stringify(prefs))
  } catch {
    /* storage off */
  }
}

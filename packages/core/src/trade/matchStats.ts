import type { GameItem, ModKind } from '../types.js'
import { modValues, skeleton } from './skeleton.js'

/** One row of packages/data/trade-stats.json (id, kind, skeleton). */
export interface StatIndexEntry {
  id: string
  t: string
  k: string
}

/** Skeleton -> entries, built once per session by {@link buildStatIndex}. */
export type StatIndex = Map<string, StatIndexEntry[]>

/** Which indexed group an item's mod kind belongs to. */
const KIND_TO_GROUP: Record<ModKind, string | null> = {
  explicit: 'explicit',
  implicit: 'implicit',
  fractured: 'fractured',
  crafted: 'crafted',
  enchant: 'enchant',
  rune: 'rune',
  pseudo: null,
}

export function buildStatIndex(entries: StatIndexEntry[]): StatIndex {
  const index: StatIndex = new Map()
  for (const entry of entries) {
    const bucket = index.get(entry.k)
    if (bucket) bucket.push(entry)
    else index.set(entry.k, [entry])
  }
  return index
}

export interface StatMatch {
  /** The item line the user pasted. */
  text: string
  kind: ModKind
  /** Trade-site stat id, or null when the line has no template match. */
  statId: string | null
  /** Group the id came from (explicit/implicit/...). */
  group: string | null
  /** Rolled values, used as the filter's minimum. */
  values: number[]
  /** How many templates shared this skeleton — >1 means the pick was a guess. */
  candidates: number
}

/** Templates repeat across groups; prefer the one matching the mod's own kind. */
function pick(entries: StatIndexEntry[], kind: ModKind): StatIndexEntry {
  const group = KIND_TO_GROUP[kind]
  return entries.find((e) => e.t === group) ?? entries.find((e) => e.t === 'explicit') ?? entries[0]
}

/**
 * Match one item line against the official stat templates. Lines that carry no
 * numbers (flavour lines, "Corrupted") and lines whose wording we do not have a
 * template for come back with statId null and are left out of the query.
 */
export function matchStat(text: string, kind: ModKind, index: StatIndex): StatMatch {
  const values = modValues(text)
  const entries = index.get(skeleton(text))
  if (!entries || entries.length === 0 || values.length === 0) {
    return { text, kind, statId: null, group: null, values, candidates: 0 }
  }
  const chosen = pick(entries, kind)
  return { text, kind, statId: chosen.id, group: chosen.t, values, candidates: entries.length }
}

export function matchItemMods(item: GameItem, index: StatIndex): StatMatch[] {
  return item.mods.map((mod) => matchStat(mod.text, mod.kind, index))
}

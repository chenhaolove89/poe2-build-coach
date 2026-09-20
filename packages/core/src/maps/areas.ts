/**
 * The endgame area table, and the join that makes a farming session legible.
 *
 * The client log names the area it generates by *code* — `Generating level 79
 * area "MapDeforestation"` — while everything a human reads is a name. The table
 * is therefore keyed by code, not by name, for two reasons:
 *
 *   - the code is exact. Deriving it from the name does not work: `MapSavanna` is
 *     "Savannah", `MapVaalFoundry` is "Molten Vault". The code comes from the game
 *     data (PoB2's WorldAreas.lua), never from a naming convention.
 *   - names repeat. Seven areas are called "Precursor Tower" and four are called
 *     "Merchant's Campsite"; a name-keyed table would silently lose six of them.
 *
 * This module is pure: it is handed the area list, it does not load it. The data
 * file is version-locked under packages/data and the caller decides when to read it.
 */

/** What an area *is*. A kind filters the list; it never removes a row. */
export type MapKind = 'map' | 'unique' | 'boss' | 'citadel' | 'tower' | 'hideout' | 'event'

/**
 * How the layout plays, from the community's own prose (poe2wiki notes, poe2way
 * ratings). `unknown` is a real answer — roughly half the maps have no community
 * layout note, and inventing one would be worse than admitting it.
 */
export type MapLayout = 'linear' | 'open' | 'loop' | 'maze' | 'special' | 'unknown'

export const MAP_KINDS: readonly MapKind[] = [
  'map',
  'unique',
  'boss',
  'citadel',
  'tower',
  'hideout',
  'event',
]

export const MAP_LAYOUTS: readonly MapLayout[] = ['linear', 'open', 'loop', 'maze', 'special', 'unknown']

/** One row of the area table, as written by scripts/build-maps.mjs. */
export interface MapArea {
  /**
   * The game's area code, e.g. `MapDeforestation`. Null only for a name the wiki
   * lists but the game data does not carry yet — such a row can be browsed but
   * cannot be matched to a run.
   */
  code: string | null
  /** English proper noun, the name the map is known by. */
  name: string
  kind: MapKind
  layout: MapLayout
  /** Biomes the area can roll. Empty when no source records one. */
  biomes: string[]
  /** Map boss(es), " / "-joined. Null when the area has none. */
  boss: string | null
  /** The community's own layout prose, verbatim. Null when there is none. */
  note: string | null
  /** Community rating 1 (hard) - 4 (very easy), or null when unrated. */
  navigation: number | null
  backtracking: number | null
}

export interface AreaIndex {
  byCode: ReadonlyMap<string, MapArea>
  /** Names are not unique; every area carrying a name is listed. */
  byName: ReadonlyMap<string, MapArea[]>
}

/** Codes that name a runnable map instance, i.e. what the atlas can open. */
const MAP_CODE = /^Map/

/**
 * True when the log's area code names a map instance rather than a hideout or a
 * town. Hideouts come through as `HideoutShoreline`, pinnacle arenas as
 * `Abyss_Pinnacle`, so the prefix is the whole test.
 */
export function isMapCode(code: string | null | undefined): boolean {
  return typeof code === 'string' && MAP_CODE.test(code)
}

export function buildAreaIndex(areas: readonly MapArea[]): AreaIndex {
  const byCode = new Map<string, MapArea>()
  const byName = new Map<string, MapArea[]>()
  for (const area of areas) {
    if (area.code && !byCode.has(area.code)) byCode.set(area.code, area)
    const bucket = byName.get(area.name)
    if (bucket) bucket.push(area)
    else byName.set(area.name, [area])
  }
  return { byCode, byName }
}

/**
 * The table row for a log area code.
 *
 * Undefined is a normal outcome, not an error: a map added by a patch the data
 * file predates arrives here first. The caller is expected to surface the code
 * rather than drop the run, which is how the table gets found wanting.
 */
export function findAreaByCode(index: AreaIndex, code: string | null | undefined): MapArea | undefined {
  if (!code) return undefined
  return index.byCode.get(code)
}

/** Areas worth farming, i.e. the ones an atlas map can be rolled into. */
export function farmableAreas(areas: readonly MapArea[]): MapArea[] {
  return areas.filter((a) => a.kind === 'map')
}

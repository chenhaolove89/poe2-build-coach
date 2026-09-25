/**
 * The endgame area table, read and typed in exactly one place.
 *
 * Three views want it — the map page, the farm page's per-map stats, and the home
 * card's count — and each used to cast the raw JSON itself. That is how a renamed
 * top-level key could break the app at runtime while `tsc` and `vue-tsc` both
 * stayed green: `as unknown as` tells the compiler nothing, so `json.maps.length`
 * on a file that now says `areas` is only ever a runtime TypeError. One cast, one
 * place, and the shape is checked once.
 *
 * The table is keyed by area code; see `@poe2coach/core`'s maps module for why.
 */
import mapsJson from '@poe2coach/data/maps.json'
import { buildAreaIndex, type AreaIndex, type MapArea, type MapKind, type MapLayout } from '@poe2coach/core'

const RAW = mapsJson as unknown as { source: string; captured: string; areas: MapArea[] }

/** Every row: maps, plus citadels, boss arenas, towers, hideouts and events. */
export const AREAS: MapArea[] = RAW.areas

/** Where the rows came from, for the credit line. */
export const AREA_SOURCE = RAW.source

/** When the rows were captured, so a stale table is visible rather than silent. */
export const AREA_CAPTURED = RAW.captured

/** The farmable pool: what an atlas map can be rolled into. */
export const FARMABLE_COUNT = AREAS.filter((a) => a.kind === 'map').length

/** Code -> row, for joining a client-log area code to the table. */
export const AREA_INDEX: AreaIndex = buildAreaIndex(AREAS)

// The vocabulary the UI shows for the table's two enums. Authored Simplified and
// passed through t() at render, like every other string. Kept here rather than in a
// component because the map page and the farm page's per-map table both name them,
// and two copies would drift.
export const LAYOUT_LABEL: Record<MapLayout, string> = {
  linear: '直线型',
  open: '开放型',
  loop: '环形回绕',
  maze: '迷宫型',
  special: '特殊',
  unknown: '未标注',
}

/** The order layouts are listed in: the walkable ones first, the catch-alls last. */
export const LAYOUT_ORDER: MapLayout[] = ['linear', 'open', 'loop', 'maze', 'unknown', 'special']

export const KIND_LABEL: Record<MapKind, string> = {
  map: '普通图',
  unique: '传奇图',
  citadel: '堡垒',
  boss: '首领',
  tower: '塔',
  hideout: '藏身处',
  event: '事件',
}

/**
 * The biome words both ends of the tree↔map join use, in authored Simplified.
 *
 * The map table names the three cities separately; the atlas tree addresses them
 * together as "City" and also has a "Non-City" bucket the table never writes. Both
 * vocabularies sit in one record so the map page's filter, the atlas page's biome
 * row and the strategy card all render the same word for the same thing. Passed
 * through t() at render, like every other label here.
 */
export const BIOME_LABEL: Record<string, string> = {
  Desert: '沙漠',
  'Ezomyte City': '埃佐米特城',
  'Faridun City': '法里顿城',
  Forest: '森林',
  Grass: '草原',
  Mountain: '山地',
  Ocean: '海洋',
  Swamp: '沼泽',
  'Vaal City': '瓦尔城',
  Water: '水域',
  // The tree's own two buckets, which no table row carries.
  City: '城市',
  'Non-City': '非城市区域',
}

/** The authored Chinese for a biome word, or null when neither vocabulary knows it. */
export function biomeLabel(biome: string): string | null {
  return BIOME_LABEL[biome] ?? null
}

export const KIND_ORDER: MapKind[] = ['map', 'unique', 'citadel', 'boss', 'tower', 'hideout', 'event']

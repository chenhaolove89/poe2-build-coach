/**
 * The map device's tablets (石板/碑牌), the per-run counterpart of the atlas tree.
 *
 * The atlas plan says which mechanics a player farms; the tablet is where those
 * mechanics get turned up for one map at a time — one tablet per mechanic slot
 * in the device, ten uses each, its affixes rolling from a pool that is half
 * generic map-value mods and half mechanic-specific ones. This module carries
 * that pool as baked from poe2db's tablet pages (see scripts/build-tablets.mjs;
 * the text is datamined game data credited to GGG), in all three languages the
 * realms write.
 *
 * The data is a reference, not advice: it says what *can* roll and what the
 * tablet does by default (its implicit), never which affix is "best" — the one
 * ranking anywhere is the player's own per-map measurements, not a tier list.
 */

export type TabletLanguage = 'en' | 'zh-Hans' | 'zh-Hant'

export interface TabletText {
  en: string
  'zh-Hans': string
  'zh-Hant': string
}

export interface TabletAffix {
  /** 1 = prefix, 2 = suffix — poe2db's ModGenerationTypeID. */
  gen: number
  families: string[]
  /**
   * True when every family this affix belongs to is shared by all eight tablet
   * classes — the generic map-value pool. False means it is this class's own
   * mechanic pool (its family names say which: BreachXxx, RitualXxx…).
   */
  generic: boolean
  name: TabletText
  text: TabletText
}

export interface TabletClass {
  id: string
  /** The atlas mechanic subtree this tablet belongs to, null where none does. */
  subtree: string | null
  /** The type string the official trade search indexes it under. */
  tradeType: string
  name: TabletText
  implicit: TabletText
  uses: number
  affixes: TabletAffix[]
}

export interface TabletUnique {
  name: string
  tradeType: string
}

export interface TabletData {
  source: string
  captured: string
  genericFamilies: string[]
  tablets: TabletClass[]
  uniques: TabletUnique[]
}

/**
 * The affix text in a realm's own wording. Tablet lines are item text — the
 * language the player's own client writes, not the reader's UI preference (a
 * 台服 player may read Simplified, but their Ctrl+C still copies 繁體).
 */
export function tabletText(text: TabletText, lang: TabletLanguage): string {
  return text[lang] || text.en
}

/** Split a class's pool into the generic map-value half and the mechanic half. */
export function splitTabletAffixes(
  tablet: TabletClass,
): { generic: TabletAffix[]; mechanic: TabletAffix[] } {
  const generic: TabletAffix[] = []
  const mechanic: TabletAffix[] = []
  for (const affix of tablet.affixes) (affix.generic ? generic : mechanic).push(affix)
  return { generic, mechanic }
}

/** The tablet classes serving one atlas mechanic subtree, in data order. */
export function tabletsForSubtree(data: TabletData, subtreeId: string): TabletClass[] {
  return data.tablets.filter((t) => t.subtree === subtreeId)
}

/**
 * The tablet classes ranked for a player: the mechanics their atlas plan
 * actually allocated come first (in the plan's own order), the rest follow in
 * data order. Overseer and Irradiated have no subtree, so they never lead —
 * they are tools every plan can reach for.
 */
export function tabletsRankedByPlan(
  data: TabletData,
  planSubtrees: readonly string[],
): TabletClass[] {
  const rank = new Map(planSubtrees.map((id, i) => [id, i]))
  return [...data.tablets].sort(
    (a, b) =>
      (rank.get(a.subtree ?? '') ?? planSubtrees.length) -
        (rank.get(b.subtree ?? '') ?? planSubtrees.length) ||
      data.tablets.indexOf(a) - data.tablets.indexOf(b),
  )
}

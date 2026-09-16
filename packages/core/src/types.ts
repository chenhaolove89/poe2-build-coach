/** Core domain types shared by desktop app, future web app and data pipelines. */

/** A passive skill tree node straight from the versioned tree.json. */
export interface TreeNode {
  id: number
  name: string
  stats: string[]
  group: number
  orbit: number
  orbitIndex: number
  icon?: string
  isKeystone?: boolean
  isNotable?: boolean
  isMastery?: boolean
  /** Present on ascendancy tree nodes (also used as the ascendancy marker). */
  ascendancyName?: string
  isAscendancyStart?: boolean
  /** Costs no point to allocate. */
  isFreeAllocate?: boolean
  /** One option of a multiple-choice node; selecting one deselects its siblings. */
  isMultipleChoiceOption?: boolean
  isMultipleChoice?: boolean
  connections?: { id: number; orbit?: number }[]
  stringId?: string
  skill?: number
  /** Class start marker: PoE1/PoE2 class names sharing this start node. */
  classesStart?: string[]
}

export interface TreeGroup {
  nodes: number[]
  orbits: number[]
  x: number
  y: number
  containsAscendancies?: boolean
  isAscendancyStart?: boolean
}

export interface TreeClass {
  id: string
  name: string
  internalId?: string
  ascendancies: { id: string; name: string; internalId?: string }[]
}

export interface TreeConstants {
  PSSCentreInnerRadius?: number
  orbitRadii: number[]
  orbitAnglesByOrbit: number[][]
  skillsPerOrbit?: number[]
  classes: Record<string, number>
  characterAttributes?: Record<string, number>
}

/** tree.json (PoB2 TreeData/<version>/tree.json), flattened to what the UI needs. */
export interface TreeData {
  version: string
  nodes: Record<number, TreeNode>
  groups: TreeGroup[]
  constants: TreeConstants
  classes: TreeClass[]
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

/** A gem line inside a skill group of a PoB build. */
export interface GemLine {
  name: string
  level: number | null
  quality: number | null
  enabled: boolean
}

/** One skill slot: the active skill plus its supports, as configured in PoB. */
export interface SkillGroup {
  label: string | null
  gems: GemLine[]
}

/** An item parsed out of a PoB build (unique/rare/magic/normal). */
export interface ParsedItem {
  id: number
  rarity: string | null
  name: string | null
  base: string | null
  itemClass: string | null
  /** Equipped slot reference from <Slot name="Weapon 1" itemId="..."/>, if any. */
  slot: string | null
  /** Full item text, kept for later mod-level parsing. */
  text: string
}

/** Everything we can reliably extract from a PoB share code in M0. */
export interface BuildSnapshot {
  className: string | null
  ascendClassName: string | null
  level: number | null
  /** Tree data version this build targets (e.g. "0_5"), from <Spec treeVersion>. */
  treeVersion: string | null
  /** Target passive node ids (from <Spec nodes>, falling back to <Build nodes>). */
  passiveNodes: number[]
  /** Passive tree spec URL(s), kept raw for tree-code decoding later. */
  treeSpecUrls: string[]
  skills: SkillGroup[]
  items: ParsedItem[]
}

export interface ParsedPobCode {
  build: BuildSnapshot
  meta: {
    /** Length of the share code that produced this build. */
    codeLength: number
  }
}

export class PobParseError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'PobParseError'
  }
}

/** One mod line on an item, with its origin tag resolved. */
export type ModKind = 'implicit' | 'explicit' | 'enchant' | 'rune' | 'fractured' | 'crafted' | 'pseudo'

export interface ItemMod {
  /** Mod text without {tag} prefixes. */
  text: string
  kind: ModKind
}

/** An item parsed from in-game Ctrl+C clipboard text or a PoB <Item> body. */
export interface GameItem {
  rarity: string | null
  name: string | null
  base: string | null
  itemClass: string | null
  itemLevel: number | null
  levelReq: number | null
  quality: number | null
  corrupted: boolean
  armour: number | null
  evasion: number | null
  energyShield: number | null
  ward: number | null
  rune: string | null
  sockets: string | null
  mods: ItemMod[]
  rawText: string
}

export interface ResistanceTotals {
  fire: number
  cold: number
  lightning: number
  chaos: number
}

/** Multiset diff of two items' mods plus the resistance swing. */
export interface ItemDiff {
  added: ItemMod[]
  removed: ItemMod[]
  resistances: ResistanceTotals
}

/** Keyword-based affix priority rule (generic template; build-specific later). */
export interface PriorityRule {
  /** Lowercase substrings matched against the item class; omitted on the "any" rule. */
  match?: string[]
  core: string[]
  good?: string[]
}

export interface PriorityData {
  any: PriorityRule
  classes: PriorityRule[]
}

export interface PriorityCheck {
  /** The full effective core keyword list, in UI display order. */
  core: string[]
  /** Core keywords present on the item. */
  coreHits: string[]
  /** Core keywords missing — the gap a player must fix. */
  coreMissing: string[]
  goodHits: string[]
}

/** One ordered regex template for translating mod lines to Chinese. */
export interface ModTranslationRule {
  re: string
  zh: string
}

/** Sentence rule for stat lines; `phrases` lists capture groups run through the phrase dictionary. */
export interface StatSentenceRule {
  re: string
  zh: string
  phrases?: number[]
}

export interface StatTranslationData {
  sentences: StatSentenceRule[]
  phrases: Record<string, string>
}

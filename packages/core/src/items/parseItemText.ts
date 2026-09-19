import type { GameItem, ModKind } from '../types.js'

const TAG_RE = /\{([a-z]+)\}/g
const SECTION_SEP = /^-+$/
/** "Label: value" with either a halfwidth or a fullwidth colon. */
const LABEL_RE = /^([^:：]{1,24})[:：]\s*(.*)$/

/**
 * Header labels by canonical field. A pasted item is written in the language of
 * the client it came from, so each field lists every wording we have seen:
 * international English, Tencent's Simplified Chinese and Garena's Traditional
 * Chinese. The two Chinese clients are separate localizations rather than a
 * character variant of each other — "Item Class:" is 物品类别 on 国服 but 物品種類
 * on 台服 — so both spellings have to be listed.
 */
const HEADERS = {
  itemClass: ['item class', '物品类别', '物品種類'],
  rarity: ['rarity', '稀有度'],
  quality: ['quality', '品质', '品質'],
  itemLevel: ['item level', '物品等级', '物品等級'],
  levelReq: ['levelreq', 'level req', '等级', '等級'],
  level: ['level'],
  requirements: ['requirements', 'requires', '需求'],
  sockets: ['sockets', '插槽'],
  rune: ['rune', '符文'],
  armour: ['armour', 'armor', '护甲', '护甲值', '護甲值'],
  evasion: ['evasion', 'evasion rating', '闪避值', '閃避值'],
  energyShield: ['energy shield', '能量护盾', '能量護盾'],
  ward: ['ward', 'runic ward', '符文结界', '符文結界'],
  spirit: ['spirit', '精魂'],
  stackSize: ['stack size', '堆叠数量', '堆疊數量'],
  implicits: ['implicits', 'implicit', '固定词缀', '固定詞綴'],
} as const

type HeaderField = keyof typeof HEADERS

const HEADER_INDEX = new Map<string, HeaderField>()
for (const [field, labels] of Object.entries(HEADERS) as [HeaderField, readonly string[]][]) {
  for (const label of labels) HEADER_INDEX.set(label, field)
}

/** Metadata lines that carry no pricing signal and must never become mods. */
const IGNORED_KEYS = new Set(['unique id', 'radius', 'limited to', 'dex req', 'int req', 'str req', 'stack size'])

/**
 * Standalone marker lines. `corrupted` is the only one that changes the parse;
 * the rest just have to be kept out of the mod list. Chinese clients do not
 * borrow the English words — 国服 prints 被腐化 where 台服 prints 已汙染.
 */
const CORRUPTED_MARKERS = ['corrupted', '被腐化', '已汙染', '已污染']
const OTHER_MARKERS = [
  'mirrored', 'split', 'unidentified', 'sanctified', 'imprinted', 'twice corrupted',
  '复制物品', '已複製', '分裂', '未鉴定', '未鑑定', '圣化物品', '聖化的', '已拓印', '双重腐化', '雙重腐化',
  '分裂之物', '破裂之物',
]

/**
 * Parenthetical decorations a client appends to a mod line. Only these exact
 * words are treated as tags: a rolled range such as "附加 2(1-3) 至 49" is
 * parenthesised too and has to survive into the mod text, or the values the
 * query filters on would be wrong.
 */
const TAG_KINDS: Record<string, ModKind> = {
  implicit: 'implicit',
  explicit: 'explicit',
  fractured: 'fractured',
  crafted: 'crafted',
  enchant: 'enchant',
  rune: 'rune',
}

/** Decorations that carry no kind: "(augmented)", "(unmet)", "(lightning)". */
const NEUTRAL_TAGS = new Set([
  'augmented', 'unmet', 'desecrated', 'local', 'global',
  'fire', 'cold', 'lightning', 'chaos', 'physical',
])

/** Rarity words, keyed by the localised value with its canonical form. */
const RARITY_VALUES: Record<string, string> = {
  normal: 'NORMAL',
  magic: 'MAGIC',
  rare: 'RARE',
  unique: 'UNIQUE',
  relic: 'RELIC',
  普通: 'NORMAL',
  魔法: 'MAGIC',
  稀有: 'RARE',
  传奇: 'UNIQUE',
  傳奇: 'UNIQUE',
  圣物: 'RELIC',
  聖物: 'RELIC',
  通货: 'CURRENCY',
  通貨: 'CURRENCY',
  宝石: 'GEM',
  寶石: 'GEM',
  命运卡: 'DIVINATION_CARD',
  命運卡: 'DIVINATION_CARD',
}

/**
 * Parse a game item body — either the in-game Ctrl+C clipboard format
 * (`Item Class:` header, `--------` separators, indented Requirements) or the
 * PoB <Item> body (no separators, {tag}-prefixed mods, `Implicits: N`).
 *
 * Works for the English, Simplified Chinese and Traditional Chinese clients;
 * see {@link HEADERS} for the label sets and {@link TAG_KINDS} for the tags.
 */
export function parseItemText(text: string): GameItem {
  const rawLines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)

  const item: GameItem = {
    rarity: null,
    name: null,
    base: null,
    itemClass: null,
    itemLevel: null,
    levelReq: null,
    quality: null,
    corrupted: false,
    armour: null,
    evasion: null,
    energyShield: null,
    ward: null,
    rune: null,
    sockets: null,
    stackSize: null,
    mods: [],
    rawText: text,
  }

  let pendingImplicits = 0
  let nameLines: string[] = []
  let inRequirements = false
  let sawImplicitsHeader = false

  for (const raw of rawLines) {
    if (SECTION_SEP.test(raw)) continue

    // Advanced tooltips print the affix itself on its own braced line —
    // "{ 前綴 \"火花的\"(階層：5) — 傷害,元素,閃電,攻擊 }". It describes the mod
    // below it, so it is a label rather than a mod and is dropped whole. PoB's
    // "{fractured}+57% ..." is not braced end-to-end and keeps its own path.
    if (/^\{.*\}$/.test(raw) && !/^\{\w+\}/.test(raw)) continue

    const tags = [...raw.matchAll(TAG_RE)].map((m) => m[1])
    const stripped = raw.replace(TAG_RE, '').trim()
    const lower = stripped.toLowerCase()

    const parsed = LABEL_RE.exec(stripped)
    const field = parsed ? HEADER_INDEX.get(parsed[1].trim().toLowerCase()) : undefined
    const value = parsed?.[2].trim() ?? ''

    if (field) {
      switch (field) {
        case 'itemClass':
          item.itemClass = value
          continue
        case 'rarity':
          item.rarity = RARITY_VALUES[value.toLowerCase()] ?? value.toUpperCase()
          continue
        case 'quality':
          item.quality = firstNumber(value)
          continue
        case 'itemLevel':
          item.itemLevel = firstNumber(value)
          continue
        case 'levelReq':
        case 'level':
          // "Level: 44" on its own line, or one field of a PoE2 requirements
          // line the client already split for us. The requirements block stays
          // open so the " Str: 114" lines that follow it are still skipped.
          item.levelReq = firstNumber(value)
          continue
        case 'requirements':
          // PoE2 (and the Chinese clients) put the whole requirement on this
          // one line — "需求： 等级 70, 121 敏捷" — while PoE1 and PoB follow
          // it with "Level:" / "Str:" lines. Handle both.
          inRequirements = value.length === 0
          item.levelReq = levelFromRequirements(value) ?? item.levelReq
          continue
        case 'sockets':
          item.sockets = value
          continue
        case 'rune':
          item.rune = value
          continue
        case 'armour':
          // 护甲 is also the category prefix on rune effect lines, so only read
          // it as a defence value when the line actually looks like one.
          if (isValueLine(value)) item.armour = firstNumber(value)
          continue
        case 'evasion':
          if (isValueLine(value)) item.evasion = firstNumber(value)
          continue
        case 'energyShield':
          if (isValueLine(value)) item.energyShield = firstNumber(value)
          continue
        case 'ward':
          if (isValueLine(value)) item.ward = firstNumber(value)
          continue
        case 'spirit':
          continue
        case 'stackSize':
          item.stackSize = firstNumber(value)
          continue
        case 'implicits':
          pendingImplicits = firstNumber(value) ?? 0
          sawImplicitsHeader = true
          inRequirements = false
          continue
      }
    }

    if (CORRUPTED_MARKERS.includes(lower)) {
      item.corrupted = true
      continue
    }
    if (OTHER_MARKERS.includes(lower)) continue

    // Requirement lines inside a multi-line Requirements block (" Str: 114").
    if (inRequirements) {
      if (/^(str|dex|int|力量|敏捷|智慧)\s*[:：]/i.test(stripped)) continue
      const level = /^(?:level|等级|等級)\s*[:：]?\s*(\d+)/i.exec(stripped)
      if (level) {
        item.levelReq = Number(level[1])
        continue
      }
      inRequirements = false // anything else ends the block
    }

    // PoB bodies can embed child elements like <ModRange .../> — skip XML lines.
    if (raw.startsWith('<')) continue

    // Any remaining known key line ("Unique ID:", "Radius:", ...) is metadata, not a mod.
    if (isKeyValueLine(stripped)) continue

    // The two lines right after Rarity are Name and Base (Magic/Normal have only Base).
    if (item.rarity && nameLines.length < 2 && !sawImplicitsHeader) {
      nameLines.push(stripped)
      continue
    }

    const { text: modText, kind: tagKind } = stripModTags(stripped)
    let kind = tagKind ?? resolveKind(tags)
    if (sawImplicitsHeader && pendingImplicits > 0) {
      pendingImplicits--
      if (kind === 'explicit') kind = 'implicit'
    }
    item.mods.push({ text: modText, kind })
  }

  if (nameLines.length > 0) {
    if (item.rarity === 'MAGIC' || item.rarity === 'NORMAL' || nameLines.length === 1) {
      item.base = nameLines[0]
    } else {
      item.name = nameLines[0]
      item.base = nameLines[1] ?? null
    }
  }

  return item
}

/**
 * A defence line carries a number; the same word on a rune effect line
 * ("护甲: 闪电抗性 +10%") is a category heading, and reading it as armour would
 * invent a defence value out of the resistance bonus.
 */
function isValueLine(value: string): boolean {
  return /^[-+]?\d/.test(value)
}

/** "等级 70, 121 敏捷" / "Level 78, 212 Dex" -> 70 / 78. */
function levelFromRequirements(value: string): number | null {
  if (!value) return null
  const m = /(?:level|等级|等級)\s*[:：]?\s*(\d+)/i.exec(value)
  if (m) return Number(m[1])
  // Some clients order the line with the number first.
  const alt = /(\d+)\s*(?:level|等级|等級)/i.exec(value)
  return alt ? Number(alt[1]) : null
}

/**
 * Drop a trailing "(rune)" / "(implicit)" tag and report the kind it implies.
 * Only trailing tags are removed, and only words in the two tag sets count, so
 * a rolled range in the middle of a mod ("附加 2(1-3) 至 49 閃電傷害") stays put.
 */
function stripModTags(line: string): { text: string; kind: ModKind | null } {
  let text = line
  let kind: ModKind | null = null
  for (;;) {
    const m = /\s*\(([a-zA-Z]+)\)\s*$/.exec(text)
    if (!m) break
    const word = m[1].toLowerCase()
    const mapped = TAG_KINDS[word]
    if (!mapped && !NEUTRAL_TAGS.has(word)) break
    if (mapped && !kind) kind = mapped
    text = text.slice(0, m.index).trim()
  }
  return { text, kind }
}

function isKeyValueLine(line: string): boolean {
  const m = LABEL_RE.exec(line)
  if (!m) return false
  const key = m[1].trim().toLowerCase()
  return IGNORED_KEYS.has(key)
}

/** Numeric prefix like "276 (augmented)" or "+35". */
function firstNumber(line: string): number | null {
  const m = line.match(/-?\d+/)
  return m ? Number(m[0]) : null
}

function resolveKind(tags: string[]): ModKind {
  if (tags.includes('fractured')) return 'fractured'
  if (tags.includes('crafted')) return 'crafted'
  // Rune sockets arrive as "{enchant}{rune}..."; the rune tag is the specific one.
  if (tags.includes('rune')) return 'rune'
  if (tags.includes('enchant')) return 'enchant'
  if (tags.includes('implicit')) return 'implicit'
  return 'explicit'
}

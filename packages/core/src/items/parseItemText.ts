import type { GameItem, ItemMod, ModKind } from '../types.js'

const TAG_RE = /\{([a-z]+)\}/g
const SECTION_SEP = /^-+$/
const KNOWN_KEYS = new Set([
  'item class', 'rarity', 'unique id', 'item level', 'levelreq', 'level req', 'quality',
  'radius', 'limited to', 'implicits', 'sockets', 'rune', 'corrupted', 'requirements',
  'armour', 'evasion', 'energy shield', 'ward', 'spirit', 'dex req', 'int req', 'str req',
])

/**
 * Parse a game item body — either the in-game Ctrl+C clipboard format
 * (`Item Class:` header, `--------` separators, indented Requirements) or the
 * PoB <Item> body (no separators, {tag}-prefixed mods, `Implicits: N`).
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
    mods: [],
    rawText: text,
  }

  let pendingImplicits = 0
  let nameLines: string[] = []
  let inRequirements = false
  let sawImplicitsHeader = false

  for (const raw of rawLines) {
    if (SECTION_SEP.test(raw)) continue
    const stripped = raw.replace(TAG_RE, (_m, tag: string) => '').trim()
    const tags = [...raw.matchAll(TAG_RE)].map((m) => m[1])
    const lower = raw.toLowerCase()

    if (lower.startsWith('item class:')) {
      item.itemClass = raw.slice('Item Class:'.length).trim()
      continue
    }
    if (lower.startsWith('rarity:')) {
      item.rarity = raw.slice('Rarity:'.length).trim().toUpperCase()
      continue
    }
    if (lower === 'corrupted') {
      item.corrupted = true
      continue
    }
    if (lower.startsWith('quality:')) {
      item.quality = firstNumber(raw)
      continue
    }
    if (lower.startsWith('item level:')) {
      item.itemLevel = firstNumber(raw)
      continue
    }
    if (lower.startsWith('levelreq:') || lower.startsWith('level req:')) {
      item.levelReq = firstNumber(raw)
      continue
    }
    if (lower === 'requirements:') {
      inRequirements = true
      continue
    }
    if (lower.startsWith('sockets:')) {
      item.sockets = raw.slice('Sockets:'.length).trim()
      continue
    }
    if (lower.startsWith('rune:')) {
      item.rune = raw.slice('Rune:'.length).trim()
      continue
    }
    if (lower.startsWith('armour:')) {
      item.armour = firstNumber(raw)
      continue
    }
    if (lower.startsWith('evasion:')) {
      item.evasion = firstNumber(raw)
      continue
    }
    if (lower.startsWith('energy shield:')) {
      item.energyShield = firstNumber(raw)
      continue
    }
    if (lower.startsWith('ward:')) {
      item.ward = firstNumber(raw)
      continue
    }
    if (/^implicits?:\s*\d+/i.test(raw)) {
      pendingImplicits = firstNumber(raw) ?? 0
      sawImplicitsHeader = true
      inRequirements = false
      continue
    }

    // Requirement lines inside the Requirements block ("Level: 65", " Str: 114").
    if (inRequirements) {
      const lvl = raw.match(/^level\s*:\s*(\d+)/i)
      if (lvl) {
        item.levelReq = Number(lvl[1])
        continue
      }
      if (/^(str|dex|int)\s*:/i.test(raw)) continue
      inRequirements = false // anything else ends the block
    }

    // PoB bodies can embed child elements like <ModRange .../> — skip XML lines.
    if (raw.startsWith('<')) continue

    // Any remaining known key line ("Unique ID:", "Radius:", ...) is metadata, not a mod.
    if (isKeyValueLine(raw)) continue

    // The two lines right after Rarity are Name and Base (Magic/Normal have only Base).
    if (item.rarity && nameLines.length < 2 && !sawImplicitsHeader) {
      nameLines.push(stripped)
      continue
    }

    let kind = resolveKind(tags)
    if (sawImplicitsHeader && pendingImplicits > 0) {
      pendingImplicits--
      if (kind === 'explicit') kind = 'implicit'
    }
    item.mods.push({ text: stripped, kind })
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

function isKeyValueLine(line: string): boolean {
  const idx = line.indexOf(':')
  if (idx <= 0) return false
  const key = line.slice(0, idx).trim().toLowerCase()
  return KNOWN_KEYS.has(key)
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

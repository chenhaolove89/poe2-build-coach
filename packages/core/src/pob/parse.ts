import { XMLParser } from 'fast-xml-parser'
import { PobParseError } from '../types.js'
import type { BuildSnapshot, GemLine, ParsedItem, SkillGroup } from '../types.js'
import { decodeShareCode } from './decode.js'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  trimValues: true,
  // PoB repeats element names for lists; normalise them to arrays ourselves.
  isArray: () => false,
})

/**
 * Parse a PoB share code (PoE2 community fork flavour) into a BuildSnapshot.
 * Parsing is tolerant: unknown shapes are ignored, known ones are extracted;
 * anything unrecoverable raises PobParseError instead of returning garbage.
 */
export function parsePobCode(code: string): BuildSnapshot {
  const xml = decodeShareCode(code)
  return parsePobXml(xml)
}

export function parsePobXml(xml: string): BuildSnapshot {
  let doc: Record<string, unknown>
  try {
    doc = parser.parse(xml)
  } catch (e) {
    throw new PobParseError('Decoded payload is not valid XML', e)
  }

  // PoE1 community PoB uses <PathOfBuilding>, the PoE2 fork uses <PathOfBuilding2>.
  const rootObj = (asObj(doc.PathOfBuilding2) ?? asObj(doc.PathOfBuilding)) as Record<string, unknown> | undefined
  if (!rootObj) {
    throw new PobParseError('XML root element <PathOfBuilding2> not found')
  }

  const buildEl = asObj(rootObj.Build)
  const treeEl = asObj(rootObj.Tree)
  const specRaw = treeEl?.Spec
  const specs = Array.isArray(specRaw) ? specRaw : specRaw ? [specRaw] : []
  const activeSpec = asObj(specs[0])
  const treeVersion = strOrNull(activeSpec?.['@treeVersion'])

  // PoE2 codes keep the allocated node list on <Spec nodes>; older PoE1-style
  // codes put it on <Build nodes>. Accept both.
  const passiveNodes =
    parseNodeList(activeSpec?.['@nodes']) ?? parseNodeList(buildEl?.['@nodes']) ?? []

  return {
    className: strOrNull(buildEl?.['@className']),
    ascendClassName: strOrNull(buildEl?.['@ascendClassName']),
    level: intOrNull(buildEl?.['@level']),
    treeVersion,
    passiveNodes,
    treeSpecUrls: parseSpecUrls(rootObj.Tree),
    skills: parseSkills(rootObj.Skills),
    items: parseItems(rootObj.Items),
  }
}

function asObj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function intOrNull(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function parseNodeList(raw: unknown): number[] | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const ids: number[] = []
  for (const part of raw.split(',')) {
    const id = Number(part.trim())
    if (Number.isInteger(id) && id > 0) ids.push(id)
  }
  return ids
}

function parseSpecUrls(treeEl: unknown): string[] {
  const tree = asObj(treeEl)
  const specRaw = tree?.Spec
  const specs = Array.isArray(specRaw) ? specRaw : specRaw ? [specRaw] : []
  const urls: string[] = []
  for (const spec of specs) {
    const url = asObj(spec)?.URL
    if (typeof url === 'string' && url.length > 0) urls.push(url)
  }
  return urls
}

function parseSkills(skillsEl: unknown): SkillGroup[] {
  const skills = asObj(skillsEl)
  const setsRaw = skills?.SkillSet
  const sets = Array.isArray(setsRaw) ? setsRaw : setsRaw ? [setsRaw] : []
  const source = sets.length > 0 ? sets : []
  const groups: SkillGroup[] = []
  for (const set of source) {
    const skillRaw = asObj(set)?.Skill
    const skillList = Array.isArray(skillRaw) ? skillRaw : skillRaw ? [skillRaw] : []
    for (const skill of skillList) {
      const gemRaw = asObj(skill)?.Gem
      const gemList = Array.isArray(gemRaw) ? gemRaw : gemRaw ? [gemRaw] : []
      const gems: GemLine[] = gemList.map((gem) => ({
        // PoE2 writes the gem name to @nameSpec; keep @name for older codes.
        name: strOrNull(asObj(gem)?.['@nameSpec']) ?? strOrNull(asObj(gem)?.['@name']) ?? 'unknown gem',
        level: intOrNull(asObj(gem)?.['@level']),
        quality: intOrNull(asObj(gem)?.['@quality']),
        enabled: asObj(gem)?.['@enabled'] !== 'false',
      }))
      if (gems.length > 0) {
        const label = strOrNull(asObj(skill)?.['@label'])
        const mainGem = gems.find((g) => g.enabled)
        groups.push({ label: label ?? mainGem?.name ?? null, gems })
      }
    }
  }
  return groups
}

function parseItems(itemsEl: unknown): ParsedItem[] {
  const items = asObj(itemsEl)
  const itemRaw = items?.Item
  const itemList = Array.isArray(itemRaw) ? itemRaw : itemRaw ? [itemRaw] : []
  const slotRaw = items?.Slot
  const slotList = Array.isArray(slotRaw) ? slotRaw : slotRaw ? [slotRaw] : []
  const slotByItemId = new Map<number, string>()
  for (const slot of slotList) {
    const s = asObj(slot)
    const itemId = intOrNull(s?.['@itemId'])
    const name = strOrNull(s?.['@name'])
    if (itemId != null && name) slotByItemId.set(itemId, name)
  }

  const parsed: ParsedItem[] = []
  for (const item of itemList) {
    const obj = asObj(item)
    if (!obj) continue
    const text = typeof obj['#text'] === 'string' ? obj['#text'] : ''
    const identity = parseItemIdentity(text)
    parsed.push({
      id: intOrNull(obj['@id']) ?? parsed.length + 1,
      rarity: firstLineField(text, 'Rarity:'),
      name: identity.name,
      base: identity.base,
      itemClass: strOrNull(obj['@itemClass']),
      slot: slotByItemId.get(intOrNull(obj['@id']) ?? -1) ?? null,
      text,
    })
  }
  return parsed
}

function firstLineField(text: string, prefix: string): string | null {
  const line = text.split('\n').find((l) => l.startsWith(prefix))
  return line ? line.slice(prefix.length).trim() || null : null
}

/**
 * Item text layout (game item copy):
 *   Rarity: UNIQUE | RARE → [Item Class: X], NameLine, BaseLine
 *   Rarity: MAGIC | NORMAL → [Item Class: X], BaseLine
 */
function parseItemIdentity(text: string): { name: string | null; base: string | null } {
  const lines = text.split('\n').map((l) => l.trim())
  const rarityIdx = lines.findIndex((l) => l.startsWith('Rarity:'))
  let i = rarityIdx + 1
  if (lines[i]?.startsWith('Item Class:')) i++
  const rarity = rarityIdx >= 0 ? lines[rarityIdx].slice('Rarity:'.length).trim().toUpperCase() : ''
  if (rarity === 'MAGIC' || rarity === 'NORMAL') {
    return { name: null, base: lines[i] || null }
  }
  return { name: lines[i] || null, base: lines[i + 1] || null }
}

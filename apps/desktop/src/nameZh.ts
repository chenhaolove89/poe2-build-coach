import nameZhJson from '@poe2coach/data/name-zh.json'

const NAMES = (nameZhJson as unknown as { names: Record<string, string> }).names

/** Game text, poe2db and community dicts disagree on case, commas and apostrophes. */
function normalizeKey(en: string): string {
  return en
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .toLowerCase()
    .replace(/[',]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const LOOSE = new Map<string, string>()
for (const [en, zh] of Object.entries(NAMES)) LOOSE.set(normalizeKey(en), zh)

/** PoB2 prefixes item bases with their tier; poe2db lists the bare base. */
const TIER_PREFIX: Record<string, string> = {
  Expert: '专家级',
  Advanced: '高级',
  Basic: '基础',
  Crude: '粗糙',
}

function tierLookup(en: string): string | null {
  const space = en.indexOf(' ')
  if (space <= 0) return null
  const tier = TIER_PREFIX[en.slice(0, space)]
  if (!tier) return null
  const rest = NAMES[en.slice(space + 1)] ?? LOOSE.get(normalizeKey(en.slice(space + 1)))
  return rest ? `${tier}${rest}` : null
}

/** Chinese name lookup for game proper nouns (nodes/gems/items/classes/bosses). */
export function nameZh(en: string | null | undefined): string | null {
  if (!en) return null
  return NAMES[en] ?? LOOSE.get(normalizeKey(en)) ?? tierLookup(en)
}

/** "Huntress 女猎人" — English plus Chinese when a translation exists. */
export function nameBilingual(en: string | null | undefined): string {
  if (!en) return ''
  const zh = nameZh(en)
  return zh ? `${en} ${zh}` : en
}

/** "中文 英文", falling back to English segments for comma-joined boss pairs. */
export function nameZhThenEn(en: string | null | undefined): string {
  if (!en) return ''
  const whole = nameZh(en)
  if (whole) return `${whole} ${en}`
  const parts = en.split(', ')
  const zhParts = parts.map((p) => nameZh(p))
  if (parts.length > 1 && zhParts.every((z) => z)) {
    return `${zhParts.join(' / ')} ${en}`
  }
  return en
}

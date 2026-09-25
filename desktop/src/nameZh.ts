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

/**
 * Chinese name lookup for game proper nouns (nodes/gems/items/classes/bosses).
 *
 * Returns the dictionary's own Chinese, which is always Simplified — the
 * display variant is applied further out, in i18n.ts. Returns null for game
 * text that is already Chinese (a 国服 or 台服 item), which callers read as
 * "this needs no translation" rather than as a failure.
 */
export function nameZh(en: string | null | undefined): string | null {
  if (!en) return null
  return NAMES[en] ?? LOOSE.get(normalizeKey(en)) ?? tierLookup(en)
}

/** A Chinese name together with the English it came from. */
export interface TranslatedName {
  zh: string
  en: string
}

/**
 * {@link nameZh} plus the two shapes that need more than one lookup: the
 * "Tier Base" item bases, and boss pairs the data packs store as one
 * comma-joined string. Null means "not in the dictionary", so the caller can
 * fall back to whatever language the text is already in.
 */
export function translatedName(en: string | null | undefined): TranslatedName | null {
  if (!en) return null
  const whole = nameZh(en)
  if (whole) return { zh: whole, en }
  const parts = en.split(', ')
  if (parts.length > 1) {
    const zhParts = parts.map((p) => nameZh(p))
    if (zhParts.every((z) => z)) return { zh: zhParts.join(' / '), en }
  }
  return null
}

/** "Huntress 女猎人" — English plus Chinese when a translation exists. */
export function nameBilingual(en: string | null | undefined): string {
  const tr = translatedName(en)
  return tr ? `${en} ${tr.zh}` : (en ?? '')
}

/** "中文 英文", falling back to English segments for comma-joined boss pairs. */
export function nameZhThenEn(en: string | null | undefined): string {
  const tr = translatedName(en)
  return tr ? `${tr.zh} ${tr.en}` : (en ?? '')
}

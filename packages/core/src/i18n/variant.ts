/**
 * Simplified <-> Traditional rewriting for the display-language switch.
 *
 * This app is authored in Simplified Chinese: every Chinese literal in the UI,
 * and the English -> Chinese name dictionary, is Simplified. Traditional is
 * therefore produced by rewriting rather than by keeping a second translation
 * of everything.
 *
 * Tables come from OpenCC (see scripts/build-zh-variant.mjs). Its character
 * table resolves ambiguous characters the safe way — 制 stays 制, 升 stays 升 —
 * and leans on the phrase table for the cases that matter, so 制作 becomes 製作
 * and 升华 becomes 昇華. That makes phrase lookup the part that decides whether
 * the output reads as Traditional or as a character-by-character
 * transliteration, which is why the converter always tries the longest phrase
 * before falling back to single characters.
 *
 * A mechanical rewrite is not the same thing as the Taiwanese game client's
 * own wording (its 換界石 is 引路石 in Simplified). This converts characters,
 * not terminology; the realm's own data is what supplies real terminology.
 */

export type ZhVariant = 'hans' | 'hant'

/** One direction of the OpenCC tables: whole phrases, then single characters. */
export interface VariantTable {
  chars: Record<string, string>
  phrases: Record<string, string>
}

export interface ZhVariantTables {
  /** Rewrites Simplified input into Traditional. */
  toHant: VariantTable
  /** Rewrites Traditional input into Simplified. */
  toHans: VariantTable
}

export interface ZhConverter {
  toTraditional(text: string): string
  toSimplified(text: string): string
}

/**
 * Longest-phrase-first rewrite. Keep this in sync with `convert()` in
 * scripts/build-zh-variant.mjs — a test pins them together.
 */
export function rewriteVariant(text: string, table: VariantTable): string {
  const lengths = [...new Set(Object.keys(table.phrases).map((p) => p.length))].sort((a, b) => b - a)
  let out = ''
  let i = 0
  while (i < text.length) {
    let hit: string | null = null
    for (const len of lengths) {
      if (len > text.length - i) continue
      const candidate = text.slice(i, i + len)
      if (table.phrases[candidate]) {
        hit = candidate
        break
      }
    }
    if (hit) {
      out += table.phrases[hit]
      i += hit.length
      continue
    }
    out += table.chars[text[i]] ?? text[i]
    i++
  }
  return out
}

/** Game names repeat on every render, so identical strings are rewritten once. */
const CACHE_LIMIT = 4096

function memoised(table: VariantTable): (text: string) => string {
  const cache = new Map<string, string>()
  return (text) => {
    const hit = cache.get(text)
    if (hit !== undefined) return hit
    const converted = rewriteVariant(text, table)
    if (cache.size >= CACHE_LIMIT) cache.clear()
    cache.set(text, converted)
    return converted
  }
}

export function createZhConverter(tables: ZhVariantTables): ZhConverter {
  const hant = memoised(tables.toHant)
  const hans = memoised(tables.toHans)
  return { toTraditional: hant, toSimplified: hans }
}

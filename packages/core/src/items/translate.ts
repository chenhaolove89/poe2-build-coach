export interface ModTranslationRule {
  /** Anchored regex over the English mod text; capture groups feed `zh` ($1, $2…). */
  re: string
  zh: string
}

const cache = new WeakMap<ModTranslationRule[], { re: RegExp; zh: string }[]>()

function compiled(rules: ModTranslationRule[]): { re: RegExp; zh: string }[] {
  let list = cache.get(rules)
  if (!list) {
    list = rules.map((r) => ({ re: new RegExp(r.re, 'i'), zh: r.zh }))
    cache.set(rules, list)
  }
  return list
}

/**
 * Translate a mod line via ordered regex templates. Returns null when no
 * template matches — callers then show the English text untranslated.
 */
export function translateMod(text: string, rules: ModTranslationRule[]): string | null {
  for (const rule of compiled(rules)) {
    const m = text.match(rule.re)
    if (m) return rule.zh.replace(/\$(\d)/g, (_, d) => m[Number(d)] ?? '')
  }
  return null
}

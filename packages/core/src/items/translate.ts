export interface ModTranslationRule {
  /** Anchored regex over the English mod text; capture groups feed `zh` ($1, $2…). */
  re: string
  zh: string
}

/** Sentence rule for stat lines: `phrases` lists capture groups to run through the phrase dictionary. */
export interface StatSentenceRule {
  re: string
  zh: string
  phrases?: number[]
}

export interface StatTranslationData {
  sentences: StatSentenceRule[]
  phrases: Record<string, string>
}

const cache = new WeakMap<object, unknown>()

function cached<T>(key: object, build: () => T): T {
  let v = cache.get(key)
  if (v === undefined) {
    v = build()
    cache.set(key, v)
  }
  return v as T
}

function compiled(rules: ModTranslationRule[]): { re: RegExp; zh: string }[] {
  return cached(rules, () => rules.map((r) => ({ re: new RegExp(r.re, 'i'), zh: r.zh })))
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

/** Translate a phrase: whole-string dictionary hit first, then longest-substring replacement. */
export function translatePhrase(phrase: string, dict: Record<string, string>): string {
  const p = phrase.trim()
  if (dict[p]) return dict[p]
  const keys = cached(dict, () => Object.keys(dict).sort((a, b) => b.length - a.length))
  let out = p
  for (const key of keys) {
    if (out.toLowerCase().includes(key.toLowerCase())) {
      out = out.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), dict[key])
    }
  }
  return out
}

/**
 * Translate a passive-tree stat line: sentence templates (with phrase
 * dictionary lookups) first, then a full-phrase fallback. Returns null when
 * nothing matched — callers show the English original.
 */
export function translateStat(text: string, data: StatTranslationData): string | null {
  const sentences = cached(data, () =>
    data.sentences.map((r) => ({
      re: new RegExp(r.re, 'i'),
      zh: r.zh,
      phrases: r.phrases ?? [],
    })),
  )
  for (const rule of sentences) {
    const m = text.match(rule.re)
    if (!m) continue
    let zh = rule.zh
    for (const idx of rule.phrases) {
      const phrase = m[idx]
      if (phrase === undefined) continue
      zh = zh.replace(new RegExp(`\\$${idx}`, 'g'), translatePhrase(phrase, data.phrases))
    }
    return zh.replace(/\$(\d)/g, (_, d) => m[Number(d)] ?? '')
  }
  const direct = translatePhrase(text, data.phrases)
  return direct === text.trim() ? null : direct
}

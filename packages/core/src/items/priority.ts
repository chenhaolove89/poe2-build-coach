import type { GameItem, PriorityData, PriorityRule, PriorityCheck } from '../types.js'

export type { PriorityData, PriorityRule, PriorityCheck }

/** Effective rule for an item: the "any" baseline plus every matching class rule. */
export function ruleForItem(data: PriorityData, itemClass: string | null): PriorityRule {
  const rules = [data.any]
  const cls = itemClass?.toLowerCase()
  if (cls) {
    for (const rule of data.classes) {
      if ((rule.match ?? []).some((m) => cls.includes(m.toLowerCase()))) rules.push(rule)
    }
  }
  return {
    core: [...new Set(rules.flatMap((r) => r.core))],
    good: [...new Set(rules.flatMap((r) => r.good ?? []))],
  }
}

function textHas(modTexts: string[], keyword: string): boolean {
  const kw = keyword.toLowerCase()
  return modTexts.some((t) => {
    const l = t.toLowerCase()
    if (l.includes(kw)) return true
    // "Resistances" should also hit singular "Resistance" lines.
    if (kw.endsWith('s') && l.includes(kw.slice(0, -1))) return true
    return false
  })
}

export function itemPriorityCheck(item: GameItem, data: PriorityData): PriorityCheck {
  const rule = ruleForItem(data, item.itemClass)
  const texts = item.mods.map((m) => m.text)
  const coreHits = rule.core.filter((k) => textHas(texts, k))
  const goodHits = (rule.good ?? []).filter((k) => textHas(texts, k))
  return {
    core: rule.core,
    coreHits,
    coreMissing: rule.core.filter((k) => !coreHits.includes(k)),
    goodHits,
  }
}
export type ModCategory = 'life' | 'resistance' | 'damage' | 'defence' | 'utility' | 'other'

const RULES: [ModCategory, RegExp][] = [
  ['life', /maximum Life|Life Regeneration|Life Recovery|Life Leech|Life on/i],
  // Penetration is offence even though the line mentions Resistance.
  ['damage', /Penetrates/i],
  ['resistance', /Resistance/i],
  ['damage', /Damage|Critical|Attack Speed|Cast Speed|Skill Speed/i],
  ['defence', /Armour|Evasion|Energy Shield|Block|Deflection|Ward/i],
  ['utility', /Duration|Charge|Rarity|Magnitude|Area of Effect|Movement Speed|Attributes?|Spirit|Accuracy/i],
]

/**
 * Bucket a mod line into a broad family for the gear-profile overview.
 * Order matters: life/resistance outrank the generic damage keywords.
 */
export function modCategory(text: string): ModCategory {
  for (const [category, re] of RULES) {
    if (re.test(text)) return category
  }
  return 'other'
}

export interface CategoryCount {
  category: ModCategory
  count: number
}

export function categoryCounts(modTexts: string[]): CategoryCount[] {
  const counts = new Map<ModCategory, number>()
  for (const text of modTexts) {
    const c = modCategory(text)
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  const order: ModCategory[] = ['life', 'resistance', 'damage', 'defence', 'utility', 'other']
  return order.filter((c) => counts.has(c)).map((c) => ({ category: c, count: counts.get(c)! }))
}

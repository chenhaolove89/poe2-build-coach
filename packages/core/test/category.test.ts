import { describe, expect, it } from 'vitest'
import { modCategory } from '../src/items/category.js'

describe('modCategory', () => {
  it('classifies core survivability mods', () => {
    expect(modCategory('+41 to maximum Life')).toBe('life')
    expect(modCategory('+31% to Cold Resistance')).toBe('resistance')
    expect(modCategory('+14% to all Elemental Resistances')).toBe('resistance')
  })

  it('classifies offence and defence families', () => {
    expect(modCategory('112% increased Physical Damage')).toBe('damage')
    expect(modCategory('8% increased Attack Speed')).toBe('damage')
    expect(modCategory('Damage Penetrates 6% Lightning Resistance')).toBe('damage')
    expect(modCategory('80% increased Evasion Rating')).toBe('defence')
    expect(modCategory('+12 to maximum Energy Shield')).toBe('defence')
    expect(modCategory('Gain Deflection Rating equal to 8% of Evasion Rating')).toBe('defence')
  })

  it('classifies utility and leaves the rest as other', () => {
    expect(modCategory('9% increased Skill Effect Duration')).toBe('utility')
    expect(modCategory('20% Chance to gain a Charge when you kill an enemy')).toBe('utility')
    expect(modCategory('18% increased Rarity of Items found')).toBe('utility')
    expect(modCategory('Some unknown custom effect')).toBe('other')
  })
})

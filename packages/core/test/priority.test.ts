import { describe, expect, it } from 'vitest'
import { itemPriorityCheck, ruleForItem } from '../src/items/priority.js'
import { parseItemText } from '../src/items/parseItemText.js'
import type { PriorityData } from '../src/types.js'

const DATA: PriorityData = {
  any: { core: ['maximum Life', 'Resistances'] },
  classes: [
    { match: ['ring'], core: ['maximum Mana'] },
    { match: ['boot'], core: ['movement speed'] },
    {
      match: ['bow', 'sword', 'staff'],
      core: ['Damage', 'Speed', 'Critical'],
      good: ['maximum Mana'],
    },
  ],
}

const parse = (t: string) => parseItemText(t)

describe('ruleForItem', () => {
  it('merges the any-rule with every matching class rule', () => {
    const rule = ruleForItem(DATA, 'Sapphire Ring')
    expect(rule.core).toEqual(['maximum Life', 'Resistances', 'maximum Mana'])
  })

  it('matches weapons by keyword', () => {
    const rule = ruleForItem(DATA, 'Two Hand Sword')
    expect(rule.core).toEqual(['maximum Life', 'Resistances', 'Damage', 'Speed', 'Critical'])
    expect(rule.good).toEqual(['maximum Mana'])
  })

  it('falls back to the any-rule when the item class is unknown', () => {
    expect(ruleForItem(DATA, null).core).toEqual(['maximum Life', 'Resistances'])
    expect(ruleForItem(DATA, 'Quiver').core).toEqual(['maximum Life', 'Resistances'])
  })
})

describe('itemPriorityCheck', () => {
  it('reports hits and the missing core gap', () => {
    const ring = parse(
      [
        'Item Class: Rings',
        'Rarity: RARE',
        'Winter Grip',
        'Two-Toned Ring',
        '--------',
        '+41 to maximum Life',
        '+31% to Cold Resistance',
      ].join('\n'),
    )
    const check = itemPriorityCheck(ring, DATA)
    expect(check.core).toEqual(['maximum Life', 'Resistances', 'maximum Mana'])
    // Cold Resistance satisfies the generic "Resistances" requirement.
    expect(check.coreHits).toEqual(['maximum Life', 'Resistances'])
    expect(check.coreMissing).toEqual(['maximum Mana'])
  })

  it('passes when every core keyword is present', () => {
    const ring = parse(
      [
        'Item Class: Rings',
        'Rarity: RARE',
        'Full Grip',
        'Two-Toned Ring',
        '--------',
        '+41 to maximum Life',
        '+31% to Cold Resistance',
        '+40 to maximum Mana',
      ].join('\n'),
    )
    const check = itemPriorityCheck(ring, DATA)
    expect(check.coreMissing).toEqual([])
  })
})

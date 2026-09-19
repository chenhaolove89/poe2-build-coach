import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseItemText } from '../src/items/parseItemText.js'
import { itemResistances, resistanceGap, sumResistances } from '../src/items/resistance.js'
import { compareItems } from '../src/items/compare.js'

const FIXTURE = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf-8')

describe('parseItemText (PoB <Item> body from a real build)', () => {
  it('parses the Essentia Sanguis unique with rune implicits', () => {
    const item = parseItemText(FIXTURE('item-3.txt'))
    expect(item.rarity).toBe('UNIQUE')
    expect(item.name).toBe('Essentia Sanguis')
    expect(item.base).toBe('Furtive Wraps')
    expect(item.evasion).toBe(116)
    expect(item.energyShield).toBe(37)
    expect(item.rune).toBe('Greater Iron Rune')
    expect(item.sockets).toBe('S')
    expect(item.levelReq).toBe(52)
    expect(item.itemLevel).toBe(82)
    expect(item.corrupted).toBe(false)

    const implicits = item.mods.filter((m) => m.kind === 'rune')
    expect(implicits.length).toBe(3)
    expect(implicits[0].text).toBe('18% increased Armour, Evasion and Energy Shield')
    expect(implicits[1].text).toBe('Bonded: +20 to maximum Life')
    expect(item.mods.some((m) => m.kind === 'explicit' && m.text.startsWith('57% increased Evasion'))).toBe(true)
    // Metadata lines must not leak into mods.
    expect(item.mods.some((m) => m.text.includes('Unique ID'))).toBe(false)
  })

  it('parses a rare ring without an Item Class header and drops the corrupted flag', () => {
    const item = parseItemText(FIXTURE('item-2.txt'))
    expect(item.rarity).toBe('RARE')
    expect(item.name).toBe('Chimeric Joy')
    expect(item.base).toBe('Sapphire')
    expect(item.corrupted).toBe(true)
    expect(item.mods.filter((m) => m.kind === 'explicit').length).toBe(4)
  })
})

describe('parseItemText (in-game Ctrl+C clipboard format)', () => {
  const CLIPBOARD = [
    'Item Class: Rings',
    'Rarity: RARE',
    'Winter Grip',
    'Two-Toned Ring',
    '--------',
    'Quality: +9%',
    '--------',
    'Requirements:',
    'Level: 44',
    '--------',
    'Item Level: 78',
    '--------',
    '+14% to Fire Resistance',
    '--------',
    '+31% to Cold Resistance',
    '+25% to Lightning Resistance',
    '+41 to maximum Life',
    '--------',
    'Corrupted',
  ].join('\n')

  it('splits implicit vs explicit and reads separators cleanly', () => {
    const item = parseItemText(CLIPBOARD)
    expect(item.itemClass).toBe('Rings')
    expect(item.name).toBe('Winter Grip')
    expect(item.base).toBe('Two-Toned Ring')
    expect(item.quality).toBe(9)
    expect(item.corrupted).toBe(true)
    expect(item.levelReq).toBe(44)

    // In-game clipboard text carries no "Implicits: N" header, so every mod
    // line lands as explicit — resistances and diffs are unaffected.
    const implicits = item.mods.filter((m) => m.kind === 'implicit')
    const explicits = item.mods.filter((m) => m.kind === 'explicit')
    expect(implicits).toEqual([])
    expect(explicits.map((m) => m.text)).toEqual([
      '+14% to Fire Resistance',
      '+31% to Cold Resistance',
      '+25% to Lightning Resistance',
      '+41 to maximum Life',
    ])
  })

  it('sums resistances and computes the gap to the 75% cap', () => {
    const item = parseItemText(CLIPBOARD)
    const r = itemResistances(item)
    expect(r).toEqual({ fire: 14, cold: 31, lightning: 25, chaos: 0 })
    expect(resistanceGap(r)).toEqual({ fire: 61, cold: 44, lightning: 50, chaos: 75 })
  })
})

describe('item comparison for gear swaps', () => {
  const parse = (t: string) => parseItemText(t)
  const CURRENT = [
    'Rarity: RARE',
    'Old Band',
    'Gold Ring',
    '--------',
    'Implicits: 1',
    '+40 to maximum Mana',
    '--------',
    '+48% to Fire Resistance',
    '+30 to maximum Life',
  ].join('\n')
  const CANDIDATE = [
    'Rarity: RARE',
    'New Band',
    'Gold Ring',
    '--------',
    'Implicits: 1',
    '+40 to maximum Mana',
    '--------',
    '+12% to all Elemental Resistances',
    '+45 to maximum Life',
    'Corrupted',
  ].join('\n')

  it('reports added/removed mods and the resistance swing', () => {
    const diff = compareItems(parse(CURRENT), parse(CANDIDATE))
    expect(diff.added.map((m) => m.text)).toEqual(['+12% to all Elemental Resistances', '+45 to maximum Life'])
    expect(diff.removed.map((m) => m.text)).toEqual(['+48% to Fire Resistance', '+30 to maximum Life'])
    expect(diff.resistances).toEqual({ fire: -36, cold: 12, lightning: 12, chaos: 0 })
  })

  it('handles duplicated mod lines as a multiset', () => {
    const two = parse('Rarity: NORMAL\nIron Ring\n--------\n+15% to Cold Resistance\n+15% to Cold Resistance')
    const one = parse('Rarity: NORMAL\nIron Ring\n--------\n+15% to Cold Resistance')
    const diff = compareItems(one, two)
    expect(diff.added).toHaveLength(1)
    expect(diff.removed).toHaveLength(0)
  })

  it('parses currency items and extracts stackSize in EN and ZH', () => {
    const enCurrency = [
      'Item Class: Stackable Currency',
      'Rarity: Currency',
      'Divine Orb',
      '--------',
      'Stack Size: 2/20',
      '--------',
      'Right click this item then left click a rare item to reroll the values of all its random explicit modifiers.',
    ].join('\n')
    const itemEn = parse('Item Class: Stackable Currency\nRarity: Currency\nDivine Orb\n--------\nStack Size: 2/20')
    expect(itemEn.rarity).toBe('CURRENCY')
    expect(itemEn.base).toBe('Divine Orb')
    expect(itemEn.stackSize).toBe(2)

    const zhCurrency = [
      '物品类别: 可堆叠通货',
      '稀有度: 通货',
      '神圣石',
      '--------',
      '堆叠数量: 5/20',
    ].join('\n')
    const itemZh = parse(zhCurrency)
    expect(itemZh.rarity).toBe('CURRENCY')
    expect(itemZh.base).toBe('神圣石')
    expect(itemZh.stackSize).toBe(5)
  })
})

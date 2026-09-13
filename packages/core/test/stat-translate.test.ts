import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { translateStat, translatePhrase } from '../src/items/translate.js'
import { loadTreeFixture } from './helpers/tree-fixture.js'
import type { StatTranslationData } from '../src/types.js'

const DATA: StatTranslationData = JSON.parse(
  readFileSync(new URL('../../data/stat-translations.json', import.meta.url), 'utf-8'),
)

describe('translateStat sentence templates', () => {
  it('translates the increased/reduced families with Chinese word order', () => {
    expect(translateStat('12% increased maximum Energy Shield', DATA)).toBe('最大能量护盾提高 12%')
    expect(translateStat('26% increased Projectile Damage', DATA)).toBe('投射物伤害提高 26%')
    expect(translateStat('8% reduced Slowing Potency of Debuffs on You', DATA)).toBe(
      '你所受负面效果的减速强度降低 8%',
    )
  })

  it('translates flat bonuses and attribute lines', () => {
    expect(translateStat('+41 to maximum Life', DATA)).toBe('+41 最大生命')
    expect(translateStat('+5 to any Attribute', DATA)).toBe('+5 任意属性')
    expect(translateStat('+60 to Spirit', DATA)).toBe('+60 精魂')
  })

  it('translates special sentence shapes', () => {
    expect(translateStat('4% faster start of Energy Shield Recharge', DATA)).toBe(
      '能量护盾充能更快开始充能(4%)',
    )
    expect(translateStat('Gain Deflection Rating equal to 8% of Evasion Rating', DATA)).toBe(
      '获得偏转值,相当于闪避值的 8%',
    )
    expect(translateStat('Damage Penetrates 6% Lightning Resistance', DATA)).toBe('伤害穿透 6% 闪电抗性')
    expect(translateStat('Minions deal 10% increased Damage', DATA)).toBe('召唤物伤害提高 10%')
    expect(translateStat('3% of Damage taken Recouped as Life', DATA)).toBe('承受伤害的 3% 以生命形式回收')
    expect(translateStat('+5% of Armour also applies to Elemental Damage', DATA)).toBe(
      '护甲同样适用于元素伤害,数值为护甲的 5%',
    )
    expect(translateStat('15% increased chance to Shock', DATA)).toBe('感电几率提高 15%')
    expect(translateStat('Gain 1 Rage on Melee Hit', DATA)).toBe('近战命中时获得 1 怒火')
  })

  it('returns null for untranslatable free-form text', () => {
    expect(translateStat('Totally unique flavour sentence here', DATA)).toBeNull()
  })
})

describe('tree stat coverage', () => {
  const TREE = loadTreeFixture()

  it('translates at least 80% of distinct node stat lines', () => {
    const lines = new Set<string>()
    for (const n of Object.values(TREE.nodes)) for (const s of n.stats ?? []) lines.add(s)
    let translated = 0
    let total = 0
    for (const line of lines) {
      total++
      if (translateStat(line, DATA) !== null) translated++
    }
    const ratio = translated / total
    // eslint-disable-next-line no-console
    console.log(`stat coverage: ${translated}/${total} = ${(ratio * 100).toFixed(1)}%`)
    expect(ratio).toBeGreaterThan(0.8)
  })
})

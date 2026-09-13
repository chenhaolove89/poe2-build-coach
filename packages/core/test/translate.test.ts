import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { translateMod } from '../src/items/translate.js'
import { parsePobCode } from '../src/pob/parse.js'
import { parseItemText } from '../src/items/parseItemText.js'
import type { ModTranslationRule } from '../src/types.js'

const RULES: ModTranslationRule[] = JSON.parse(
  readFileSync(new URL('../../data/mod-translations.json', import.meta.url), 'utf-8'),
)

describe('translateMod', () => {
  it('translates resistances, attributes and life with numbers preserved', () => {
    expect(translateMod('+41 to maximum Life', RULES)).toBe('+41 最大生命')
    expect(translateMod('+41% to Fire Resistance', RULES)).toBe('+41% 火焰抗性')
    expect(translateMod('+29% to Cold Resistance', RULES)).toBe('+29% 冰霜抗性')
    expect(translateMod('+11% to Chaos Resistance', RULES)).toBe('+11% 混沌抗性')
    expect(translateMod('+14 to Dexterity and Intelligence', RULES)).toBe('+14 敏捷和智慧')
    expect(translateMod('+98 to all Attributes', RULES)).toBe('+98 全属性')
  })

  it('translates increased/reduced families into Chinese word order', () => {
    expect(translateMod('112% increased Physical Damage', RULES)).toBe('物理伤害提高 112%')
    expect(translateMod('8% increased Attack Speed', RULES)).toBe('攻击速度提高 8%')
    expect(translateMod('18% increased Armour, Evasion and Energy Shield', RULES)).toBe('护甲、闪避与能量护盾提高 18%')
    expect(translateMod('59% reduced Charges per use', RULES)).toBe('每次使用消耗降低 59%')
    expect(translateMod('9% increased Skill Effect Duration', RULES)).toBe('技能效果持续时间延长 9%')
  })

  it('translates multi-capture adds and regeneration lines', () => {
    expect(translateMod('Adds 1 to 31 Lightning damage to Attacks', RULES)).toBe('攻击附加 1 至 31 闪电伤害')
    expect(translateMod('Adds 18 to 34 Physical Damage', RULES)).toBe('攻击附加 18 至 34 物理伤害')
    expect(translateMod('6.2 Life Regeneration per second', RULES)).toBe('每秒回复 6.2 生命')
    expect(translateMod('-4 Physical Damage taken from Attack Hits', RULES)).toBe('受攻击命中时承受的物理伤害降低 4')
  })

  it('returns null for unknown mods so callers can show the original', () => {
    expect(translateMod('Totally unknown custom mod line', RULES)).toBeNull()
  })

  it('covers the real build sample: templatable mods all translate', () => {
    const code = readFileSync(new URL('./fixtures/real-sample.txt', import.meta.url), 'utf-8').trim()
    const build = parsePobCode(code)
    const untranslated: string[] = []
    for (const item of build.items) {
      for (const mod of parseItemText(item.text).mods) {
        if (translateMod(mod.text, RULES) === null) untranslated.push(mod.text)
      }
    }
    // Unique-item flavour effects are intentionally untranslated (free-form
    // sentences). Snapshot guards the templatable set against regressions.
    expect(untranslated).toMatchSnapshot()
    expect(untranslated.length).toBeLessThan(40)
  })
})

import { describe, expect, it } from 'vitest'
import {
  splitTabletAffixes,
  tabletText,
  tabletsForSubtree,
  tabletsRankedByPlan,
  type TabletAffix,
  type TabletClass,
  type TabletData,
} from '../src/tablets/data.js'

function affix(partial: Partial<TabletAffix>): TabletAffix {
  return {
    gen: 2,
    families: [],
    generic: true,
    name: { en: 'A', 'zh-Hans': '甲', 'zh-Hant': '甲' },
    text: { en: 't', 'zh-Hans': 't', 'zh-Hant': 't' },
    ...partial,
  }
}

function tabletClass(partial: Partial<TabletClass>): TabletClass {
  return {
    id: 'x',
    subtree: null,
    tradeType: 'X Tablet',
    name: { en: 'X Tablet', 'zh-Hans': 'X石板', 'zh-Hant': 'X碑牌' },
    implicit: { en: 'i', 'zh-Hans': 'i', 'zh-Hant': 'i' },
    uses: 10,
    affixes: [],
    ...partial,
  }
}

const DATA: TabletData = {
  source: 'test',
  captured: '2026-09-25',
  genericFamilies: ['MapPackSizeIncrease'],
  tablets: [
    tabletClass({ id: 'breach', subtree: 'Breach' }),
    tabletClass({ id: 'ritual', subtree: 'Ritual' }),
    tabletClass({ id: 'overseer', subtree: null }),
  ],
  uniques: [],
}

describe('tabletText', () => {
  it('picks the realm language and falls back to English when a field is empty', () => {
    expect(tabletText({ en: 'Breach Tablet', 'zh-Hans': '裂隙石板', 'zh-Hant': '裂痕碑牌' }, 'zh-Hant')).toBe(
      '裂痕碑牌',
    )
    expect(tabletText({ en: 'Only', 'zh-Hans': '', 'zh-Hant': '' }, 'zh-Hans')).toBe('Only')
  })
})

describe('splitTabletAffixes', () => {
  it('splits the generic pool from the mechanic pool, keeping order', () => {
    const t = tabletClass({
      affixes: [
        affix({ name: { en: 'Gen1', 'zh-Hans': '', 'zh-Hant': '' }, generic: true, gen: 1 }),
        affix({ name: { en: 'Mech', 'zh-Hans': '', 'zh-Hant': '' }, generic: false, families: ['BreachX'] }),
        affix({ name: { en: 'Gen2', 'zh-Hans': '', 'zh-Hant': '' }, generic: true, gen: 2 }),
      ],
    })
    const { generic, mechanic } = splitTabletAffixes(t)
    expect(generic.map((a) => a.name.en)).toEqual(['Gen1', 'Gen2'])
    expect(mechanic.map((a) => a.name.en)).toEqual(['Mech'])
  })
})

describe('tabletsForSubtree', () => {
  it('returns only the classes serving that subtree', () => {
    expect(tabletsForSubtree(DATA, 'Breach').map((t) => t.id)).toEqual(['breach'])
    expect(tabletsForSubtree(DATA, 'Incursion')).toEqual([])
  })
})

describe('tabletsRankedByPlan', () => {
  it('leads with the plan\'s mechanics in plan order, tools last', () => {
    const ranked = tabletsRankedByPlan(DATA, ['Ritual', 'Breach'])
    expect(ranked.map((t) => t.id)).toEqual(['ritual', 'breach', 'overseer'])
  })
  it('falls back to data order when the plan touches nothing', () => {
    expect(tabletsRankedByPlan(DATA, []).map((t) => t.id)).toEqual(['breach', 'ritual', 'overseer'])
  })
})

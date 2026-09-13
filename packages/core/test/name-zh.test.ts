import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const NAMES: Record<string, string> = JSON.parse(
  readFileSync(new URL('../../data/name-zh.json', import.meta.url), 'utf-8'),
).names

const TREE = JSON.parse(readFileSync(new URL('../../data/trees/0_5/tree.json', import.meta.url), 'utf-8'))

describe('proper-noun translations', () => {
  it('covers every passive-tree keystone and notable', () => {
    const nodes = Object.values(TREE.nodes) as { name?: string; isKeystone?: boolean; isNotable?: boolean }[]
    const labelled = nodes.filter((n) => n.name && (n.isKeystone || n.isNotable))
    const missing = labelled.filter((n) => !(n.name! in NAMES))
    expect(labelled.length).toBeGreaterThan(1000)
    expect(missing.map((n) => n.name)).toEqual([])
  })

  it('translates classes, ascendancies and common gems', () => {
    expect(NAMES.Witch).toBe('女巫')
    expect(NAMES.Huntress).toBe('女猎人')
    expect(NAMES.Infernalist).toBe('狱火师')
    const gems = [
      'Fireball',
      'Spark',
      'Comet',
      'Herald of Ash',
      'Tempest Flurry',
      'Grim Feast',
      'Ice Strike',
    ]
    expect(gems.filter((g) => !(g in NAMES))).toEqual([])
  })

  it('translates unique item names and bases seen in real builds', () => {
    const seen = [
      'Headhunter',
      'Astramentis',
      'Stellar Amulet',
      'Heavy Belt',
      'Shrine Sceptre',
      'Runeforged Hawker\u0027s Jacket',
    ]
    expect(seen.filter((n) => !(n in NAMES))).toEqual([])
  })

  it('keeps the table free of untranslated Chinese keys', () => {
    const latinOnly = Object.entries(NAMES).filter(([, zh]) => /^[A-Za-z0-9'\u2019 :\-.,]+$/.test(zh))
    expect(latinOnly.length).toBe(0)
  })
})

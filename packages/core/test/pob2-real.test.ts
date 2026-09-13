import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parsePobCode } from '../src/pob/parse.js'

/**
 * Real share code captured from poe.ninja (SnusInMyBlood, Ice Shot
 * Spirit Walker, Runes of Aldur). Guards the parser against regressions
 * in the actual PoE2 <PathOfBuilding2> format.
 */
const REAL = readFileSync(new URL('./fixtures/real-sample.txt', import.meta.url), 'utf-8').trim()

describe('parsePobCode (real poe.ninja sample)', () => {
  const parsed = parsePobCode(REAL)

  it('extracts the character identity', () => {
    expect(parsed.className).toBe('Huntress')
    expect(parsed.ascendClassName).toBe('Spirit Walker')
    expect(parsed.level).toBe(100)
    expect(parsed.treeVersion).toBe('0_5')
  })

  it('extracts a large allocated node list from <Spec nodes>', () => {
    expect(parsed.passiveNodes.length).toBeGreaterThan(100)
    expect(new Set(parsed.passiveNodes).size).toBe(parsed.passiveNodes.length)
  })

  it('extracts skill groups with gem names from nameSpec', () => {
    expect(parsed.skills.length).toBeGreaterThan(3)
    const allGems = parsed.skills.flatMap((s) => s.gems)
    expect(allGems.length).toBeGreaterThan(10)
    expect(allGems.some((g) => g.name === 'Vivid Stampede')).toBe(true)
    expect(allGems.every((g) => g.name !== 'unknown gem')).toBe(true)
  })

  it('extracts items with rarity, name and base', () => {
    expect(parsed.items.length).toBeGreaterThan(5)
    const fromNothing = parsed.items.find((i) => i.name === 'From Nothing')
    expect(fromNothing).toBeTruthy()
    expect(fromNothing!.base).toBe('Diamond')
    expect(fromNothing!.rarity).toBe('UNIQUE')
  })
})

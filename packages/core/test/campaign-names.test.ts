import { describe, expect, it } from 'vitest'
import {
  areaNameCandidates,
  campaignNameIndex,
  resolveCampaignZone,
  type CampaignNameEntry,
} from '../src/campaign/names.js'

/** Two acts, two zones each, in play order — the ambiguity playground. */
const ENTRIES: CampaignNameEntry[] = [
  { ref: { key: 'act1:alpha', act: 'act1', index: 0, order: 0 }, name: '河岸' },
  { ref: { key: 'act1:beta', act: 'act1', index: 1, order: 1 }, name: '营地' },
  { ref: { key: 'act2:alpha', act: 'act2', index: 0, order: 2 }, name: '河岸' },
  { ref: { key: 'act2:gamma', act: 'act2', index: 1, order: 3 }, name: 'The Far Woods' },
]

const INDEX = campaignNameIndex(ENTRIES)

describe('areaNameCandidates', () => {
  it('keeps a plain name as its only form', () => {
    expect(areaNameCandidates('河岸')).toEqual(['河岸'])
  })

  it('offers the part after the last colon for kind-prefixed names', () => {
    expect(areaNameCandidates('藏身处：海岸')).toEqual(['藏身处：海岸', '海岸'])
    expect(areaNameCandidates('town:riverbank')).toEqual(['town:riverbank', 'riverbank'])
  })

  it('does not invent a suffix when the name ends with the colon', () => {
    expect(areaNameCandidates('王镇：')).toEqual(['王镇：'])
  })
})

describe('campaignNameIndex', () => {
  it('folds case and whitespace for English spellings', () => {
    expect(resolveCampaignZone(INDEX, '  the far woods ', null)?.key).toBe('act2:gamma')
  })

  it('drops empty names instead of indexing them', () => {
    expect(campaignNameIndex([{ ref: ENTRIES[0].ref, name: '   ' }]).size).toBe(0)
  })
})

describe('resolveCampaignZone', () => {
  it('resolves a unique name with no position', () => {
    expect(resolveCampaignZone(INDEX, 'The Far Woods', null)?.key).toBe('act2:gamma')
  })

  it('refuses an ambiguous name when the position is unknown', () => {
    expect(resolveCampaignZone(INDEX, '河岸', null)).toBeNull()
  })

  it('breaks an ambiguity towards the nearest zone ahead', () => {
    // From act1:alpha the nearest 河岸 is itself — re-entering the current zone
    // is a no-op, not a jump to act2.
    expect(resolveCampaignZone(INDEX, '河岸', ENTRIES[0].ref)?.key).toBe('act1:alpha')
    expect(resolveCampaignZone(INDEX, '河岸', ENTRIES[2].ref)?.key).toBe('act2:alpha')
  })

  it('prefers forward over backward at equal distance', () => {
    // From 营地 (order 1), 河岸 sits one ahead (act2) and one behind (act1):
    // the walk goes on, so the pointer moves to act2.
    expect(resolveCampaignZone(INDEX, '河岸', ENTRIES[1].ref)?.key).toBe('act2:alpha')
  })

  it('follows a unique backward match — the player really went back', () => {
    expect(resolveCampaignZone(INDEX, 'The Far Woods', ENTRIES[0].ref)?.key).toBe('act2:gamma')
  })

  it('returns the current zone unchanged when its own name re-logs', () => {
    expect(resolveCampaignZone(INDEX, 'The Far Woods', ENTRIES[3].ref)?.key).toBe('act2:gamma')
  })

  it('ignores names nothing in the campaign answers to', () => {
    expect(resolveCampaignZone(INDEX, '毁坏的林场', ENTRIES[0].ref)).toBeNull()
    expect(resolveCampaignZone(INDEX, '藏身处：海岸', ENTRIES[0].ref)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import pako from 'pako'
import {
  SHARE_PREFIX,
  ShareCodeError,
  decodeShareSnapshot,
  emptySnapshot,
  encodeShareSnapshot,
  isShareCode,
  type ShareSnapshot,
} from '../src/share/snapshot.js'

function snapshot(partial: Partial<ShareSnapshot> = {}): ShareSnapshot {
  return { ...emptySnapshot(), ...partial }
}

/** Round-trip through the codec, so a test reads as "what comes back out". */
function roundTrip(input: ShareSnapshot): ShareSnapshot {
  return decodeShareSnapshot(encodeShareSnapshot(input))
}

/** Build a code by hand through the same transport, for payloads the encoder would never write. */
function handBuilt(payload: unknown): string {
  const deflated = pako.deflate(new TextEncoder().encode(JSON.stringify(payload)))
  return SHARE_PREFIX + Buffer.from(deflated).toString('base64url')
}

describe('encodeShareSnapshot', () => {
  it('produces a code carrying our prefix, not a PoB one', () => {
    const code = encodeShareSnapshot(snapshot({ realm: 'cn' }))
    expect(code.startsWith(SHARE_PREFIX)).toBe(true)
    expect(isShareCode(code)).toBe(true)
  })

  it('is deterministic: the same state always encodes the same way', () => {
    const state = snapshot({ realm: 'intl', league: 'Standard', level: 90, passiveNodes: [1, 2, 3] })
    expect(encodeShareSnapshot(state)).toBe(encodeShareSnapshot(state))
  })

  it('keeps a full hand-off small enough to paste', () => {
    // 573 atlas hashes plus a few items is the realistic worst case.
    const atlas = Array.from({ length: 573 }, (_, i) => 50000 + i * 7)
    const code = encodeShareSnapshot(snapshot({ realm: 'cn', league: '裂隙赛季', atlasNodes: atlas }))
    expect(code.length).toBeLessThan(4000)
  })

  it('never writes a credential field, even if one is smuggled in', () => {
    // The session cookie is a login, not a setting. A code that carried it would
    // hand over the account, so the encoder writes only the fields it declares.
    const smuggled = { ...snapshot({ realm: 'cn' }), cnSession: 'POESESSID=deadbeef' } as ShareSnapshot
    const decoded = decodeShareSnapshot(encodeShareSnapshot(smuggled))
    const serialized = JSON.stringify(decoded)
    expect(serialized).not.toContain('deadbeef')
    expect(serialized).not.toContain('POESESSID')
  })
})

describe('decodeShareSnapshot', () => {
  it('round-trips every field it carries', () => {
    const state = snapshot({
      realm: 'cn',
      league: '裂隙赛季',
      level: 91,
      className: 'Ranger',
      ascendClassName: 'Deadeye',
      treeVersion: '0_5',
      passiveNodes: [101, 202, 303],
      questPoints: 22,
      atlasNodes: [50796, 62548],
      items: [{ text: '破晓之剑\n稀有', slot: 'Weapon 1' }],
      skills: [{ label: '主技能', gems: [{ name: 'Lightning Arrow', level: 20, quality: 15, enabled: true }] }],
    })
    expect(roundTrip(state)).toEqual(state)
  })

  it('sorts and de-duplicates node lists, so order is not part of the state', () => {
    const decoded = roundTrip(snapshot({ passiveNodes: [30, 10, 20, 10], atlasNodes: [5, 5, 1] }))
    expect(decoded.passiveNodes).toEqual([10, 20, 30])
    expect(decoded.atlasNodes).toEqual([1, 5])
  })

  it('rejects a PoB share code, which is the code most likely to be pasted in', () => {
    expect(() => decodeShareSnapshot('eNqFVEtv2zAM/i7hPAmwHSdpsu9h7xAkTtK0')).toThrow(ShareCodeError)
  })

  it('rejects an empty or whitespace-only paste', () => {
    expect(() => decodeShareSnapshot('')).toThrow(ShareCodeError)
    expect(() => decodeShareSnapshot('   ')).toThrow(ShareCodeError)
  })

  it('rejects a truncated code instead of returning half a state', () => {
    const code = encodeShareSnapshot(
      snapshot({ realm: 'cn', items: [{ text: 'x'.repeat(600), slot: null }] }),
    )
    const cut = code.slice(0, Math.floor(code.length * 0.6))
    expect(() => decodeShareSnapshot(cut)).toThrow(ShareCodeError)
  })

  it('rejects a body with characters outside the alphabet', () => {
    expect(() => decodeShareSnapshot(`${SHARE_PREFIX}not*base64!`)).toThrow(ShareCodeError)
  })

  it('rejects a version it does not understand rather than guessing', () => {
    expect(() => decodeShareSnapshot(handBuilt({ v: 2, realm: 'cn' }))).toThrow(/版本/)
    expect(() => decodeShareSnapshot(handBuilt({ realm: 'cn' }))).toThrow(/版本/)
  })

  it('accepts a bare-string item, so an older or simpler code still reads', () => {
    const decoded = decodeShareSnapshot(handBuilt({ v: 1, items: ['破晓之剑\n稀有', ''] }))
    expect(decoded.items).toEqual([{ text: '破晓之剑\n稀有', slot: null }])
  })

  it('drops a wrong-typed field instead of losing the whole hand-off', () => {
    const decoded = decodeShareSnapshot(
      handBuilt({ v: 1, realm: 'cn', level: 'ninety', nodes: [7, 'x', -1, 0, 8], atlas: 'nope' }),
    )
    expect(decoded.realm).toBe('cn')
    expect(decoded.level).toBeNull()
    expect(decoded.passiveNodes).toEqual([7, 8])
    expect(decoded.atlasNodes).toEqual([])
  })

  it('tolerates whitespace a paste picked up, including newlines', () => {
    const code = encodeShareSnapshot(snapshot({ realm: 'cn', level: 90 }))
    const wrapped = `${SHARE_PREFIX}\n${code.slice(SHARE_PREFIX.length, 20)}\n${code.slice(20)}`
    expect(decodeShareSnapshot(wrapped).level).toBe(90)
  })
})

describe('isShareCode', () => {
  it('recognises our prefix and nothing else', () => {
    expect(isShareCode(encodeShareSnapshot(emptySnapshot()))).toBe(true)
    expect(isShareCode(`  ${SHARE_PREFIX}abc`)).toBe(true)
    expect(isShareCode('eNqFVEtv2zAM')).toBe(false)
    expect(isShareCode('')).toBe(false)
  })
})

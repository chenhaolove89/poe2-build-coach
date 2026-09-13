import { describe, expect, it } from 'vitest'
import { buildToShareCode } from '../src/pob/encode.js'
import { decodeShareCode, encodeShareCode } from '../src/pob/decode.js'
import { parsePobCode, parsePobXml } from '../src/pob/parse.js'
import { PobParseError } from '../src/types.js'
import type { BuildSnapshot } from '../src/types.js'

const SAMPLE: BuildSnapshot = {
  className: 'Witch',
  ascendClassName: 'Infernalist',
  level: 92,
  treeVersion: '0_5',
  passiveNodes: [12345, 23456, 34567, 61198],
  treeSpecUrls: ['https://poe2db.tw/passive-tree/AAAAexample'],
  skills: [
    {
      label: 'Fireball',
      gems: [
        { name: 'Fireball', level: 20, quality: 20, enabled: true },
        { name: 'Concentrated Effect', level: 20, quality: 0, enabled: true },
        { name: 'Arcane Tempo', level: 19, quality: 0, enabled: false },
      ],
    },
    {
      label: 'Summon Skeletal Arsonist',
      gems: [{ name: 'Summon Skeletal Arsonist', level: 20, quality: 0, enabled: true }],
    },
  ],
  items: [
    {
      id: 1,
      rarity: 'UNIQUE',
      name: 'Mailbreaker',
      base: 'Ancient Spirit Helmet',
      itemClass: 'Helmet',
      slot: 'Helmet',
      text: 'Rarity: UNIQUE\nItem Class: Helmets\nMailbreaker\nAncient Spirit Helmet\n+1 to Level of all Minion Skills\n',
    },
  ],
}

describe('decodeShareCode', () => {
  it('round-trips base64+zlib', () => {
    const code = encodeShareCode('<PathOfBuilding><Build level="1"/></PathOfBuilding>')
    expect(decodeShareCode(code)).toBe('<PathOfBuilding><Build level="1"/></PathOfBuilding>')
  })

  it('tolerates url-safe alphabet, whitespace and missing padding', () => {
    const xml = '<PathOfBuilding><Build level="1"/></PathOfBuilding>'
    const code = encodeShareCode(xml).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const wrapped = code.slice(0, 20) + '\n ' + code.slice(20)
    expect(decodeShareCode(wrapped)).toBe(xml)
  })

  it('rejects garbage with PobParseError', () => {
    expect(() => decodeShareCode('not-a-valid-code!!')).toThrow(PobParseError)
    expect(() => decodeShareCode('   ')).toThrow(PobParseError)
  })
})

describe('parsePobCode', () => {
  it('parses a full build snapshot out of a share code', () => {
    const code = buildToShareCode(SAMPLE)
    const parsed = parsePobCode(code)

    expect(parsed.className).toBe('Witch')
    expect(parsed.ascendClassName).toBe('Infernalist')
    expect(parsed.level).toBe(92)
    expect(parsed.treeVersion).toBe('0_5')
    expect(parsed.passiveNodes).toEqual([12345, 23456, 34567, 61198])
    expect(parsed.treeSpecUrls).toEqual(['https://poe2db.tw/passive-tree/AAAAexample'])
    expect(parsed.skills).toHaveLength(2)
    expect(parsed.skills[0].label).toBe('Fireball')
    expect(parsed.skills[0].gems[2]).toMatchObject({ name: 'Arcane Tempo', enabled: false })
    expect(parsed.items[0]).toMatchObject({ rarity: 'UNIQUE', name: 'Mailbreaker', base: 'Ancient Spirit Helmet', slot: 'Helmet' })
  })

  it('accepts the PoE2 <PathOfBuilding2> root with Spec-level nodes and nameSpec gems', () => {
    const xml =
      '<PathOfBuilding2>' +
      '<Build level="100" className="Huntress" ascendClassName="Spirit Walker" mainSocketGroup="13"/>' +
      '<Skills><SkillSet id="1"><Skill enabled="true" label="" mainActiveSkill="1">' +
      '<Gem nameSpec="Vivid Stampede" level="20" quality="0" enabled="true"/>' +
      '<Gem nameSpec="Overcharge" level="1" quality="0" enabled="true"/>' +
      '</Skill></SkillSet></Skills>' +
      '<Tree activeSpec="1"><Spec ascendClassId="2" classId="8" nodes="535,1823,1841" treeVersion="0_5"></Spec></Tree>' +
      '</PathOfBuilding2>'
    const parsed = parsePobXml(xml)
    expect(parsed.className).toBe('Huntress')
    expect(parsed.ascendClassName).toBe('Spirit Walker')
    expect(parsed.treeVersion).toBe('0_5')
    expect(parsed.passiveNodes).toEqual([535, 1823, 1841])
    expect(parsed.skills[0].label).toBe('Vivid Stampede')
    expect(parsed.skills[0].gems.map((g) => g.name)).toEqual(['Vivid Stampede', 'Overcharge'])
  })

  it('tolerates minimal XML with only a Build element', () => {
    const parsed = parsePobXml('<PathOfBuilding><Build className="Mercenary" level="3"/></PathOfBuilding>')
    expect(parsed.className).toBe('Mercenary')
    expect(parsed.level).toBe(3)
    expect(parsed.passiveNodes).toEqual([])
    expect(parsed.skills).toEqual([])
    expect(parsed.items).toEqual([])
  })

  it('treats disabled="false" gems correctly', () => {
    const xml = '<PathOfBuilding><Skills><SkillSet><Skill mainActiveSkill="Frost Bolt"><Gem name="Frost Bolt" level="20" enabled="true"/><Gem name="Ice Bite" level="20" enabled="false"/></Skill></SkillSet></Skills></PathOfBuilding>'
    const parsed = parsePobXml(xml)
    expect(parsed.skills[0].gems[0].enabled).toBe(true)
    expect(parsed.skills[0].gems[1].enabled).toBe(false)
  })

  it('maps item slots back onto items', () => {
    const xml =
      '<PathOfBuilding><Items>' +
      '<Item id="7" itemClass="Ring">Rarity: MAGIC\nSapphire Ring of the Underground\n+12% to Cold Resistance\n</Item>' +
      '<Slot name="Ring 2" itemId="7"/>' +
      '</Items></PathOfBuilding>'
    const parsed = parsePobXml(xml)
    expect(parsed.items[0].slot).toBe('Ring 2')
    expect(parsed.items[0].base).toBe('Sapphire Ring of the Underground')
  })

  it('rejects XML without a PathOfBuilding root', () => {
    expect(() => parsePobXml('<OtherRoot/>')).toThrow(PobParseError)
    expect(() => parsePobXml('plain text, not xml')).toThrow(PobParseError)
  })
})

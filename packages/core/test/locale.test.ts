import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseItemText } from '../src/items/parseItemText.js'
import { REALMS, REALM_IDS, isRealmId, realmOf } from '../src/trade/realms.js'
import { createZhConverter, rewriteVariant } from '../src/i18n/variant.js'
import { buildStatIndex, matchStat } from '../src/trade/matchStats.js'
import type { StatIndexEntry } from '../src/trade/matchStats.js'
// The pipeline script keeps its own copy of the rewrite; this import is what
// keeps the two from drifting apart.
import { convert } from '../../../scripts/build-zh-variant.mjs'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf-8')
const DATA = (name: string) => JSON.parse(read(`../../data/${name}`)) as never

// ---------------------------------------------------------------- Chinese item text

/** A real 台服 Ctrl+C paste (advanced tooltips on). */
const TW_BOW = [
  '物品種類: 弓',
  '稀有度: 稀有',
  'Ghoul Bane',
  'Gemini Bow',
  '--------',
  '物理傷害: 39 到 73',
  '閃電傷害: 2 到 49 (lightning)',
  '暴擊率: 5.00%',
  '每秒攻擊次數: 1.20',
  '--------',
  '需求: 等級 78, 212 敏捷',
  '--------',
  '物品等級: 81',
  '--------',
  '{ 固定詞綴 — 攻擊 }',
  '弓攻擊發射 1 個額外箭矢 (implicit)',
  '--------',
  '{ 前綴 "火花的"(階層：5) — 傷害,元素,閃電,攻擊 }',
  '附加 2(1-3) 至 49(37-52) 閃電傷害',
  '{ 後綴 "分裂之"(階層：1) — 攻擊 }',
  '弓攻擊發射 1 個額外箭矢 (fractured)',
  '--------',
  '破裂之物',
].join('\n')

/** A real 国服 paste, complete with its fullwidth requirements colon. */
const CN_ARMOUR = [
  '物品类别: 护甲',
  '稀有度: 稀有',
  '祸害 魔甲',
  '滑击背心',
  '--------',
  '品质: +20% (augmented)',
  '闪避值: 2673 (augmented)',
  '--------',
  '需求： 等级 70, 121 敏捷',
  '--------',
  '插槽: S S',
  '--------',
  '物品等级: 81',
  '--------',
  '护甲、闪避和能量护盾提高 40% (rune)',
  '--------',
  '{ 前缀属性 "易变的" (等阶：1) — 闪避 }',
  '+294 (262-300) 点闪避值',
].join('\n')

describe('parseItemText (Traditional Chinese client)', () => {
  const item = parseItemText(TW_BOW)

  it('reads the localised headers', () => {
    expect(item.itemClass).toBe('弓')
    expect(item.rarity).toBe('RARE')
    expect(item.name).toBe('Ghoul Bane')
    expect(item.base).toBe('Gemini Bow')
    expect(item.levelReq).toBe(78)
    expect(item.itemLevel).toBe(81)
    expect(item.corrupted).toBe(false)
  })

  it('keeps the affix out of the mod list', () => {
    // "{ 前綴 ... }" describes the mod under it; it is not itself a mod.
    expect(item.mods.some((m) => m.text.includes('前綴'))).toBe(false)
    expect(item.mods.some((m) => m.text.includes('後綴'))).toBe(false)
  })

  it('maps parenthetical tags to mod kinds and drops them from the text', () => {
    const implicit = item.mods.filter((m) => m.kind === 'implicit')
    const fractured = item.mods.filter((m) => m.kind === 'fractured')
    expect(implicit.map((m) => m.text)).toEqual(['弓攻擊發射 1 個額外箭矢'])
    expect(fractured.map((m) => m.text)).toEqual(['弓攻擊發射 1 個額外箭矢'])
  })

  it('keeps a rolled range that is also parenthesised', () => {
    // "附加 2(1-3) 至 49(37-52) ..." — only whitelisted tag words are stripped.
    const roll = item.mods.find((m) => m.text.startsWith('附加'))
    expect(roll?.text).toBe('附加 2(1-3) 至 49(37-52) 閃電傷害')
    expect(roll?.kind).toBe('explicit')
  })

  it('does not turn the Fractured Item marker into a mod', () => {
    expect(item.mods.some((m) => m.text === '破裂之物')).toBe(false)
  })
})

describe('parseItemText (Simplified Chinese client)', () => {
  const item = parseItemText(CN_ARMOUR)

  it('reads the localised headers, including the fullwidth requirements colon', () => {
    expect(item.itemClass).toBe('护甲')
    expect(item.rarity).toBe('RARE')
    expect(item.name).toBe('祸害 魔甲')
    expect(item.base).toBe('滑击背心')
    expect(item.quality).toBe(20)
    expect(item.evasion).toBe(2673)
    expect(item.levelReq).toBe(70)
    expect(item.sockets).toBe('S S')
    expect(item.itemLevel).toBe(81)
  })

  it('resolves the rune tag and preserves the rolled roll range', () => {
    expect(item.mods.find((m) => m.kind === 'rune')?.text).toBe('护甲、闪避和能量护盾提高 40%')
    expect(item.mods.find((m) => m.text.startsWith('+294'))?.text).toBe('+294 (262-300) 点闪避值')
  })
})

describe('parseItemText (English clients)', () => {
  it('reads the PoE2 one-line requirements form', () => {
    const item = parseItemText(
      ['Item Class: Boots', 'Rarity: RARE', 'Doom Tread', 'Runeforged Wanderer Shoes', '--------', 'Requires: Level 78, 212 Dex'].join('\n'),
    )
    expect(item.levelReq).toBe(78)
    expect(item.base).toBe('Runeforged Wanderer Shoes')
  })

  it('still reads the PoE1 multi-line requirements block', () => {
    const item = parseItemText(
      ['Rarity: RARE', 'Winter Grip', 'Two-Toned Ring', '--------', 'Requirements:', 'Level: 44', ' Str: 114'].join('\n'),
    )
    expect(item.levelReq).toBe(44)
    expect(item.mods).toEqual([])
  })

  it('strips a trailing tag but keeps the mod text', () => {
    const item = parseItemText(
      ['Rarity: RARE', 'Doom Tread', 'Runeforged Wanderer Shoes', '--------', '+129 to maximum Life (augmented)'].join('\n'),
    )
    expect(item.mods[0]).toEqual({ text: '+129 to maximum Life', kind: 'explicit' })
  })
})

// ---------------------------------------------------------------- realm-aware matching

const CN_PACK = DATA('trade-stats.cn.json') as { stats: StatIndexEntry[] }
const TW_PACK = DATA('trade-stats.tw.json') as { stats: StatIndexEntry[] }
const INTL_PACK = DATA('trade-stats.json') as { stats: StatIndexEntry[] }
const CN_INDEX = buildStatIndex(CN_PACK.stats)
const TW_INDEX = buildStatIndex(TW_PACK.stats)
const INTL_INDEX = buildStatIndex(INTL_PACK.stats)

describe('realm stat packs', () => {
  it('carries the same stat ids as the international pack, in another language', () => {
    // Same affix, three wordings. Asserted through matchStat rather than by
    // reading the index bucket, because a skeleton can be shared by several
    // groups (crafted and explicit both list maximum Life) and picking the
    // right one is matchStat's job.
    const id = 'explicit.stat_3299347043'
    expect(matchStat('+129 to maximum Life', 'explicit', INTL_INDEX).statId).toBe(id)
    expect(matchStat('+45 生命上限', 'explicit', CN_INDEX).statId).toBe(id)
    expect(matchStat('+45最大生命', 'explicit', TW_INDEX).statId).toBe(id)
  })

  it('matches a Simplified mod line against the 国服 pack', () => {
    expect(matchStat('+45 生命上限', 'explicit', CN_INDEX).statId).toBe('explicit.stat_3299347043')
    expect(matchStat('火焰抗性 +45%', 'explicit', CN_INDEX).statId).toBe('explicit.stat_3372524247')
  })

  it('matches a Traditional mod line against the 台服 pack', () => {
    expect(matchStat('+45最大生命', 'explicit', TW_INDEX).statId).toBe('explicit.stat_3299347043')
    expect(matchStat('+45%火焰抗性', 'explicit', TW_INDEX).statId).toBe('explicit.stat_3372524247')
  })

  it('does not cross the language boundary', () => {
    // The 国服 wording is not in the 台服 pack; a realm switch has to bring the
    // pack with it, which is the whole reason the setting exists.
    expect(matchStat('+45 生命上限', 'explicit', TW_INDEX).statId).toBeNull()
    expect(matchStat('+45最大生命', 'explicit', CN_INDEX).statId).toBeNull()
  })
})

describe('realm metadata', () => {
  it('describes each realm with its own host and client language', () => {
    expect(REALM_IDS).toEqual(['intl', 'cn', 'tw'])
    expect(REALMS.cn.apiBase).toBe('https://poe.game.qq.com/api/trade2')
    expect(REALMS.tw.apiBase).toBe('https://pathofexile.tw/api/trade2')
    expect(REALMS.cn.lang).toBe('zh-Hans')
    expect(REALMS.tw.lang).toBe('zh-Hant')
  })

  it('flags the one realm that will not answer anonymously', () => {
    // Tencent returns 401 Unauthorized for search without a session cookie.
    expect(REALMS.cn.loginRequired).toBe(true)
    expect(REALMS.intl.loginRequired).toBe(false)
    expect(REALMS.tw.loginRequired).toBe(false)
  })

  it('falls back to the international realm for junk input', () => {
    expect(realmOf('nope').id).toBe('intl')
    expect(realmOf(null).id).toBe('intl')
    expect(isRealmId('tw')).toBe(true)
    expect(isRealmId('de')).toBe(false)
  })

  it('carries the script each realm reads, so language needs no separate setting', () => {
    // Simplified exists only on the Tencent realm. The international client
    // ships Traditional rather than Simplified, so an English-locale realm
    // still reads Traditional instead of falling back to English.
    expect(REALMS.cn.reading).toBe('hans')
    expect(REALMS.tw.reading).toBe('hant')
    expect(REALMS.intl.reading).toBe('hant')
  })
})

// ---------------------------------------------------------------- 简 <-> 繁

const VARIANT = DATA('zh-variant.json')
const converter = createZhConverter(VARIANT as never)

describe('Chinese variant converter', () => {
  it('prefers whole phrases over single characters', () => {
    // 制 alone stays 制 and 升 alone stays 升; the phrase table is what turns
    // these into real Traditional.
    expect(converter.toTraditional('制作')).toBe('製作')
    expect(converter.toTraditional('升华')).toBe('昇華')
  })

  it('rewrites the terms the UI and data packs actually use', () => {
    expect(converter.toTraditional('天赋树')).toBe('天賦樹')
    expect(converter.toTraditional('传奇装备')).toBe('傳奇裝備')
    expect(converter.toTraditional('护盾')).toBe('護盾')
    expect(converter.toTraditional('物品等级')).toBe('物品等級')
    expect(converter.toTraditional('先祖秘藏')).toBe('先祖祕藏')
    expect(converter.toTraditional('未切割的宝石')).toBe('未切割的寶石')
  })

  it('leaves text that is already in the target variant alone', () => {
    expect(converter.toTraditional('火焰抗性')).toBe('火焰抗性')
    expect(converter.toTraditional('稀有')).toBe('稀有')
    expect(converter.toSimplified('火焰抗性')).toBe('火焰抗性')
  })

  it('round-trips Simplified through Traditional', () => {
    for (const word of ['天赋树', '升华', '制作', '传奇', '护盾', '先祖秘藏', '深渊骨骸']) {
      expect(converter.toSimplified(converter.toTraditional(word))).toBe(word)
    }
  })

  it('converts Traditional data back for a Simplified reader', () => {
    // 台服 returns 換界石 where 国服 says 引路石 — the characters convert, the
    // terminology does not, which is why the realm's own pack is the source.
    expect(converter.toSimplified('天賦樹')).toBe('天赋树')
    expect(converter.toSimplified('換界石')).toBe('换界石')
    expect(converter.toSimplified('已汙染')).toBe('已污染')
  })

  it('stays in step with the pipeline script', () => {
    const sample = '天赋树与传奇装备的护盾、升华、先祖秘藏、未切割的宝石 +45% 火焰抗性'
    const tables = VARIANT as unknown as { toHant: never }
    expect(rewriteVariant(sample, tables.toHant)).toBe(convert(sample, tables.toHant))
  })
})

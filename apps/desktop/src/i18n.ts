/**
 * Display language for everything Chinese on screen.
 *
 * Two different sources of Chinese meet in the UI and they do not enter the
 * same way:
 *
 *  - Copy the app authored, like "天赋树" and the English -> Chinese name
 *    dictionary's output. Always Simplified, so it converts Simplified ->
 *    Traditional when that is how the reader wants it.
 *  - Text the current realm's game client produced: league names, and the item
 *    names and mod lines a player pasted. Its language is the realm's
 *    (`realm.lang`), which is independent of the reader's preference — a 台服
 *    player may well read Simplified. So this direction is decided per realm.
 *
 * Anything that renders Chinese should come through here rather than from
 * nameZh() directly, or it will ignore the language setting.
 */
import { createZhConverter, type RealmLanguage, type ZhVariantTables } from '@poe2coach/core'
import variantJson from '@poe2coach/data/zh-variant.json'
import { translatedName } from './nameZh'
import { realm, zhVariant } from './settings'

const converter = createZhConverter(variantJson as unknown as ZhVariantTables)

/** UI copy, authored in Simplified, rendered in the reader's variant. */
export function t(text: string): string {
  return zhVariant.value === 'hant' ? converter.toTraditional(text) : text
}

/**
 * Chinese text produced by a client that writes `lang`. A no-op for the English
 * realm, and for a reader who already reads that realm's own variant. Accepts
 * nullish so templates can pass `item.name ?? item.base` straight in.
 */
export function dialect(text: string | null | undefined, lang: RealmLanguage = realm.value.lang): string {
  if (!text) return ''
  if (lang === 'zh-Hans') return zhVariant.value === 'hant' ? converter.toTraditional(text) : text
  if (lang === 'zh-Hant') return zhVariant.value === 'hans' ? converter.toSimplified(text) : text
  return text
}

/**
 * Chinese name for an English proper noun, in the reader's variant. Null when
 * the dictionary has nothing, which callers use to decide whether a name needs
 * the bilingual treatment at all.
 */
export function zhName(en: string | null | undefined): string | null {
  const tr = translatedName(en)
  return tr ? t(tr.zh) : null
}

/**
 * "中文 English", or the text as-is when it is already localised — a 国服 or
 * 台服 item arrives with its Chinese name in place and the dictionary will not
 * have it, so that path falls through to `dialect` rather than to English.
 */
export function bilingual(en: string | null | undefined, fallback = ''): string {
  if (!en) return fallback
  const tr = translatedName(en)
  return tr ? `${t(tr.zh)} ${tr.en}` : dialect(en)
}

/**
 * Currency ids are the same everywhere ("exalted"), so the realm's own labels
 * are what a player recognises. Falls back to the raw id, which is still
 * readable when a realm runs out of a currency this pack predates.
 */
export function currencyName(id: string | null | undefined, labels: Record<string, string>): string {
  if (!id) return ''
  return labels[id] ?? id
}

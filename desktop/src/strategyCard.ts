/**
 * The strategy brief as text — the form that leaves the app.
 *
 * The card on screen is for the person looking at the app; a share travels through
 * chat apps, where the receiver sees prose first and can only act on it later. So
 * the same brief renders twice: as the on-screen card (StrategyCard.vue) and as
 * these few lines, which the share panel copies next to the code itself. Both come
 * from one brief so what the sharer sends and what the receiver's app regenerates
 * after importing cannot disagree.
 *
 * Everything authored here goes through t() (variant included), and every game
 * proper noun through zhName() — the dictionary covers the atlas names, and the
 * few it misses fall back to English rather than to an invented translation.
 */
import type { StrategyBiome, StrategyBrief, StrategyMechanic } from '@poe2coach/core'
import { t, zhName } from './i18n'
import { biomeLabel } from './mapData'

function biomeZh(keyword: string): string {
  const zh = biomeLabel(keyword)
  return zh ? t(zh) : keyword
}

function stars(rating: number | null): string {
  return rating == null ? '' : '★'.repeat(rating)
}

function mechanicLabel(m: StrategyMechanic): string {
  return m.id === 'main' ? t('主树') : t(m.label)
}

/** "裂隙 8/33 (显著 7/16)" — the numbers the atlas page shows, inline. */
function mechanicText(m: StrategyMechanic): string {
  return `${mechanicLabel(m)} ${m.allocated}/${m.total} (${t('显著')} ${m.notablesTaken}/${m.notablesTotal})`
}

/**
 * The headline the card leads with: the ranked mechanics, named plainly.
 *
 * Empty when nothing is allocated at all, and honest when the plan never left the
 * main tree — that state is "no mechanic picked", not a strategy to invent.
 */
export function strategyHeadline(brief: StrategyBrief): string {
  if (brief.allocatedCount === 0) return ''
  if (brief.mechanics.length === 0) return t('暂未指定刷图机制')
  const parts = [`${t('主刷')} ${t(brief.mechanics[0].label)}`]
  if (brief.mechanics[1]) parts.push(`${t('副刷')} ${t(brief.mechanics[1].label)}`)
  return parts.join(' · ')
}

/**
 * The card as lines of text. The empty string means "no plan to describe".
 *
 * `topAreas` caps the map list — chat apps reward short messages, so the text keeps
 * three candidates where the on-screen card shows five.
 */
export function strategyTextCard(brief: StrategyBrief, topAreas = 3): string {
  if (brief.allocatedCount === 0) return ''

  const lines: string[] = [t('【刷图策略】') + strategyHeadline(brief)]

  const mechParts = brief.mechanics.map(mechanicText)
  if (brief.main && brief.main.allocated > 0) mechParts.push(mechanicText(brief.main))
  if (mechParts.length) lines.push(`${t('机制')}: ${mechParts.join(' · ')}`)

  const biomeParts = brief.biomes.map((b: StrategyBiome) => {
    const areas = b.areas
      .slice(0, topAreas)
      .map((a) => `${zhName(a.name) ?? a.name}${stars(a.navigation)}`)
      .join(' · ')
    return `${biomeZh(b.keyword)} ${b.nodes}${t('节点')} → ${areas}`
  })
  if (biomeParts.length) lines.push(`${t('生态')}: ${biomeParts.join(' · ')}`)

  const keyParts = brief.keystones.map((k) => zhName(k.name) ?? k.name)
  if (keyParts.length) lines.push(`${t('关键')}: ${keyParts.join(' · ')}`)

  return lines.join('\n')
}

/**
 * Card and code as one copy-paste block.
 *
 * The code goes last on its own line, where a double-click selects it cleanly on
 * the receiving side; the line above says what to do with it, so the message
 * explains itself even before anyone imports anything.
 */
export function shareWithCard(text: string, code: string): string {
  return `${text}\n—— ${t('由异界点法自动推导;把下面的码粘进 PoE2 Build Coach 即可还原整份配置')}\n${code}`
}

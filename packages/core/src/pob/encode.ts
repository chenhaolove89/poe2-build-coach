import { encodeShareCode } from './decode.js'
import type { BuildSnapshot, ParsedItem, SkillGroup } from '../types.js'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Build a PoB-style XML document and encode it as a share code.
 * Only what parsePobCode reads back is emitted; this is the round-trip
 * fixture generator for tests (M0), and later a "re-share as code" feature.
 */
export function buildToShareCode(build: BuildSnapshot): string {
  const parts: string[] = []

  parts.push(
    `<Build level="${build.level ?? ''}" className="${esc(build.className ?? '')}" ascendClassName="${esc(build.ascendClassName ?? '')}" mainSocketGroup="1"/>`,
  )

  if (build.treeSpecUrls.length > 0 || build.passiveNodes.length > 0 || build.treeVersion) {
    const nodesAttr = build.passiveNodes.length > 0 ? ` nodes="${build.passiveNodes.join(',')}"` : ''
    const versionAttr = build.treeVersion ? ` treeVersion="${esc(build.treeVersion)}"` : ''
    const urls = build.treeSpecUrls
      .map((url) => `<Spec${nodesAttr}${versionAttr}><URL>${esc(url)}</URL></Spec>`)
      .join('')
    const specWithoutUrl =
      urls.length > 0 ? '' : `<Spec${nodesAttr}${versionAttr}/>`
    parts.push(`<Tree>${urls}${specWithoutUrl}</Tree>`)
  }

  if (build.skills.length > 0) {
    const groups = build.skills
      .map(
        (group: SkillGroup) =>
          `<Skill mainActiveSkill="${esc(group.label ?? '')}" label="${esc(group.label ?? '')}">` +
          group.gems
            .map(
              (g) =>
                `<Gem name="${esc(g.name)}" level="${g.level ?? 1}" quality="${g.quality ?? 0}" enabled="${g.enabled ? 'true' : 'false'}"/>`,
            )
            .join('') +
          `</Skill>`,
      )
      .join('')
    parts.push(`<Skills><SkillSet id="1" title="Default">${groups}</SkillSet></Skills>`)
  }

  if (build.items.length > 0) {
    const itemEls = build.items
      .map((item: ParsedItem) => `<Item id="${item.id}" itemClass="${esc(item.itemClass ?? '')}">${esc(item.text)}</Item>`)
      .join('')
    const slotEls = build.items
      .filter((i) => i.slot)
      .map((i) => `<Slot name="${esc(i.slot!)}" itemId="${i.id}"/>`)
      .join('')
    parts.push(`<Items>${itemEls}${slotEls}</Items>`)
  }

  return encodeShareCode(`<PathOfBuilding2>${parts.join('')}</PathOfBuilding2>`)
}

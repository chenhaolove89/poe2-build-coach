/**
 * Passive point accounting.
 *
 * The budget rules are not in the tree data — GGG's export carries nodes and
 * edges only — so they are stated here and sourced, because a cap that is
 * quietly wrong is worse than no cap:
 *
 *  - Main tree: 1 point per character level, so nothing at level 1 and 99 at
 *    level 100, plus 24 from the campaign's twelve Books of Specialisation
 *    (2 each). Those books are consumable quest items, not automatic, so the
 *    caller says how many were taken; 123 is the ceiling at level 100 with all
 *    twelve, not a guarantee.
 *  - Ascendancy: 8, from four trial completions of 2 points each.
 *  - Six ascendancy nodes grant main-tree points themselves — Oracle 2,
 *    Pathfinder 2 + 4 through its mutually exclusive Path choices. A flat 123
 *    would therefore reject legal Oracle and Pathfinder trees, so what the
 *    selection grants is added to the cap.
 *
 * Four kinds of node cost nothing: the class start, an ascendancy's start node,
 * `isFreeAllocate` nodes, and the options of a multiple-choice node. This is the
 * same set Path of Building's CountAllocNodes skips.
 */
import type { TreeNode, TreeData } from '../types.js'

/** Four trial completions of two points each. */
export const ASCENDANCY_POINT_CAP = 8

/** Twelve Books of Specialisation at two points each. */
export const QUEST_POINT_TOTAL = 24

/** Nodes that never cost a point. */
export function isFreeNode(node: TreeNode): boolean {
  return Boolean(
    node.isFreeAllocate || node.isMultipleChoiceOption || node.isAscendancyStart || node.classesStart?.length,
  )
}

/** "Grants 1 Passive Skill Point" / "Grants 4 Passive Skill Point". */
const GRANT_RE = /Grants (\d+) Passive Skill Points?/i

/** The direct grants on one node. */
function ownGrants(node: TreeNode): number {
  let total = 0
  for (const stat of node.stats ?? []) {
    const m = GRANT_RE.exec(stat)
    if (m) total += Number(m[1])
  }
  return total
}

/**
 * Options of each multiple-choice node, keyed by that node's id.
 *
 * The hub does not list its options in the tree data — `options` is absent — but
 * every option hangs off its hub by an edge, so the groups are recoverable from
 * the graph. Taking two options of one hub is not something the game allows, so
 * their grants must not be added up.
 */
export function exclusiveOptionGroups(
  tree: TreeData,
  edges: readonly (readonly [number, number])[],
): Map<number, number[]> {
  const groups = new Map<number, number[]>()
  const hubs = Object.values(tree.nodes).filter((n) => n.isMultipleChoice)
  if (hubs.length === 0) return groups
  const hubIds = new Set(hubs.map((h) => h.id))
  for (const [a, b] of edges) {
    const hub = hubIds.has(a) ? a : hubIds.has(b) ? b : null
    if (hub == null) continue
    const other = hub === a ? b : a
    if (!tree.nodes[other]?.isMultipleChoiceOption) continue
    const list = groups.get(hub)
    if (list) list.push(other)
    else groups.set(hub, [other])
  }
  return groups
}

/**
 * Main-tree points the selection hands back, from the nodes that grant them.
 *
 * A hub's options are mutually exclusive, so the group contributes its largest
 * option rather than their sum — otherwise Pathfinder, whose two Path choices
 * grant 4 each, would look like it hands back 10 instead of 6.
 */
export function grantedPoints(
  tree: TreeData,
  selected: readonly number[],
  edges: readonly (readonly [number, number])[],
): number {
  const chosen = new Set(selected)
  const groups = exclusiveOptionGroups(tree, edges)
  let granted = 0
  const counted = new Set<number>()
  for (const id of selected) {
    const node = tree.nodes[id]
    if (!node) continue
    const group = [...groups.entries()].find(([, options]) => options.includes(id))
    if (!group) {
      granted += ownGrants(node)
      continue
    }
    const [hub, options] = group
    if (counted.has(hub)) continue
    counted.add(hub)
    granted += Math.max(...options.filter((o) => chosen.has(o)).map((o) => ownGrants(tree.nodes[o])))
  }
  return granted
}

export interface PointBudget {
  /** Main-tree points spent. */
  mainUsed: number
  /** Ascendancy points spent. */
  ascendancyUsed: number
  /**
   * The main-tree ceiling, or null when the level is unknown — connectivity and
   * orphans can still be judged without it, but affordability cannot.
   */
  mainCap: number | null
  ascendancyCap: number
  /** What the selection itself grants, already included in `mainCap`. */
  granted: number
}

/**
 * Count a selection against its budget. Levels come from the build, quest
 * books from the caller (defaulting to all of them is what Path of Building
 * assumes, and what a finished character has).
 *
 * `edges` is the same graph the renderer and the connectivity check use; it is
 * needed to tell which nodes are options of the same multiple-choice hub.
 */
export function countPoints(
  tree: TreeData,
  selected: readonly number[],
  options: { level: number | null; questPoints?: number },
  edges: readonly (readonly [number, number])[],
): PointBudget {
  let mainUsed = 0
  let ascendancyUsed = 0
  for (const id of selected) {
    const node = tree.nodes[id]
    if (!node || isFreeNode(node)) continue
    if (node.ascendancyName) ascendancyUsed++
    else mainUsed++
  }

  const granted = grantedPoints(tree, selected, edges)
  const quests = options.questPoints ?? QUEST_POINT_TOTAL
  const mainCap =
    options.level == null
      ? null
      : Math.max(0, options.level - 1) + Math.max(0, Math.min(quests, QUEST_POINT_TOTAL)) + granted

  return { mainUsed, ascendancyUsed, mainCap, ascendancyCap: ASCENDANCY_POINT_CAP, granted }
}

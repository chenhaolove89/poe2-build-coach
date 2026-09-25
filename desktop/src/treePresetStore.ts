/**
 * Saved passive-tree selections, backed by localStorage.
 *
 * Separate from buildStore on purpose: a build preset is a whole PoB share code
 * (items, gems, level, tree), while this is a set of node lists plus the class
 * they belong to. Keeping the class is not optional — a node set means nothing
 * without the start node it was grown from, so a preset applied to a build of
 * another class would not validate.
 *
 * A preset holds *stages*, one per character level, because a tree is planned
 * for a level rather than for a character: the same build is a different set of
 * nodes at 30, at 60 and at 90. Each stage is a full node list rather than a
 * diff against the one before it, so a stage stays meaningful on its own and
 * the point budget can be checked against that level's ceiling.
 */

export interface TreeStage {
  level: number
  nodes: number[]
}

export interface StoredTreePreset {
  id: string
  name: string
  /** Class the selection was grown from; the start node comes from this. */
  className: string | null
  ascendClassName: string | null
  treeVersion: string | null
  /** Ordered by level, ascending. */
  stages: TreeStage[]
  savedAt: number
}

const KEY = 'poe2coach.treePresets.v1'

/** The single-node-list shape written before stages existed. */
interface LegacyPreset extends Omit<StoredTreePreset, 'stages'> {
  nodes?: number[]
}

function stagesOf(raw: StoredTreePreset | LegacyPreset): TreeStage[] {
  const preset = raw as StoredTreePreset
  if (Array.isArray(preset.stages)) {
    return preset.stages
      .filter((s) => s && Array.isArray(s.nodes))
      .map((s) => ({
        level: Number(s.level) || 1,
        nodes: s.nodes.map(Number).filter((n) => Number.isInteger(n) && n > 0),
      }))
      .sort((a, b) => a.level - b.level)
  }
  // Migration: one list, at whatever level the build happened to have.
  const legacy = raw as LegacyPreset
  const level = Number((legacy as unknown as { level?: number }).level) || 1
  return Array.isArray(legacy.nodes) ? [{ level, nodes: legacy.nodes.map(Number).filter((n) => Number.isInteger(n) && n > 0) }] : []
}

export function loadTreePresets(): StoredTreePreset[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as (StoredTreePreset | LegacyPreset)[]) : []
    if (!Array.isArray(list)) return []
    // A preset with no node list is meaningless, and one corrupted entry should
    // not take the whole library down with it.
    return list
      .filter((p) => p && typeof p.id === 'string')
      .map((p) => ({ ...(p as StoredTreePreset), stages: stagesOf(p) }))
      .filter((p) => p.stages.length > 0 || p.id)
  } catch {
    return []
  }
}

function persist(list: StoredTreePreset[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // Storage full or unavailable — the in-memory list still works for the session.
  }
}

export function addTreePreset(
  list: StoredTreePreset[],
  preset: Omit<StoredTreePreset, 'id' | 'savedAt'>,
): { list: StoredTreePreset[]; preset: StoredTreePreset } {
  let finalName = preset.name
  let n = 2
  while (list.some((p) => p.name === finalName)) {
    finalName = `${preset.name} (${n++})`
  }
  const entry: StoredTreePreset = {
    ...preset,
    name: finalName,
    stages: [...preset.stages].sort((a, b) => a.level - b.level),
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    savedAt: Date.now(),
  }
  const next = [entry, ...list]
  persist(next)
  return { list: next, preset: entry }
}

/**
 * Write `nodes` as the stage for `level`, replacing that level's stage if it
 * already exists. This is the one action behind both "add a level" and "update
 * this level", so the two cannot drift apart.
 */
export function upsertTreeStage(
  list: StoredTreePreset[],
  id: string,
  level: number,
  nodes: number[],
): StoredTreePreset[] {
  const next = list.map((p) =>
    p.id === id
      ? {
          ...p,
          savedAt: Date.now(),
          stages: [...p.stages.filter((s) => s.level !== level), { level, nodes }].sort((a, b) => a.level - b.level),
        }
      : p,
  )
  persist(next)
  return next
}

export function removeTreeStage(list: StoredTreePreset[], id: string, level: number): StoredTreePreset[] {
  const next = list
    .map((p) => (p.id === id ? { ...p, stages: p.stages.filter((s) => s.level !== level) } : p))
    .filter((p) => p.stages.length > 0)
  persist(next)
  return next
}

export function removeTreePreset(list: StoredTreePreset[], id: string): StoredTreePreset[] {
  const next = list.filter((p) => p.id !== id)
  persist(next)
  return next
}

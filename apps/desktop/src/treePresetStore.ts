/**
 * Saved passive-tree selections, backed by localStorage.
 *
 * Separate from buildStore on purpose: a build preset is a whole PoB share code
 * (items, gems, level, tree), while this is just a node set plus the class it
 * belongs to. Keeping the class is not optional — a node set means nothing
 * without the start node it was grown from, so a preset applied to a build of
 * another class would not validate.
 */

export interface StoredTreePreset {
  id: string
  name: string
  /** Class the selection was grown from; the start node comes from this. */
  className: string | null
  ascendClassName: string | null
  treeVersion: string | null
  nodes: number[]
  savedAt: number
}

const KEY = 'poe2coach.treePresets.v1'

export function loadTreePresets(): StoredTreePreset[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as StoredTreePreset[]) : []
    if (!Array.isArray(list)) return []
    // A preset without a node list is meaningless, and a corrupted entry should
    // not take the whole library down with it.
    return list.filter((p) => p && typeof p.id === 'string' && Array.isArray(p.nodes))
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
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    savedAt: Date.now(),
  }
  const next = [entry, ...list]
  persist(next)
  return { list: next, preset: entry }
}

export function removeTreePreset(list: StoredTreePreset[], id: string): StoredTreePreset[] {
  const next = list.filter((p) => p.id !== id)
  persist(next)
  return next
}

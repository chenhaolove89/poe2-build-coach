import type { ItemDiff, ItemMod, GameItem, ResistanceTotals } from '../types.js'
import { itemResistances, modResistances } from './resistance.js'

/**
 * Compare a candidate item against the item it would replace.
 * Mod lines are matched as multisets (identical text = identical mod), so
 * two lines of the same stat are handled correctly. Resistance swing is the
 * candidate minus the current.
 */
export function compareItems(current: GameItem, candidate: GameItem): ItemDiff {
  const currentCounts = countBy(current.mods)
  const candidateCounts = countBy(candidate.mods)

  const added: ItemMod[] = []
  const removed: ItemMod[] = []

  for (const [key, count] of candidateCounts) {
    const have = currentCounts.get(key) ?? 0
    for (let i = have; i < count; i++) {
      added.push({ text: key, kind: candidate.mods.find((m) => m.text === key)!.kind })
    }
  }
  for (const [key, count] of currentCounts) {
    const have = candidateCounts.get(key) ?? 0
    for (let i = have; i < count; i++) {
      removed.push({ text: key, kind: current.mods.find((m) => m.text === key)!.kind })
    }
  }

  const cur = itemResistances(current)
  const cand = itemResistances(candidate)
  const resistances: ResistanceTotals = {
    fire: cand.fire - cur.fire,
    cold: cand.cold - cur.cold,
    lightning: cand.lightning - cur.lightning,
    chaos: cand.chaos - cur.chaos,
  }

  return { added, removed, resistances }
}

function countBy(mods: ItemMod[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const m of mods) counts.set(m.text, (counts.get(m.text) ?? 0) + 1)
  return counts
}

/** Convenience: resistance swing contributed by a single mod line. */
export function modResistanceDelta(mod: ItemMod): ResistanceTotals {
  return modResistances(mod)
}

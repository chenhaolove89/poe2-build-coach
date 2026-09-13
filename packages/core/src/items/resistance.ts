import type { GameItem, ItemMod, ResistanceTotals } from '../types.js'

const RES_RE = /\+(\d+)%\s+to\s+([A-Za-z ]+?)\s+Resistances?/i
const ELEMENTS = ['fire', 'cold', 'lightning'] as const

/** Extract the elemental/chaos resistance contributions of one mod line. */
export function modResistances(mod: ItemMod): ResistanceTotals {
  const totals: ResistanceTotals = { fire: 0, cold: 0, lightning: 0, chaos: 0 }
  const m = mod.text.match(RES_RE)
  if (!m) return totals
  const amount = Number(m[1])
  const targets = m[2].toLowerCase()
  if (targets.includes('all elemental') || targets.includes('elemental')) {
    for (const el of ELEMENTS) totals[el] += amount
  }
  for (const el of ELEMENTS) {
    if (targets.includes(el)) totals[el] += amount
  }
  if (targets.includes('chaos')) totals.chaos += amount
  return totals
}

/** Sum resistances across an item (optionally only its visible mods). */
export function itemResistances(item: GameItem): ResistanceTotals {
  const totals: ResistanceTotals = { fire: 0, cold: 0, lightning: 0, chaos: 0 }
  for (const mod of item.mods) {
    const r = modResistances(mod)
    totals.fire += r.fire
    totals.cold += r.cold
    totals.lightning += r.lightning
    totals.chaos += r.chaos
  }
  return totals
}

export function sumResistances(items: GameItem[]): ResistanceTotals {
  const totals: ResistanceTotals = { fire: 0, cold: 0, lightning: 0, chaos: 0 }
  for (const item of items) {
    const r = itemResistances(item)
    totals.fire += r.fire
    totals.cold += r.cold
    totals.lightning += r.lightning
    totals.chaos += r.chaos
  }
  return totals
}

const DEFAULT_CAP = 75

/** How much resistance is missing to reach the cap (0 when capped/overcapped). */
export function resistanceGap(totals: ResistanceTotals, cap: number = DEFAULT_CAP): ResistanceTotals {
  return {
    fire: Math.max(0, cap - totals.fire),
    cold: Math.max(0, cap - totals.cold),
    lightning: Math.max(0, cap - totals.lightning),
    chaos: Math.max(0, cap - totals.chaos),
  }
}

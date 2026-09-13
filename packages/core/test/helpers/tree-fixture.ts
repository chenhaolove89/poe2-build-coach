import { readFileSync } from 'node:fs'
import type { TreeData } from '../../src/types.js'

let cached: TreeData | null = null

/** Load the real 0_5 tree for integration-style tests (cached). */
export function loadTreeFixture(): TreeData {
  if (cached) return cached
  const raw = JSON.parse(readFileSync(new URL('../../../data/trees/0_5/tree.json', import.meta.url), 'utf-8')) as any
  const nodes: Record<number, any> = {}
  for (const [key, node] of Object.entries(raw.nodes as Record<string, any>)) {
    nodes[Number(key)] = { id: Number(key), ...node }
  }
  cached = {
    version: '0_5',
    nodes,
    groups: raw.groups,
    constants: {
      PSSCentreInnerRadius: raw.constants?.PSSCentreInnerRadius,
      orbitRadii: raw.constants?.orbitRadii ?? [],
      orbitAnglesByOrbit: raw.constants?.orbitAnglesByOrbit ?? [],
      skillsPerOrbit: raw.constants?.skillsPerOrbit,
      classes: raw.constants?.classes ?? {},
      characterAttributes: raw.constants?.characterAttributes,
    },
    classes: (raw.classes ?? []).map((c: any) => ({
      id: c.id,
      name: c.name,
      internalId: c.internalId,
      ascendancies: (c.ascendancies ?? []).map((a: any) => ({ id: a.id, name: a.name, internalId: a.internalId })),
    })),
    bounds: { minX: raw.min_x, minY: raw.min_y, maxX: raw.max_x, maxY: raw.max_y },
  }
  return cached
}

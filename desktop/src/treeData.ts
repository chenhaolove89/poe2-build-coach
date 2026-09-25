import raw from '@poe2coach/data/trees/0_5/tree.json'
import type { TreeData } from '@poe2coach/core'

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Adapt PoB2 TreeData/<ver>/tree.json to our flattened TreeData view model. */
export function loadTree(version = '0_5'): TreeData {
  const j = raw as any
  // PoB2 tree.json keys nodes by id but omits the id field inside each node value.
  const nodes: Record<number, any> = {}
  for (const [key, node] of Object.entries(j.nodes as Record<string, any>)) {
    nodes[Number(key)] = { id: Number(key), ...node }
  }
  return {
    version,
    nodes,
    groups: j.groups,
    constants: {
      PSSCentreInnerRadius: j.constants?.PSSCentreInnerRadius,
      orbitRadii: j.constants?.orbitRadii ?? [],
      orbitAnglesByOrbit: j.constants?.orbitAnglesByOrbit ?? [],
      skillsPerOrbit: j.constants?.skillsPerOrbit,
      classes: j.constants?.classes ?? {},
      characterAttributes: j.constants?.characterAttributes,
    },
    classes: (j.classes ?? []).map((c: any) => ({
      id: c.id,
      name: c.name,
      internalId: c.internalId,
      ascendancies: (c.ascendancies ?? []).map((a: any) => ({ id: a.id, name: a.name, internalId: a.internalId })),
    })),
    bounds: { minX: j.min_x, minY: j.min_y, maxX: j.max_x, maxY: j.max_y },
  }
}

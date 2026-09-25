/**
 * The Atlas passive tree, read and typed in exactly one place.
 *
 * Same discipline as `mapData.ts`: the raw JSON is cast once here so a change to
 * the file's top-level shape is a compile error in one file rather than a runtime
 * `undefined` somewhere unrelated.
 *
 * The tree is 573 nodes with baked coordinates; the index and the adjacency it
 * carries are built once at module load, since both the canvas and the planner
 * walk them on every interaction.
 */
import atlasJson from '@poe2coach/data/atlas.json'
import { buildAtlasIndex, type AtlasIndex, type AtlasTree } from '@poe2coach/core'

export const ATLAS = atlasJson as unknown as AtlasTree

/** Hash -> node, plus the undirected adjacency the planner walks. */
export const ATLAS_INDEX: AtlasIndex = buildAtlasIndex(ATLAS)

/** How many nodes a point can actually go into (mastery slots are not allocatable). */
export const ALLOCATABLE_COUNT = ATLAS.nodes.filter((n) => n.kind !== 'mastery').length

export const ATLAS_SOURCE = ATLAS.source
export const ATLAS_CAPTURED = ATLAS.captured

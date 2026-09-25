/**
 * A request for the map page to open filtered to a biome.
 *
 * The mirror of `atlasFocus`: the atlas tree can say "the Mountain nodes are these",
 * and the natural next question is "which maps are Mountain". Both pages filter by
 * the same axis, so the biome is the one thing worth carrying between them.
 */
import { ref } from 'vue'

/** A map-table biome name, or an atlas keyword like `City` that folds onto several. */
export const mapFocus = ref<string | null>(null)

export function requestMapFocus(biome: string): void {
  mapFocus.value = biome
}

/**
 * An area-code request for the map page to open that area's detail overlay —
 * the farm page's per-map table pointing the other way: "which map was this
 * row" is the natural next question about a measurement.
 */
export const mapDetailRequest = ref<string | null>(null)

export function requestMapDetail(code: string): void {
  mapDetailRequest.value = code
}

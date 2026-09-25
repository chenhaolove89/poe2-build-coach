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

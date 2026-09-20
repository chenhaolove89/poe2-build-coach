/**
 * A request for the Atlas page to open focused on something.
 *
 * The map page knows which biome the reader is looking at, and the biome is the one
 * thing that joins the two pages: the atlas tree's own effects say "in Mountain
 * Areas", so "which atlas nodes help the maps I run" has a real answer. Passing it
 * through a module ref rather than a router keeps the pages independent — the atlas
 * page is equally usable opened from the nav with nothing focused.
 */
import { ref } from 'vue'

export interface AtlasFocusRequest {
  /** A map-table biome name, folded to the tree's wording by `atlasBiomeKey`. */
  biome?: string
  /** A subtree id, e.g. `Breach`. */
  subtree?: string
}

export const atlasFocus = ref<AtlasFocusRequest | null>(null)

export function requestAtlasFocus(request: AtlasFocusRequest): void {
  atlasFocus.value = request
}

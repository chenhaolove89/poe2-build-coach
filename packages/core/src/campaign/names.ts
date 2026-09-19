/**
 * Resolving a log's area name to a campaign zone.
 *
 * The campaign guide follows the player by reading the names the client logs on
 * every area transition (`[SCENE] Set Source [名]`, and as a fallback
 * `[LOADING SCREEN] (名)`). Matching happens against a caller-supplied index of
 * every name every zone is known by — Simplified, Traditional and English all
 * go in, because which of them the client writes depends on the realm while
 * this matcher does not care: the scripts share no characters, so a name can
 * only ever collide with another zone's name in its own script, and that case
 * is resolved by position (see `resolveCampaignZone`).
 *
 * Area *codes* (`Generating level N area "MapDeforestation"`) are deliberately
 * not part of this: they are an internal naming scheme with no relation to the
 * display names the campaign data carries.
 */

/** Where a zone sits, enough to move a pointer and to score a candidate. */
export interface CampaignZoneRef {
  /** The zone key used by the guide's storage, `actId:zoneEn`. */
  key: string
  /** The act id, e.g. `act1`. */
  act: string
  /** The zone's index within its act. */
  index: number
  /** The zone's position across the whole campaign, acts in order. */
  order: number
}

/** One name one zone is known by, as fed into `campaignNameIndex`. */
export interface CampaignNameEntry {
  ref: CampaignZoneRef
  name: string
}

/** Lower-cased name → the zones that answer to it. */
export type CampaignNameIndex = ReadonlyMap<string, CampaignZoneRef[]>

/**
 * Build the lookup index. Names are trimmed and lower-cased — the log's
 * spellings are trusted to be exact, so no other folding is attempted.
 */
export function campaignNameIndex(entries: readonly CampaignNameEntry[]): CampaignNameIndex {
  const index = new Map<string, CampaignZoneRef[]>()
  for (const { ref, name } of entries) {
    const key = name.trim().toLowerCase()
    if (!key) continue
    const list = index.get(key)
    if (list) {
      if (!list.some((r) => r.key === ref.key)) list.push(ref)
    } else {
      index.set(key, [ref])
    }
  }
  return index
}

/**
 * The name forms a log line may present. `藏身处：海岸` and `城镇：王镇` prefix
 * the area kind, which campaign zone names never carry, so the part after the
 * last full-width or ASCII colon is tried alongside the name as-is.
 */
export function areaNameCandidates(raw: string): string[] {
  const name = raw.trim()
  const cut = Math.max(name.lastIndexOf('：'), name.lastIndexOf(':'))
  if (cut === -1) return [name]
  const suffix = name.slice(cut + 1).trim()
  return suffix ? [name, suffix] : [name]
}

/**
 * Resolve one logged area name to a zone.
 *
 * With no current position (`null`), an ambiguous name resolves to nothing —
 * guessing into a fresh guide would point it at the wrong act. With a position,
 * ties break towards the nearest candidate in play order, and a forward
 * candidate beats a backward one at the same distance: returning through a
 * zone's own entrance re-logs its name, and that must not drag the pointer
 * backwards past a same-named zone ahead. A unique match is followed either
 * way, because the pointer is meant to mirror where the player actually is.
 *
 * Unresolvable names (boss arenas, maps, hideouts, the endgame at large)
 * return `null`; the caller leaves the pointer alone, which is the safe
 * outcome for every part of the game the guide does not cover.
 */
export function resolveCampaignZone(
  index: CampaignNameIndex,
  rawName: string,
  current: CampaignZoneRef | null,
): CampaignZoneRef | null {
  let found: CampaignZoneRef[] | null = null
  for (const candidate of areaNameCandidates(rawName)) {
    const list = index.get(candidate.trim().toLowerCase())
    if (list && list.length > 0) {
      found = list
      if (list.length === 1) return list[0]
    }
  }
  if (!found) return null
  if (!current) return null
  let best = found[0]
  let bestSteps = best.order - current.order
  for (const ref of found.slice(1)) {
    const steps = ref.order - current.order
    const better =
      Math.abs(steps) < Math.abs(bestSteps) ||
      (Math.abs(steps) === Math.abs(bestSteps) && steps >= 0 && bestSteps < 0)
    if (better) {
      best = ref
      bestSteps = steps
    }
  }
  return best
}

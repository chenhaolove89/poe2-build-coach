/**
 * A rolled item line and its trade-site template describe the same affix, so
 * both get reduced to the same skeleton before they are compared:
 *
 *   "+129 to maximum Life"        -> "# to maximum life"
 *   "# to maximum Life" (official)-> "# to maximum life"
 *
 * Keep this identical to scripts/fetch-trade-data.mjs, which runs it over the
 * official index at build time.
 */
export function skeleton(text: string): string {
  return text
    .replace(/[-+]?\d+(?:\.\d+)?/g, '#')
    .replace(/%/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Rolled numbers in order, so "Adds 10 to 20" yields [10, 20]. */
export function modValues(text: string): number[] {
  const values: number[] = []
  for (const match of text.matchAll(/[-+]?\d+(?:\.\d+)?/g)) values.push(Number(match[0]))
  return values
}

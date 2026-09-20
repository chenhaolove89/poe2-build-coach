/**
 * The Atlas plan, as shared state rather than a page's private ref.
 *
 * It started inside the atlas page, which was fine while the page was the only
 * thing that read it. The share code reads it too, and an import has to be able to
 * write it, so the plan lives here and the page is one of its consumers.
 */
import { ref, watch } from 'vue'

const KEY = 'poe2coach.atlas.allocated'

function load(): Set<number> {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as number[]) : []
    return new Set(list.filter((h) => Number.isInteger(h) && h > 0))
  } catch {
    return new Set()
  }
}

export const allocated = ref<Set<number>>(load())

watch(
  allocated,
  (value) => {
    try {
      localStorage.setItem(KEY, JSON.stringify([...value]))
    } catch {
      /* storage off — the plan just does not persist */
    }
  },
  { deep: false },
)

export function setAllocated(hashes: Iterable<number>): void {
  allocated.value = new Set(hashes)
}

export function clearAllocated(): void {
  allocated.value = new Set()
}

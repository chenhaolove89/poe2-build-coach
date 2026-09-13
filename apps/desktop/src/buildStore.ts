/** Local build library backed by localStorage (works in the webview and in a plain browser). */

export interface StoredBuild {
  id: string
  name: string
  code: string
  savedAt: number
}

const KEY = 'poe2coach.builds.v1'

export function loadBuilds(): StoredBuild[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as StoredBuild[]) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function persist(list: StoredBuild[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // Storage full or unavailable — the in-memory list still works for the session.
  }
}

export function persistBuilds(list: StoredBuild[]) {
  persist(list)
}

export function addBuild(list: StoredBuild[], name: string, code: string): { list: StoredBuild[]; build: StoredBuild } {
  let finalName = name
  let n = 2
  while (list.some((b) => b.name === finalName)) {
    finalName = `${name} (${n++})`
  }
  const build: StoredBuild = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: finalName,
    code,
    savedAt: Date.now(),
  }
  const next = [build, ...list]
  persist(next)
  return { list: next, build }
}

export function removeBuild(list: StoredBuild[], id: string): StoredBuild[] {
  const next = list.filter((b) => b.id !== id)
  persist(next)
  return next
}

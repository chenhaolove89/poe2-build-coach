/**
 * Tree data pipeline: detect new PoB2 TreeData versions and pull them into
 * packages/data/trees/<version>/tree.json. Idempotent — exits 0 when we are
 * already on the latest version. Run by .github/workflows/data-pipeline.yml
 * (weekly cron + manual dispatch), or locally: `node scripts/update-tree-data.mjs`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const TREES_DIR = `${ROOT}packages/data/trees`
const INDEX_FILE = `${TREES_DIR}/index.json`
const UPSTREAM = 'PathOfBuildingCommunity/PathOfBuilding-PoE2'
const BRANCH = 'dev'
const SKIP_DIRS = new Set(['legion'])

function versionKey(name) {
  return name.split(/[._]/).map((s) => Number(s) || 0)
}

function compareVersions(a, b) {
  const ka = versionKey(a)
  const kb = versionKey(b)
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const d = (ka[i] ?? 0) - (kb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

async function githubJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'poe2-build-coach-data-pipeline' } })
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`)
  return res.json()
}

const entries = await githubJson(`https://api.github.com/repos/${UPSTREAM}/contents/src/TreeData?ref=${BRANCH}`)
const versions = entries
  .filter((e) => e.type === 'dir' && !SKIP_DIRS.has(e.name))
  .map((e) => e.name)
  .sort(compareVersions)

if (versions.length === 0) throw new Error('No TreeData version directories found upstream')
const latest = versions.at(-1)
console.log('upstream versions:', versions.join(', '), '| latest:', latest)

const index = JSON.parse(readFileSync(INDEX_FILE, 'utf-8'))
if (index.versions.includes(latest)) {
  console.log(`already have ${latest}; nothing to do`)
  process.exit(0)
}

const rawUrl = `https://raw.githubusercontent.com/${UPSTREAM}/${BRANCH}/src/TreeData/${latest}/tree.json`
console.log('downloading', rawUrl)
const res = await fetch(rawUrl, { headers: { 'User-Agent': 'poe2-build-coach-data-pipeline' } })
if (!res.ok) throw new Error(`GET ${rawUrl} -> ${res.status}`)
const body = Buffer.from(await res.arrayBuffer())
if (body.length < 100_000) throw new Error(`tree.json suspiciously small (${body.length} bytes)`)

const dir = `${TREES_DIR}/${latest}`
mkdirSync(dir, { recursive: true })
writeFileSync(`${dir}/tree.json`, body)
console.log(`wrote ${dir}/tree.json (${(body.length / 1e6).toFixed(1)} MB)`)

index.versions = [...index.versions, latest].sort(compareVersions)
index.latest = latest
writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2) + '\n')
console.log('updated index.json:', JSON.stringify(index.versions), 'latest =', latest)

if (!existsSync(`${ROOT}apps/desktop/src/treeData.ts`)) throw new Error('treeData.ts missing')
console.log(
  '\nNOTE: register the new version in apps/desktop/src/treeData.ts (TREES map) so the\n' +
    'desktop app can load it; builds without treeVersion fall back to the latest entry.',
)

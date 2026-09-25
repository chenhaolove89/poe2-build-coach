#!/usr/bin/env node
/**
 * Pack the share server for deployment.
 *
 * `next build` with output:'standalone' emits a self-contained server, but the
 * shape depends on the project layout: under this npm-workspace monorepo, Next
 * 15 mirrors the project's path relative to the lockfile root, so the entry
 * lands at `.next/standalone/server/server.js` with the hoisted node_modules one
 * level up. Two things also need hand-copies Next does not bundle: the client
 * static assets (.next/static) and the service unit. This script flattens all of
 * it into the classic layout so what reaches the host is "untar, run node
 * server.js":
 *
 *   share-server/
 *     server.js               standalone entry (needs Node 22+ for node:sqlite)
 *     .next/static/...        client assets
 *     .next/server/...        compiled server
 *     node_modules/           pruned, hoisted dependencies
 *     poe2coach-share.service systemd unit
 *
 * Usage: node server/deploy/pack.mjs   (from anywhere; builds first)
 */
import { execSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const serverDir = path.join(root, 'server')
const dist = path.join(serverDir, 'deploy', 'dist')
const out = path.join(dist, 'share-server')

console.log('[1/3] next build (standalone)…')
execSync('npx next build', { cwd: serverDir, stdio: 'inherit' })

const standalone = path.join(serverDir, '.next', 'standalone')
// The entry mirrors the project path under the monorepo; either shape is accepted
// so a future "extract the server into its own repo" does not silently break this.
const nestedEntry = path.join(standalone, 'server', 'server.js')
const flatEntry = path.join(standalone, 'server.js')
if (!existsSync(nestedEntry) && !existsSync(flatEntry)) {
  throw new Error('standalone server.js not found — did output:"standalone" survive in next.config.mjs?')
}

console.log('[2/3] assembling deployment tree…')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync(standalone, out, { recursive: true })
if (existsSync(nestedEntry)) {
  // Next 16 nests next/@next/@swc inside <project>/node_modules, one level below
  // the hoisted react tree — so flattening must MERGE the two node_modules, not
  // just move the entry files, or the flattened root cannot resolve next at all.
  const nestedDir = path.join(out, 'server')
  for (const name of existsSync(path.join(nestedDir, '.next')) ? ['.next', 'server.js', 'package.json'] : []) {
    rmSync(path.join(out, name), { recursive: true, force: true })
    renameSync(path.join(nestedDir, name), path.join(out, name))
  }
  cpSync(path.join(nestedDir, 'node_modules'), path.join(out, 'node_modules'), { recursive: true })
  rmSync(nestedDir, { recursive: true, force: true })
}
// Client assets live outside the standalone output; the runtime resolves them here.
cpSync(path.join(serverDir, '.next', 'static'), path.join(out, '.next', 'static'), { recursive: true })
// A local test run's sqlite file must never ride along to production.
rmSync(path.join(out, 'data'), { recursive: true, force: true })
// The service unit rides along so the host install step has it at hand.
cpSync(path.join(serverDir, 'deploy', 'poe2coach-share.service'), path.join(out, 'poe2coach-share.service'))

if (!existsSync(path.join(out, 'server.js'))) throw new Error('flattening failed — no server.js at the package root')

console.log('[3/3] tar…')
rmSync(path.join(dist, 'share-server.tar.gz'), { force: true })
execSync(`tar -czf share-server.tar.gz -C "${dist}" share-server`, { cwd: dist, stdio: 'inherit' })

console.log(`\nDone: ${path.join(dist, 'share-server.tar.gz')}`)
console.log('Next: fill in deploy.sh (HOST/USER/KEY), then run it — see docs/share-server.md.')

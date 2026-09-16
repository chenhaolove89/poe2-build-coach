<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { translateStat } from '@poe2coach/core'
import type { TreeData, TreeNode } from '@poe2coach/core'
import statTranslationJson from '@poe2coach/data/stat-translations.json'
import { dialect, t, zhName } from '../i18n'
import { loadTreeArt, TREE_GEOMETRY } from '../treeArt'
import type { Rect, TreeArt } from '../treeArt'

const STAT_TRANSLATIONS = statTranslationJson as unknown as Parameters<typeof translateStat>[1]

/** Tree stats are English in the data packs, so the dictionary always answers. */
function statZh(s: string): string | null {
  const zh = translateStat(s, STAT_TRANSLATIONS)
  return zh ? t(zh) : null
}

const props = defineProps<{
  tree: TreeData
  active: Set<number>
  /** Allocated-so-far subset of `active` (leveling progress) — drawn bright. */
  progress?: Set<number>
  /** Turns a node click into a `toggleNode` event. Off means the tree is read-only. */
  editable?: boolean
  /**
   * Ascendancy whose cluster is shown in the middle of the main tree. PoE2
   * parks each ascendancy tree far outside the main one (~17000 units out), so
   * at any usable zoom it is simply off screen; the main tree is an annulus
   * with an empty centre, which is where the cluster belongs.
   */
  ascendancy?: string | null
}>()

const emit = defineEmits<{ toggleNode: [id: number] }>()

const canvasEl = ref<HTMLCanvasElement | null>(null)
const wrapEl = ref<HTMLDivElement | null>(null)
const hover = ref<{ x: number; y: number; node: TreeNode } | null>(null)
/** False until the atlases decode; drawing before that would paint nothing. */
const artReady = ref(false)

interface Pt {
  x: number
  y: number
}

interface Cluster {
  centroid: Pt
  /** Distance from the centroid to the cluster's furthest node. */
  radius: number
}

let art: TreeArt | null = null
let positions = new Map<number, Pt>()
let edges: [number, number][] = []
let bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 }

/** Centre of the main tree, and how far its innermost node sits from it. */
let mainCentre: Pt = { x: 0, y: 0 }
let holeRadius = 0
/** Ascendancy name -> where its cluster sits in the raw data. */
let clusters = new Map<string, Cluster>()
/** Uniform scale applied to the relocated cluster, so it fits the hole. */
let ascScale = 1
/** Offset-less: the relocated cluster is placed by reprojecting about its centroid. */
let placedCluster: Cluster | null = null

let scale = 0.03
let panX = 0
let panY = 0
let dragging = false
let lastMouse: Pt | null = null
/** Where the current press started, to tell a click from a pan. */
let downPos: Pt | null = null
let raf = 0
let resizeObs: ResizeObserver | null = null

const hoverHtml = computed(() => {
  const h = hover.value
  if (!h) return ''
  const kind = t(
    h.node.isKeystone
      ? '核心天赋 Keystone'
      : h.node.isNotable
        ? '显著天赋 Notable'
        : h.node.ascendancyName
          ? '升华天赋 Ascendancy'
          : '普通天赋 Passive',
  )
  const activeMark = props.active.has(h.node.id) ? ` · <b style="color:#e8b04b">${t('已规划')}</b>` : ''
  const stats = h.node.stats
    .slice(0, 5)
    .map((s) => {
      const zh = statZh(s)
      return zh
        ? `<div><b>${escapeHtml(zh)}</b><span class="en-stat">${escapeHtml(s)}</span></div>`
        : `<div>${escapeHtml(s)}</div>`
    })
    .join('')
  const more =
    h.node.stats.length > 5 ? `<div class="en-stat">…${t('还有')} ${h.node.stats.length - 5} ${t('条')}</div>` : ''
  const nameZhText = zhName(h.node.name)
  const nameHtml = nameZhText
    ? `<b>${escapeHtml(nameZhText)}</b><span class="en-stat">${escapeHtml(dialect(h.node.name))}</span>`
    : `<b>${escapeHtml(dialect(h.node.name))}</b>`
  return `${nameHtml} <span style="color:#7a8299">(${kind})</span>${activeMark}${stats}${more}`
})

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Find the main tree's empty centre and where each ascendancy cluster sits.
 *
 * The main tree is an annulus — its innermost node is ~1300 units from the
 * bounds centre — so `holeRadius` is the room available for a relocated
 * ascendancy cluster. Runs once: it depends only on the shipped data.
 */
function analyseGeometry() {
  const clustersByName = new Map<string, Pt[]>()
  const main: Pt[] = []
  for (const [id, xy] of Object.entries(TREE_GEOMETRY.positions)) {
    const node = props.tree.nodes[Number(id)]
    if (!node) continue
    const point = { x: xy[0], y: xy[1] }
    if (node.ascendancyName) {
      const list = clustersByName.get(node.ascendancyName)
      if (list) list.push(point)
      else clustersByName.set(node.ascendancyName, [point])
    } else {
      main.push(point)
    }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of main) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  mainCentre = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
  holeRadius = main.reduce((best, p) => Math.min(best, Math.hypot(p.x - mainCentre.x, p.y - mainCentre.y)), Infinity)

  clusters = new Map()
  for (const [name, points] of clustersByName) {
    const centroid = {
      x: points.reduce((s, p) => s + p.x, 0) / points.length,
      y: points.reduce((s, p) => s + p.y, 0) / points.length,
    }
    const radius = points.reduce((best, p) => Math.max(best, Math.hypot(p.x - centroid.x, p.y - centroid.y)), 0)
    clusters.set(name, { centroid, radius })
  }
}

/**
 * Coordinates come from the trade-independent tree export rather than from the
 * orbited-group maths in core, because the artwork is authored in that same
 * space: the frames are sized so a node's ring lands on its neighbours, and the
 * two spaces are not related by a simple scale (the same group sits at
 * -15304.9,-7077.3 in core's derivation and -22597.4,-2727.5 officially).
 *
 * Nothing outside painting reads these. `buildLevelingPlan` walks the
 * connection graph, and `resolveStartNode` reads `classesStart`, so both are
 * unaffected by which coordinate space the renderer uses.
 *
 * The selected ascendancy's cluster is reprojected to the main tree's centre
 * and scaled to fit the hole. Scaling positions *and* the node sizes together
 * is what keeps that safe: a uniform scale preserves the spacing-to-frame ratio
 * inside the cluster, so nothing starts overlapping. 13 of the 22 clusters are
 * bigger than the hole as shipped, which is why scaling is needed at all.
 */
function rebuildGeometry() {
  const wanted = props.ascendancy ? clusters.get(props.ascendancy) ?? null : null
  placedCluster = wanted
  ascScale = 1
  if (wanted && wanted.radius > 0 && Number.isFinite(holeRadius)) {
    ascScale = Math.min(1, (holeRadius * 0.92) / wanted.radius)
  }

  positions = new Map()
  const inBounds = new Set<number>()
  for (const [id, xy] of Object.entries(TREE_GEOMETRY.positions)) {
    const nodeId = Number(id)
    const node = props.tree.nodes[nodeId]
    if (!node) continue
    let point = { x: xy[0], y: xy[1] }
    if (node.ascendancyName && wanted && node.ascendancyName === props.ascendancy) {
      point = {
        x: mainCentre.x + (point.x - wanted.centroid.x) * ascScale,
        y: mainCentre.y + (point.y - wanted.centroid.y) * ascScale,
      }
      inBounds.add(nodeId)
    } else if (!node.ascendancyName) {
      inBounds.add(nodeId)
    }
    positions.set(nodeId, point)
  }

  edges = []
  for (const [a, b] of TREE_GEOMETRY.edges) {
    const from = Number(a)
    const to = Number(b)
    if (positions.has(from) && positions.has(to)) edges.push([from, to])
  }

  // Frame the main tree plus the relocated cluster. Every other ascendancy
  // cluster stays parked ~17000 units out, and letting those into the bounds is
  // what used to shrink the tree to half the canvas.
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const id of inBounds) {
    const p = positions.get(id)!
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  bounds = Number.isFinite(minX) ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 1, maxY: 1 }
}

/**
 * Target nodes adjacent to the allocated set: what the player should take next.
 * Recomputed when the progress or the build changes, not per frame — there are
 * ~6000 edges.
 */
const nextUp = computed(() => {
  const progress = new Set([...(props.progress ?? [])])
  const out = new Set<number>()
  if (progress.size === 0) return out
  for (const [a, b] of edges) {
    if (progress.has(a) && !progress.has(b) && props.active.has(b)) out.add(b)
    else if (progress.has(b) && !progress.has(a) && props.active.has(a)) out.add(a)
  }
  return out
})

type NodeState = 'allocated' | 'canAllocate' | 'planned' | 'unallocated'

/** Which frame family a node uses: ascendancy art differs from the main tree. */
function frameKind(node: TreeNode, kind: string): string {
  if (!node.ascendancyName) return kind
  return node.isNotable ? 'ascendancyNotable' : 'ascendancyNormal'
}

/**
 * Four visual states, because the tree answers two different questions: which
 * nodes this build wants (`active`), and which of them are already taken
 * (`progress`). Frames only ship unallocated / canAllocate / allocated, so
 * both "next up" and "wanted later" wear the highlighted frame and are told
 * apart by the glow.
 */
function stateOf(node: TreeNode): NodeState {
  if (props.progress?.has(node.id)) return 'allocated'
  if (props.active.has(node.id)) return nextUp.value.has(node.id) ? 'canAllocate' : 'planned'
  return 'unallocated'
}

/** The frame a state draws with; planned reuses the highlighted rim. */
function frameState(state: NodeState): 'unallocated' | 'canAllocate' | 'allocated' {
  if (state === 'allocated') return 'allocated'
  if (state === 'unallocated') return 'unallocated'
  return 'canAllocate'
}

function fitToContent() {
  const canvas = canvasEl.value
  if (!canvas) return
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  const pad = 200
  scale = Math.min(w / (bounds.maxX - bounds.minX + pad * 2), h / (bounds.maxY - bounds.minY + pad * 2))
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  panX = w / 2 - cx * scale
  panY = h / 2 - cy * scale
}

/** blit one atlas rect centred on a point, in tree units. */
function blit(ctx: CanvasRenderingContext2D, imageName: string, rect: Rect | null | undefined, x: number, y: number, size: number) {
  if (!rect || !art) return
  const image = art.images[imageName]
  if (!image) return
  const half = size / 2
  ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h, x - half, y - half, size, size)
}

function draw() {
  const canvas = canvasEl.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr
    canvas.height = h * dpr
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#080a0f'
  ctx.fillRect(0, 0, w, h)

  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * panX, dpr * panY)

  const progress = props.progress ?? new Set<number>()
  const index = art?.index

  // Viewport in world units, so both layers can skip what is off screen.
  const viewMinX = -panX / scale
  const viewMinY = -panY / scale
  const viewMaxX = (w - panX) / scale
  const viewMaxY = (h - panY) / scale

  // ---- connections -------------------------------------------------------
  // The connector art is a long uniform band, so stretching it over an
  // arbitrary span keeps its look; the rings the atlas also ships are arc
  // segments whose placement convention is not documented, so they are unused.
  const connector = index?.lines.LineConnectorNormal
  const connectorActive = index?.lines.LineConnectorActive
  const connectorThick = connector && index ? connector.h / index.atlases.line.scale : 0
  const lineImage = art?.images.line
  if (lineImage && connector && connectorActive && index) {
    for (const [a, b] of edges) {
      const pa = positions.get(a)!
      const pb = positions.get(b)!
      if (
        (pa.x < viewMinX && pb.x < viewMinX) ||
        (pa.x > viewMaxX && pb.x > viewMaxX) ||
        (pa.y < viewMinY && pb.y < viewMinY) ||
        (pa.y > viewMaxY && pb.y > viewMaxY)
      )
        continue
      const dx = pb.x - pa.x
      const dy = pb.y - pa.y
      const len = Math.hypot(dx, dy)
      if (len < 1) continue
      const onPath = progress.has(a) && progress.has(b)
      const rect = onPath ? connectorActive : connector
      ctx.save()
      ctx.translate(pa.x, pa.y)
      ctx.rotate(Math.atan2(dy, dx))
      ctx.drawImage(lineImage, rect.x, rect.y, rect.w, rect.h, 0, -connectorThick / 2, len, connectorThick)
      ctx.restore()
    }
  } else {
    ctx.strokeStyle = 'rgba(122,136,176,0.7)'
    ctx.lineWidth = 1 / scale
    for (const [a, b] of edges) {
      const pa = positions.get(a)!
      const pb = positions.get(b)!
      ctx.beginPath()
      ctx.moveTo(pa.x, pa.y)
      ctx.lineTo(pb.x, pb.y)
      ctx.stroke()
    }
  }

  // ---- nodes -------------------------------------------------------------
  // Small kinds first so a keystone's larger frame overlaps its neighbours the
  // way it does in the client.
  const ordered = Object.values(props.tree.nodes)
    .map((node) => ({ node, pos: positions.get(node.id) }))
    .filter((e): e is { node: TreeNode; pos: Pt } => !!e.pos)
    .sort((a, b) => rank(a.node) - rank(b.node))
  function rank(node: TreeNode) {
    if (node.isKeystone) return 2
    if (node.isNotable) return 1
    return 0
  }

  for (const { node, pos } of ordered) {
    // Only the selected ascendancy is shown. The other 21 belong to classes
    // this character does not have, and they sit ~17000 units out, so drawing
    // them just leaves stray clusters around the edges.
    if (node.ascendancyName && node.ascendancyName !== props.ascendancy) continue

    const kind = node.isKeystone ? 'keystone' : node.isNotable ? 'notable' : 'normal'
    // A relocated ascendancy cluster is drawn at its own scale, so its frames
    // stay proportional to the spacing the reprojection gave them.
    const shrink = placedCluster && node.ascendancyName === props.ascendancy ? ascScale : 1
    const drawSize = (index?.draw[kind] ?? 40) * shrink
    const half = drawSize / 2
    if (pos.x + half < viewMinX || pos.x - half > viewMaxX || pos.y + half < viewMinY || pos.y - half > viewMaxY)
      continue

    // Zoomed far out the art is a few pixels wide and 5000 nodes of drawImage
    // is what makes panning stutter, so fall back to a single dot.
    if (drawSize * scale < 5) {
      const planned = props.active.has(node.id)
      const taken = progress.has(node.id)
      ctx.fillStyle = taken
        ? '#f0ba58'
        : planned
          ? '#8a6f35'
          : node.isKeystone
            ? '#b0524e'
            : node.isNotable
              ? '#6f7fb5'
              : node.ascendancyName
                ? '#4a5270'
                : '#39415a'
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, (node.isKeystone ? 4.5 : node.isNotable ? 3.4 : 2.6) / scale, 0, Math.PI * 2)
      ctx.fill()
      continue
    }

    const state = stateOf(node)
    const kindName = frameKind(node, kind)
    const shape = frameState(state)
    const frameRect = index?.frames[`${kindName}.${shape}`]
    const frameSize = (index?.drawFrame[`${kindName}.${shape}`] ?? drawSize * 1.5) * shrink
    if (state === 'allocated') {
      ctx.shadowColor = 'rgba(240,186,88,0.55)'
      ctx.shadowBlur = 10 / scale
    } else if (state === 'canAllocate') {
      // The immediate next step, so it reads even among the planned nodes.
      ctx.shadowColor = 'rgba(240,186,88,0.85)'
      ctx.shadowBlur = 16 / scale
    }
    blit(ctx, 'frame', frameRect, pos.x, pos.y, frameSize)
    ctx.shadowBlur = 0

    // The atlas only ships three frames and the highlighted one is a subtle
    // rim, which is not enough to pick a build's target nodes out of ~4900.
    // Draw an explicit ring on top of it.
    if (state === 'planned' || state === 'canAllocate') {
      const next = state === 'canAllocate'
      ctx.strokeStyle = next ? 'rgba(255,214,120,0.95)' : 'rgba(226,172,72,0.8)'
      ctx.lineWidth = (next ? 3.5 : 2.5) / scale
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, (frameSize / 2) * 0.94, 0, Math.PI * 2)
      ctx.stroke()
    }

    const entry = index?.nodes[node.icon ?? '']?.[kind]
    const iconRect = state === 'allocated' ? entry?.allocated : entry?.unallocated
    // Mastery nodes have no entry in this build's atlas, so they keep the bare
    // frame rather than a hole.
    blit(ctx, state === 'allocated' ? 'skills' : 'skills-disabled', iconRect, pos.x, pos.y, drawSize)
  }
}

function scheduleDraw() {
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(draw)
}

function screenPos(e: MouseEvent): Pt {
  const rect = canvasEl.value!.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function toWorld(p: Pt): Pt {
  return { x: (p.x - panX) / scale, y: (p.y - panY) / scale }
}

/**
 * Nodes bucketed into a world-space grid, so hovering tests the handful of
 * candidates near the cursor instead of all ~4900 nodes. 400 units per cell is
 * roughly two node spacings, so a cell holds a handful of entries.
 */
const CELL = 400
let grid = new Map<string, number[]>()
let pickRadius = 60

function buildGrid() {
  grid = new Map()
  for (const [id, p] of positions) {
    const key = `${Math.floor(p.x / CELL)},${Math.floor(p.y / CELL)}`
    const bucket = grid.get(key)
    if (bucket) bucket.push(id)
    else grid.set(key, [id])
  }
}

function pickNode(world: Pt): TreeNode | null {
  const cx = Math.floor(world.x / CELL)
  const cy = Math.floor(world.y / CELL)
  let best: TreeNode | null = null
  let bestDist = Infinity
  for (let gx = cx - 1; gx <= cx + 1; gx++) {
    for (let gy = cy - 1; gy <= cy + 1; gy++) {
      const bucket = grid.get(`${gx},${gy}`)
      if (!bucket) continue
      for (const id of bucket) {
        const pos = positions.get(id)!
        const dx = pos.x - world.x
        const dy = pos.y - world.y
        const d = dx * dx + dy * dy
        if (d < bestDist) {
          bestDist = d
          best = props.tree.nodes[id] ?? null
        }
      }
    }
  }
  const reach = Math.max(pickRadius, 9 / scale)
  return best && Math.sqrt(bestDist) < reach ? best : null
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  const factor = Math.pow(1.0016, -e.deltaY)
  const newScale = Math.min(0.6, Math.max(scale * 0.02, scale * factor))
  const mouse = screenPos(e)
  const world = toWorld(mouse)
  scale = newScale
  panX = mouse.x - world.x * scale
  panY = mouse.y - world.y * scale
  scheduleDraw()
}

function onDown(e: MouseEvent) {
  dragging = true
  lastMouse = screenPos(e)
  downPos = lastMouse
}

function onMove(e: MouseEvent) {
  const mouse = screenPos(e)
  if (dragging && lastMouse) {
    panX += mouse.x - lastMouse.x
    panY += mouse.y - lastMouse.y
    lastMouse = mouse
    scheduleDraw()
    return
  }
  const node = pickNode(toWorld(mouse))
  if (node) hover.value = { x: mouse.x, y: mouse.y, node }
  else hover.value = null
}

/**
 * A press that never turned into a pan counts as a click on whatever node is
 * under it. Panning has no threshold of its own — the view follows the cursor
 * from the first pixel — so the click is decided here, by how far the press
 * travelled, and panning keeps its current feel.
 */
function onUp(e: MouseEvent) {
  const wasDragging = dragging
  const start = downPos
  dragging = false
  lastMouse = null
  downPos = null
  if (!props.editable || !wasDragging || !start) return
  const end = screenPos(e)
  if (Math.hypot(end.x - start.x, end.y - start.y) > 5) return
  const node = pickNode(toWorld(start))
  if (node) emit('toggleNode', node.id)
}

function onDblClick() {
  fitToContent()
  scheduleDraw()
}

watch(
  () => props.active,
  () => scheduleDraw(),
  { deep: false },
)
watch(nextUp, () => scheduleDraw())

/** A different ascendancy means a different cluster in the middle. */
watch(
  () => props.ascendancy,
  () => {
    rebuildGeometry()
    buildGrid()
    fitToContent()
    scheduleDraw()
  },
)

onMounted(async () => {
  analyseGeometry()
  rebuildGeometry()
  buildGrid()
  fitToContent()
  const canvas = canvasEl.value!
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('mousedown', onDown)
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  canvas.addEventListener('dblclick', onDblClick)
  resizeObs = new ResizeObserver(scheduleDraw)
  resizeObs.observe(wrapEl.value!)

  // The artwork is ~1MB across four sheets; paint the geometry immediately so
  // the view is usable, then repaint once the atlases decode.
  draw()
  try {
    art = await loadTreeArt()
    // Frame art is drawn around the icon, so hovering should reach a little
    // past the icon itself.
    pickRadius = (art.index.drawFrame['normal.unallocated'] ?? 102) / 2
    artReady.value = true
  } catch {
    /* fall back to the plain style rather than a blank canvas */
  }
  draw()
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  resizeObs?.disconnect()
  window.removeEventListener('mousemove', onMove)
  window.removeEventListener('mouseup', onUp)
})
</script>

<template>
  <div ref="wrapEl" class="tree-wrap">
    <canvas ref="canvasEl" />
    <div v-if="hover" class="tooltip" :style="{ left: hover.x + 14 + 'px', top: hover.y + 14 + 'px' }" v-html="hoverHtml" />
    <div class="hint">
      {{ editable ? t('点击节点加/减 · 滚轮缩放 · 拖拽平移 · 双击复位') : t('滚轮缩放 · 拖拽平移 · 双击复位') }}
    </div>
    <div class="credit">© Grinding Gear Games</div>
  </div>
</template>

<style scoped>
.tree-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
canvas {
  width: 100%;
  height: 100%;
  display: block;
  cursor: grab;
}
canvas:active {
  cursor: grabbing;
}
.tooltip {
  position: absolute;
  pointer-events: none;
  background: rgba(16, 19, 28, 0.95);
  border: 1px solid #39415a;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.5;
  color: #cfd4e4;
  max-width: 340px;
  z-index: 10;
}
.en-stat {
  display: block;
  color: #5b6379;
  font-size: 10px;
}
.hint {
  position: absolute;
  right: 12px;
  bottom: 10px;
  font-size: 11px;
  color: #5b6379;
  user-select: none;
}
.credit {
  position: absolute;
  left: 12px;
  bottom: 10px;
  font-size: 10px;
  color: #3d4457;
  user-select: none;
}
</style>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { buildEdges, nodePosition, treeBounds, translateStat } from '@poe2coach/core'
import type { TreeData, TreeNode } from '@poe2coach/core'
import statTranslationJson from '@poe2coach/data/stat-translations.json'
import { dialect, t, zhName } from '../i18n'

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
}>()

const canvasEl = ref<HTMLCanvasElement | null>(null)
const wrapEl = ref<HTMLDivElement | null>(null)
const hover = ref<{ x: number; y: number; node: TreeNode } | null>(null)

interface Pt {
  x: number
  y: number
}

let positions = new Map<number, Pt>()
let edges: [number, number][] = []
let scale = 0.03
let panX = 0
let panY = 0
let dragging = false
let lastMouse: Pt | null = null
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

function rebuildGeometry() {
  positions = new Map()
  for (const node of Object.values(props.tree.nodes)) {
    const pos = nodePosition(node, props.tree)
    if (pos) positions.set(node.id, pos)
  }
  edges = buildEdges(props.tree)
}

function fitToContent() {
  const b = treeBounds(props.tree)
  const canvas = canvasEl.value
  if (!canvas) return
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  const pad = 30
  scale = Math.min(w / (b.maxX - b.minX + pad * 2), h / (b.maxY - b.minY + pad * 2))
  const cx = (b.minX + b.maxX) / 2
  const cy = (b.minY + b.maxY) / 2
  panX = w / 2 - cx * scale
  panY = h / 2 - cy * scale
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
  ctx.fillStyle = '#0b0d12'
  ctx.fillRect(0, 0, w, h)

  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * panX, dpr * panY)

  const active = props.active
  const progress = props.progress ?? new Set<number>()
  ctx.lineCap = 'round'

  // Edges: screen-constant hairlines, bright enough to read when zoomed out.
  const lw = 1 / scale
  for (const [a, b] of edges) {
    const pa = positions.get(a)!
    const pb = positions.get(b)!
    const inProgress = progress.has(a) && progress.has(b)
    const inActive = active.has(a) && active.has(b)
    if (inProgress) {
      ctx.strokeStyle = 'rgba(240,186,88,0.95)'
      ctx.lineWidth = lw * 2.2
    } else if (inActive) {
      ctx.strokeStyle = 'rgba(180,140,60,0.55)'
      ctx.lineWidth = lw * 1.6
    } else {
      ctx.strokeStyle = 'rgba(122,136,176,0.7)'
      ctx.lineWidth = lw
    }
    ctx.beginPath()
    ctx.moveTo(pa.x, pa.y)
    ctx.lineTo(pb.x, pb.y)
    ctx.stroke()
  }

  // Nodes: screen-constant radius so they stay readable when zoomed out.
  for (const node of Object.values(props.tree.nodes)) {
    const pos = positions.get(node.id)
    if (!pos) continue
    const isActive = active.has(node.id)
    const isProgress = progress.has(node.id)
    const kindR = node.isKeystone ? 7.5 : node.isNotable ? 5 : node.ascendancyName ? 3.5 : 2.8
    const r = (isProgress ? kindR + 3.5 : isActive ? kindR + 1 : kindR) / scale
    if (pos.x < (0 - panX) / scale - r * 2 || pos.x > (w - panX) / scale + r * 2) continue
    if (pos.y < (0 - panY) / scale - r * 2 || pos.y > (h - panY) / scale + r * 2) continue

    if (isActive && isProgress) {
      ctx.shadowColor = 'rgba(240,186,88,0.9)'
      ctx.shadowBlur = 12 / scale
      ctx.fillStyle = '#f0ba58'
    } else if (isActive) {
      ctx.fillStyle = '#8a6f35'
    } else if (node.isKeystone) {
      ctx.fillStyle = '#b0524e'
    } else if (node.isNotable) {
      ctx.fillStyle = '#6f7fb5'
    } else if (node.ascendancyName) {
      ctx.fillStyle = '#4a5270'
    } else {
      ctx.fillStyle = '#39415a'
    }
    ctx.beginPath()
    ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
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
  // Hover pick: nearest node within 9 screen px.
  const world = toWorld(mouse)
  let best: TreeNode | null = null
  let bestDist = Infinity
  for (const node of Object.values(props.tree.nodes)) {
    const pos = positions.get(node.id)
    if (!pos) continue
    const dx = pos.x - world.x
    const dy = pos.y - world.y
    const d = dx * dx + dy * dy
    if (d < bestDist) {
      bestDist = d
      best = node
    }
  }
  if (best && Math.sqrt(bestDist) * scale < 9) {
    hover.value = { x: mouse.x, y: mouse.y, node: best }
  } else {
    hover.value = null
  }
}

function onUp() {
  dragging = false
  lastMouse = null
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

onMounted(() => {
  rebuildGeometry()
  fitToContent()
  const canvas = canvasEl.value!
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('mousedown', onDown)
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  canvas.addEventListener('dblclick', onDblClick)
  resizeObs = new ResizeObserver(scheduleDraw)
  resizeObs.observe(wrapEl.value!)
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
    <div class="hint">{{ t('滚轮缩放 · 拖拽平移 · 双击复位') }}</div>
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
</style>

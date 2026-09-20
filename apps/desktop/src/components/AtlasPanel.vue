<script setup lang="ts">
/**
 * 异界天赋树 —— the Atlas passive tree, drawn and planned.
 *
 * This is the half of "what should I farm" the map table cannot answer. A map row
 * says what an area *is*; a node here says what the tree does to it. Every node
 * belongs to a subtree and the subtrees are the mechanics — Breach, Delirium,
 * Ritual, Expedition, Abyss, Incursion — plus the generic main tree, so picking a
 * subtree is picking what you intend to farm, and the progress bars read as "how
 * far into the Breach tree am I".
 *
 * The tree is drawn, not traced: no game art ships with this page. The frames and
 * icons the character tree uses come from GGG's official export, which has no atlas
 * counterpart — `grindinggear/atlastree-export` is PoE1 — and the public data export
 * carries the atlas node positions but none of its textures. So the canvas uses the
 * same self-drawn vocabulary as the campaign zone sketches: shape and colour carry
 * the meaning, and nothing pretends to be a screenshot.
 *
 * Coordinates are baked into the data file by `scripts/build-atlas.mjs`, so nothing
 * here does orbit trigonometry.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  atlasBiomeKey,
  atlasStatText,
  canAllocate,
  pathTo,
  subtreeProgress,
  unallocate,
  type AtlasNode,
} from '@poe2coach/core'
import { ATLAS, ATLAS_CAPTURED, ATLAS_INDEX, ATLAS_SOURCE, ALLOCATABLE_COUNT } from '../atlasData'
import { atlasFocus } from '../atlasFocus'
import { t } from '../i18n'

/** Point into which no point can go; drawn but never selectable. */
const KIND_LABEL: Record<string, string> = {
  normal: '普通',
  notable: '显著',
  keystone: '关键',
  root: '起点',
  mastery: '精通位',
}
const KIND_RADIUS: Record<string, number> = { normal: 22, notable: 32, keystone: 42, root: 34, mastery: 16 }

const ALLOC_KEY = 'poe2coach.atlas.allocated'

function loadAllocated(): Set<number> {
  try {
    const raw = localStorage.getItem(ALLOC_KEY)
    const list = raw ? (JSON.parse(raw) as number[]) : []
    // A plan can only be shown if it is buildable; a stale or hand-edited one that
    // is not gets dropped back to nothing rather than displayed as if it were real.
    const set = new Set(list.filter((h) => ATLAS_INDEX.byHash.has(h)))
    return set
  } catch {
    return new Set()
  }
}

const allocated = ref<Set<number>>(loadAllocated())

function saveAllocated() {
  try {
    localStorage.setItem(ALLOC_KEY, JSON.stringify([...allocated.value]))
  } catch {
    /* storage off — the plan just does not persist */
  }
}

watch(allocated, saveAllocated, { deep: false })

// ------------------------------------------------------------------ view transform

const host = ref<HTMLElement | null>(null)
const scale = ref(0.2)
const tx = ref(0)
const ty = ref(0)

const B = ATLAS.bounds
const WORLD_W = B.maxX - B.minX
const WORLD_H = B.maxY - B.minY

/** Set once the reader pans or zooms, so a later layout change stops re-fitting. */
let touched = false

function fit() {
  const el = host.value
  if (!el) return
  const w = el.clientWidth
  const h = el.clientHeight
  // Before layout the box is 0x0; fitting then would compute a nonsense scale, so
  // wait for a real size. The observer below calls back once there is one.
  if (w < 40 || h < 40) return
  const k = Math.min(w / WORLD_W, h / WORLD_H) * 0.94
  scale.value = k
  tx.value = w / 2 - ((B.minX + B.maxX) / 2) * k
  ty.value = h / 2 - ((B.minY + B.maxY) / 2) * k
  touched = false
}

function reset() {
  touched = false
  fit()
}

let observer: ResizeObserver | null = null

let dragging = false
let lastX = 0
let lastY = 0

function onPointerDown(e: PointerEvent) {
  dragging = true
  touched = true
  lastX = e.clientX
  lastY = e.clientY
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  if (!dragging) return
  tx.value += e.clientX - lastX
  ty.value += e.clientY - lastY
  lastX = e.clientX
  lastY = e.clientY
}

function onPointerUp(e: PointerEvent) {
  dragging = false
  try {
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  } catch {
    /* capture already gone */
  }
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  const el = host.value
  if (!el) return
  touched = true
  const rect = el.getBoundingClientRect()
  const px = e.clientX - rect.left
  const py = e.clientY - rect.top
  const before = (px - tx.value) / scale.value
  const beforeY = (py - ty.value) / scale.value
  const next = Math.min(1.4, Math.max(0.06, scale.value * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
  scale.value = next
  tx.value = px - before * next
  ty.value = py - beforeY * next
}

const transform = computed(() => `translate(${tx.value} ${ty.value}) scale(${scale.value})`)

/**
 * Node radius in world units, chosen so the *screen* size stays legible.
 *
 * Sizes in this tree are world units, and the whole tree spans about 11,600 of them,
 * so at overview zoom a literal radius of 22 lands at 0.9 px and the tree reads as
 * speckle. The radius is therefore clamped in screen space (1.5 px floor so a node
 * is always a visible dot, 22 px ceiling so a zoomed-in node does not swell into a
 * blob) and divided back into world units for the transform to scale.
 */
function nodeRadius(n: AtlasNode): number {
  const k = scale.value || 1
  const world = KIND_RADIUS[n.kind] ?? 22
  const screen = Math.min(22, Math.max(1.5, world * k))
  return screen / k
}

/** Label size in world units, likewise pinned to a readable screen size. */
const labelSize = computed(() => 13 / (scale.value || 1))

/** Below this zoom, names would collide into a grey wash; hover still tells you. */
const labelsWorthShowing = computed(() => scale.value > 0.1)

// ------------------------------------------------------------------ filters

const focus = ref<string>('all')
/** A map-table biome, folded to the wording the tree uses ("City", "Mountain"). */
const biomeFocus = ref<string | null>(null)
const query = ref('')
const showNames = ref(false)

const focusColor = computed(() => ATLAS.subtrees.find((s) => s.id === focus.value)?.color ?? '#8a93ad')

/** Nodes matching the search, so a hit can be pointed at without hunting for it. */
const matches = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return new Set<number>()
  return new Set(
    ATLAS.nodes
      .filter(
        (n) =>
          n.name.toLowerCase().includes(q) ||
          n.stats.some((s) => atlasStatText(s).toLowerCase().includes(q)) ||
          n.id.toLowerCase().includes(q),
      )
      .map((n) => n.hash),
  )
})

function dimmed(n: AtlasNode): boolean {
  if (focus.value !== 'all' && n.subtree !== focus.value) return true
  if (biomeFocus.value && !n.biomes.includes(biomeFocus.value)) return true
  if (matches.value.size > 0 && !matches.value.has(n.hash)) return true
  return false
}

/** How many nodes the tree restricts to the focused biome. */
const biomeNodeCount = computed(() =>
  biomeFocus.value ? ATLAS.nodes.filter((n) => n.biomes.includes(biomeFocus.value!)).length : 0,
)

const searchHitCount = computed(() => matches.value.size)

// ------------------------------------------------------------------ edges

interface EdgeShape {
  key: string
  d: string
  /** Both ends on the same subtree, for colouring. */
  subtree: string
  on: boolean
}

const nodesByHash = ATLAS_INDEX.byHash

/**
 * Edges as arcs when both ends sit on the same group and orbit — that is how the
 * game curves a ring of nodes — and as straight lines otherwise. The export also
 * carries per-connection spline radii; those refine cross-group curves, which the
 * straight fallback draws adequately, so v1 leaves them out rather than pretending
 * to a precision it does not have.
 */
const edges = computed<EdgeShape[]>(() =>
  ATLAS.edges.map(([a, b]) => {
    const na = nodesByHash.get(a)
    const nb = nodesByHash.get(b)
    if (!na || !nb) return null
    const sameRing = na.group === nb.group && na.orbit === nb.orbit && na.orbit > 0
    const d = sameRing
      ? `M ${na.x} ${na.y} A ${radiusOf(na)} ${radiusOf(na)} 0 0 ${na.orbitIndex <= nb.orbitIndex ? 1 : 0} ${nb.x} ${nb.y}`
      : `M ${na.x} ${na.y} L ${nb.x} ${nb.y}`
    return {
      key: `${a}-${b}`,
      d,
      subtree: na.subtree,
      on: allocated.value.has(a) && allocated.value.has(b),
    }
  }).filter((e): e is EdgeShape => e != null),
)

/** The ring a node sits on, for the arc radius of a same-ring edge. */
function radiusOf(n: AtlasNode): number {
  const dx = n.x - groupCentre(n).x
  const dy = n.y - groupCentre(n).y
  return Math.max(1, Math.round(Math.hypot(dx, dy)))
}

const groupCentres = new Map<number, { x: number; y: number }>()
for (const n of ATLAS.nodes) {
  if (n.orbit === 0) groupCentres.set(n.group, { x: n.x, y: n.y })
}
/** Fallback: the mean of a group's nodes, when no node sits at its centre. */
function groupCentre(n: AtlasNode): { x: number; y: number } {
  const direct = groupCentres.get(n.group)
  if (direct) return direct
  const members = ATLAS.nodes.filter((m) => m.group === n.group)
  const c = {
    x: members.reduce((s, m) => s + m.x, 0) / members.length,
    y: members.reduce((s, m) => s + m.y, 0) / members.length,
  }
  groupCentres.set(n.group, c)
  return c
}

// ------------------------------------------------------------------ interaction

const hovered = ref<AtlasNode | null>(null)
const pointer = ref({ x: 0, y: 0 })
const notice = ref<string | null>(null)

function onNodeEnter(n: AtlasNode, e: MouseEvent) {
  hovered.value = n
  const rect = host.value?.getBoundingClientRect()
  if (rect) pointer.value = { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function onNodeMove(e: MouseEvent) {
  const rect = host.value?.getBoundingClientRect()
  if (rect) pointer.value = { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function clickNode(n: AtlasNode) {
  if (n.kind === 'mastery') {
    notice.value = t('精通位是树的标记点,不能投入天赋点。')
    return
  }
  notice.value = null
  if (allocated.value.has(n.hash)) {
    allocated.value = unallocate(ATLAS_INDEX, allocated.value, n.hash)
    return
  }
  const path = pathTo(ATLAS_INDEX, allocated.value, n.hash)
  if (!path || path.length === 0) {
    notice.value = t('这个节点现在还接不上 —— 先从它所在子树的起点开始点。')
    return
  }
  const next = new Set(allocated.value)
  for (const h of path) next.add(h)
  allocated.value = next
}

function clearPlan() {
  allocated.value = new Set()
  notice.value = null
}

const progress = computed(() => subtreeProgress(ATLAS_INDEX, ATLAS, allocated.value))
const allocatedCount = computed(() => allocated.value.size)

const hoveredEffects = computed(() => (hovered.value ? hovered.value.stats.map(atlasStatText) : []))

/** Notables and keystones a subtree offers, for the side list. */
const focusNodes = computed(() => {
  const id = focus.value === 'all' ? null : focus.value
  return ATLAS.nodes
    .filter((n) => (id ? n.subtree === id : true))
    .filter((n) => n.kind === 'notable' || n.kind === 'keystone')
    .filter((n) => {
      if (biomeFocus.value && !n.biomes.includes(biomeFocus.value)) return false
      if (matches.value.size === 0) return true
      return matches.value.has(n.hash)
    })
    .sort((a, b) => Number(allocated.value.has(b.hash)) - Number(allocated.value.has(a.hash)) || a.name.localeCompare(b.name))
})

function nodeFill(n: AtlasNode): string {
  const color = ATLAS.subtrees.find((s) => s.id === n.subtree)?.color ?? '#8a93ad'
  if (allocated.value.has(n.hash)) return color
  return color
}

function nodeOpacity(n: AtlasNode): number {
  if (dimmed(n)) return 0.12
  return allocated.value.has(n.hash) ? 1 : 0.42
}

const canTake = (n: AtlasNode) => canAllocate(ATLAS_INDEX, allocated.value, n.hash)

function onResize() {
  if (!touched) fit()
}

// A request from the map page ("show me the Mountain nodes") lands here.
watch(
  atlasFocus,
  (req) => {
    if (!req) return
    if (req.subtree) focus.value = req.subtree
    if (req.biome) biomeFocus.value = atlasBiomeKey(req.biome)
    atlasFocus.value = null
  },
  { immediate: true },
)

onMounted(() => {
  fit()
  // The canvas is sized by flex layout, which is not final on the first frame; the
  // observer re-fits as soon as the box has a real size, and stays quiet once the
  // reader has moved the view themselves.
  if (host.value && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(onResize)
    observer.observe(host.value)
  }
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <div class="atlas-wrap">
    <div class="summary card">
      <div class="sum-row">
        <span class="sum-item"><b class="gold">{{ ATLAS.nodes.length }}</b> {{ t('个天赋节点') }}</span>
        <span class="sum-item"><b class="blue">{{ ATLAS.subtrees.length - 1 }}</b> {{ t('棵机制子树') }}</span>
        <span class="sum-item"><b class="green">{{ allocatedCount }}</b> / {{ ALLOCATABLE_COUNT }} {{ t('已点') }}</span>
        <span class="sum-item dim">{{ t('异界天赋可以点满,所以这里的问题不是取舍,而是先点哪边。') }}</span>
      </div>
      <p class="dim small">
        {{ t('每个节点属于一棵子树,子树就是玩法机制 —— 想刷哪个机制,就先点它的子树。') }}
        {{ t('左键点节点投入天赋点(会自动补上通往它的路径),再点一次取消(连带取消后面挂着的)。') }}
      </p>
    </div>

    <div class="toolbar card">
      <input v-model="query" class="search" :placeholder="t('搜索节点名或效果…')" spellcheck="false" />
      <label class="hd dim"><input v-model="showNames" type="checkbox" />{{ t('显示名称') }}</label>
      <button class="filter" :class="{ active: focus === 'all' }" @click="focus = 'all'">{{ t('全部') }}</button>
      <button
        v-for="s in ATLAS.subtrees"
        :key="s.id"
        class="filter"
        :class="{ active: focus === s.id }"
        :style="focus === s.id ? { color: s.color, borderColor: s.color } : {}"
        @click="focus = s.id"
      >
        {{ t(s.label) }} {{ s.count }}
      </button>
      <span class="spacer" />
      <button class="filter" @click="reset">{{ t('复位视图') }}</button>
      <button class="filter danger" :disabled="allocatedCount === 0" @click="clearPlan">{{ t('清空方案') }}</button>
    </div>

    <div class="biome-row card">
      <span class="dim small">{{ t('按生态筛选(树里写着「在 X 区域」的节点):') }}</span>
      <button class="filter" :class="{ active: biomeFocus === null }" @click="biomeFocus = null">{{ t('不限') }}</button>
      <button
        v-for="b in ATLAS.biomeKeywords"
        :key="b"
        class="filter"
        :class="{ active: biomeFocus === b }"
        @click="biomeFocus = biomeFocus === b ? null : b"
      >
        {{ b }}
      </button>
      <span v-if="biomeFocus" class="dim small">
        {{ biomeNodeCount }} {{ t('个节点只对') }} {{ biomeFocus }} {{ t('区域生效。') }}
      </span>
    </div>

    <p v-if="query.trim()" class="dim small hit-line">
      {{ t('搜索命中') }} {{ searchHitCount }} {{ t('个节点,已在树上高亮。') }}
    </p>
    <p v-if="notice" class="notice">{{ notice }}</p>

    <div class="split">
      <div
        ref="host"
        class="canvas card"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @wheel="onWheel"
        @dblclick="reset"
      >
        <svg class="tree">
          <g :transform="transform">
            <path
              v-for="e in edges"
              :key="e.key"
              :d="e.d"
              class="edge"
              :class="{ on: e.on }"
              vector-effect="non-scaling-stroke"
              :style="e.on ? { stroke: focusColor, opacity: 0.9 } : { opacity: 0.32 }"
            />
            <g
              v-for="n in ATLAS.nodes"
              :key="n.hash"
              class="node"
              :class="{ hit: matches.has(n.hash) && query.trim().length > 0 }"
              @mouseenter="onNodeEnter(n, $event)"
              @mousemove="onNodeMove"
              @mouseleave="hovered = null"
              @click.stop="clickNode(n)"
            >
              <circle
                :cx="n.x"
                :cy="n.y"
                :r="nodeRadius(n)"
                :fill="nodeFill(n)"
                :fill-opacity="nodeOpacity(n)"
                :stroke="allocated.has(n.hash) ? '#f4e6c0' : 'rgba(0,0,0,0.55)'"
                vector-effect="non-scaling-stroke"
                :stroke-width="allocated.has(n.hash) ? 2.5 : 1.2"
                :stroke-dasharray="n.kind === 'mastery' ? '4 4' : undefined"
              />
              <circle
                v-if="allocated.has(n.hash)"
                :cx="n.x"
                :cy="n.y"
                :r="nodeRadius(n) * 1.9"
                fill="none"
                :stroke="focusColor"
                vector-effect="non-scaling-stroke"
                stroke-width="2"
                opacity="0.6"
              />
              <text
                v-if="showNames && labelsWorthShowing && (n.kind === 'notable' || n.kind === 'keystone') && !dimmed(n)"
                :x="n.x"
                :y="n.y - nodeRadius(n) - 5 / scale"
                class="label"
                :style="{ fontSize: `${labelSize}px` }"
                text-anchor="middle"
              >
                {{ n.name }}
              </text>
            </g>
          </g>
        </svg>

        <div v-if="hovered" class="tip" :style="{ left: `${pointer.x + 16}px`, top: `${pointer.y + 14}px` }">
          <div class="tip-head">
            <b>{{ hovered.name }}</b>
            <span class="tip-kind">{{ t(KIND_LABEL[hovered.kind] ?? hovered.kind) }}</span>
          </div>
          <div class="tip-sub dim">
            {{ t(ATLAS.subtrees.find((s) => s.id === hovered!.subtree)?.label ?? hovered.subtree) }}
            · {{ hovered.id }}
            <template v-if="hovered.biomes.length"> · {{ hovered.biomes.join('/') }}</template>
          </div>
          <ul v-if="hoveredEffects.length" class="tip-stats">
            <li v-for="(line, i) in hoveredEffects" :key="i">{{ line }}</li>
          </ul>
          <div v-else class="dim small">{{ t('没有效果文本(起点或标记点)。') }}</div>
          <div v-if="allocated.has(hovered.hash)" class="tip-state on">{{ t('已点 · 再点一次取消') }}</div>
          <div v-else-if="canTake(hovered)" class="tip-state">{{ t('可点 · 点击投入') }}</div>
          <div v-else class="tip-state off">{{ t('暂不可点 · 需要先连到起点') }}</div>
        </div>
      </div>

      <aside class="side">
        <div class="card block">
          <h3>{{ t('子树进度') }}</h3>
          <p class="dim small">{{ t('点一个子树就把它的节点单独高亮;进度是这棵树在你计划里走了多远。') }}</p>
          <button
            v-for="p in progress"
            :key="p.id"
            class="prog"
            :class="{ active: focus === p.id, locked: !p.unlocked }"
            @click="focus = focus === p.id ? 'all' : p.id"
          >
            <span class="prog-name" :style="{ color: p.color }">{{ t(p.label) }}</span>
            <span class="prog-bar">
              <i :style="{ width: `${p.total ? (p.allocated / p.total) * 100 : 0}%`, background: p.color }" />
            </span>
            <span class="prog-num dim">{{ p.allocated }}/{{ p.total }}</span>
            <span class="prog-note dim">{{ t('显著') }} {{ p.notablesTaken }}/{{ p.notablesTotal }}</span>
          </button>
        </div>

        <div class="card block">
          <h3>
            {{ t('节点') }}
            <span class="dim small">{{ focus === 'all' ? t('全部子树') : t(ATLAS.subtrees.find((s) => s.id === focus)?.label ?? '') }}</span>
          </h3>
          <p class="dim small">{{ t('显著与关键节点(普通节点只加数值,这里不列)。') }}</p>
          <div class="node-list">
            <button
              v-for="n in focusNodes"
              :key="n.hash"
              class="node-row"
              :class="{ taken: allocated.has(n.hash) }"
              @click="clickNode(n)"
              @mouseenter="hovered = n"
              @mouseleave="hovered = null"
            >
              <span class="dot" :style="{ background: ATLAS.subtrees.find((s) => s.id === n.subtree)?.color }" />
              <span class="node-name">{{ n.name }}</span>
              <span v-if="allocated.has(n.hash)" class="tick">✓</span>
            </button>
            <p v-if="focusNodes.length === 0" class="dim small">{{ t('没有匹配的节点。') }}</p>
          </div>
        </div>
      </aside>
    </div>

    <div class="source dim">
      {{ t('数据来源:repoe-fork.github.io/poe2(公开数据导出)的 Atlas.json;节点坐标按其 group/orbit 规则烘焙。') }}
      <span class="raw-source" :title="ATLAS_SOURCE">{{ t('采集于') }} {{ ATLAS_CAPTURED }}</span>
      <span class="dim">{{ t('本页图形为自绘,不含游戏素材。') }}</span>
    </div>
  </div>
</template>

<style scoped>
.atlas-wrap {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  min-height: 0;
}
.card {
  background: #10131b;
  border: 1px solid #232939;
  border-radius: 8px;
}
.summary {
  padding: 12px 14px;
}
.sum-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  font-size: 12px;
  color: #9aa3bd;
  margin-bottom: 6px;
}
.sum-item b {
  font-size: 13px;
}
.gold {
  color: #e8b04b;
}
.blue {
  color: #7aa5d9;
}
.green {
  color: #7dd087;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  padding: 10px 14px;
}
.search {
  flex: 1 1 180px;
  min-width: 160px;
  background: #0b0d12;
  border: 1px solid #2c3244;
  border-radius: 6px;
  color: #cfd4e4;
  font-size: 12px;
  padding: 6px 10px;
}
.search:focus {
  outline: none;
  border-color: #4a3d20;
}
.hd {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.spacer {
  flex: 1;
}
.filter {
  background: #1a1f2c;
  border: 1px solid #2c3244;
  color: #8a93ad;
  border-radius: 12px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.filter.active {
  color: #e8b04b;
  border-color: #e8b04b;
}
.filter.danger:disabled {
  opacity: 0.4;
  cursor: default;
}
.biome-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px 8px;
  padding: 8px 14px;
}
.hit-line,
.notice {
  font-size: 12px;
  margin: 0;
}
.notice {
  color: #e0885a;
}
.split {
  display: flex;
  gap: 10px;
  flex: 1;
  min-height: 0;
}
.canvas {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 420px;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
}
.canvas:active {
  cursor: grabbing;
}
.tree {
  width: 100%;
  height: 100%;
  display: block;
  background: radial-gradient(circle at 50% 45%, #131824 0%, #0a0c12 70%);
}
.edge {
  stroke: #6b7390;
  stroke-width: 1.4;
  fill: none;
}
.edge.on {
  stroke-width: 2.6;
}
.node {
  cursor: pointer;
}
.node.hit circle:first-child {
  stroke: #f4e6c0;
}
.label {
  fill: #cfd4e4;
  paint-order: stroke;
  stroke: #0a0c12;
  stroke-width: 4;
  pointer-events: none;
}
.tip {
  position: absolute;
  z-index: 5;
  max-width: 320px;
  background: #0e1119;
  border: 1px solid #2c3244;
  border-radius: 8px;
  padding: 8px 10px;
  pointer-events: none;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.55);
}
.tip-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.tip-head b {
  color: #e8b04b;
  font-size: 13px;
}
.tip-kind {
  font-size: 10px;
  border: 1px solid #2c3244;
  border-radius: 8px;
  padding: 0 6px;
  color: #9aa3bd;
}
.tip-sub {
  font-size: 10px;
  margin-top: 2px;
}
.tip-stats {
  margin: 6px 0 0;
  padding-left: 14px;
  font-size: 12px;
  color: #c9c0a0;
  line-height: 1.55;
}
.tip-state {
  margin-top: 6px;
  font-size: 11px;
  color: #7dd087;
}
.tip-state.off {
  color: #6b7390;
}
.tip-state.on {
  color: #e8b04b;
}
.side {
  flex: 0 0 300px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}
.block {
  padding: 10px 12px;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.block h3 {
  font-size: 13px;
  color: #cfd4e4;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 2px;
}
.block .small {
  font-size: 11px;
  line-height: 1.55;
  margin: 0 0 6px;
}
.prog {
  display: grid;
  grid-template-columns: 62px 1fr auto;
  grid-template-areas: 'name bar num' 'note note note';
  gap: 2px 8px;
  align-items: center;
  background: none;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 5px 6px;
  cursor: pointer;
  text-align: left;
}
.prog:hover {
  background: #141826;
}
.prog.active {
  border-color: #2c3244;
  background: #141826;
}
.prog.locked {
  opacity: 0.5;
}
.prog-name {
  grid-area: name;
  font-size: 12px;
  font-weight: 600;
}
.prog-bar {
  grid-area: bar;
  height: 5px;
  background: #1a1f2c;
  border-radius: 3px;
  overflow: hidden;
}
.prog-bar i {
  display: block;
  height: 100%;
}
.prog-num {
  grid-area: num;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.prog-note {
  grid-area: note;
  font-size: 10px;
  padding-left: 2px;
}
.node-list {
  overflow-y: auto;
  flex: 1;
  min-height: 120px;
  max-height: 320px;
}
.node-row {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  background: none;
  border: none;
  border-bottom: 1px solid #141826;
  color: #cfd4e4;
  font-size: 12px;
  padding: 5px 4px;
  cursor: pointer;
  text-align: left;
}
.node-row:hover {
  background: #141826;
}
.node-row.taken .node-name {
  color: #e8b04b;
}
.dot {
  flex: 0 0 7px;
  height: 7px;
  border-radius: 50%;
}
.node-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tick {
  color: #7dd087;
}
.source {
  font-size: 11px;
  line-height: 1.6;
}
.raw-source {
  margin-left: 6px;
  color: #4a5270;
}
</style>

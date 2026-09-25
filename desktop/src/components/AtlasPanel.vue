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
  strategyBrief,
  subtreeProgress,
  unallocate,
  type AtlasNode,
} from '@poe2coach/core'
import { ATLAS, ATLAS_CAPTURED, ATLAS_INDEX, ATLAS_SOURCE, ALLOCATABLE_COUNT } from '../atlasData'
import { AREAS, LAYOUT_LABEL, biomeLabel } from '../mapData'
import { allocated as planAllocated, clearAllocated } from '../atlasPlan'
import { atlasFocus } from '../atlasFocus'
import { requestMapFocus } from '../mapFocus'
import { measuredBadgeFor } from '../farmMeasured'
import TabletsCard from './TabletsCard.vue'
import { ICON_URLS, ICON_RECTS, SPRITES, FRAMES, SHEET_SIZES } from '@poe2coach/data/atlas-art/icons'
import { t, zhName } from '../i18n'
import { nameZh } from '../nameZh'

const emit = defineEmits<{ openMaps: [biome: string] }>()

/** Point into which no point can go; drawn but never selectable. */
const KIND_LABEL: Record<string, string> = {
  normal: '普通',
  notable: '显著',
  keystone: '关键',
  root: '起点',
  mastery: '精通位',
}
const KIND_RADIUS: Record<string, number> = { normal: 22, notable: 32, keystone: 42, root: 34, mastery: 16 }

/**
 * A biome word as the reader sees it — the authored Chinese when the word belongs
 * to either vocabulary, the tree's own English otherwise.
 */
function biomeZh(b: string): string {
  const zh = biomeLabel(b)
  return zh ? t(zh) : b
}

/** Chinese first, English in the tooltip — the dictionary covers every atlas node. */
function nodeName(n: AtlasNode): string {
  return zhName(n.name) ?? n.name
}

// The plan lives in `atlasPlan` because the share code reads and writes it too; this
// page is one of its consumers. Writing the ref here writes the shared one.
const allocated = planAllocated

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
// 拖拽意图:按下时先不捕获指针。pointer capture 会把后续的 click 事件重定向到
// 画布本身,节点的点击处理器就永远收不到了——正是"点节点没反应"的根源。改为
// 移动超过阈值才捕获,纯点击(按下原地抬起)不捕获,click 正常落到节点上。
let dragStart: { x: number; y: number; id: number } | null = null
const DRAG_THRESHOLD = 4

function onPointerDown(e: PointerEvent) {
  touched = true
  dragging = false
  dragStart = { x: e.clientX, y: e.clientY, id: e.pointerId }
  lastX = e.clientX
  lastY = e.clientY
}

function onPointerMove(e: PointerEvent) {
  if (!dragStart || e.pointerId !== dragStart.id) return
  if (!dragging) {
    const moved = Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y)
    if (moved < DRAG_THRESHOLD) return
    dragging = true
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* capture can fail on a detached target — panning still works while held */
    }
  }
  tx.value += e.clientX - lastX
  ty.value += e.clientY - lastY
  lastX = e.clientX
  lastY = e.clientY
}

function onPointerUp(e: PointerEvent) {
  if (!dragStart || e.pointerId !== dragStart.id) return
  dragging = false
  dragStart = null
  try {
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  } catch {
    /* never captured — a plain click */
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

/**
 * The click target: at overview zoom the visible dot is a few pixels, far below
 * what a mouse can reliably hit, so every node carries a transparent circle kept
 * at ~9 px on screen regardless of zoom.
 */
function hitRadius(n: AtlasNode): number {
  return Math.max(nodeRadius(n), 9 / (scale.value || 1))
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
    ATLAS.nodes.filter((n) => {
      if (n.name.toLowerCase().includes(q)) return true
      if (n.id.toLowerCase().includes(q)) return true
      // The dictionary's Chinese for the node name, so a reader can search in the
      // language the rest of the page is written in.
      const zh = nameZh(n.name)
      if (zh && zh.toLowerCase().includes(q)) return true
      return n.stats.some((s) => atlasStatText(s).toLowerCase().includes(q))
    }).map((n) => n.hash),
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

/**
 * The areas that biome covers, from the map table — the other half of the join.
 *
 * Matched through `atlasBiomeKey`, so the tree's single "City" resolves to all three
 * city biomes the table names separately. Sorted by the community's navigation
 * rating, which is the one ranking both sources agree on.
 */
const biomeAreas = computed(() => {
  if (!biomeFocus.value) return []
  return AREAS.filter((a) => a.kind === 'map' && a.biomes.some((b) => atlasBiomeKey(b) === biomeFocus.value))
    .slice()
    .sort((a, b) => (b.navigation ?? 0) - (a.navigation ?? 0) || a.name.localeCompare(b.name))
})

function showOnMapPage() {
  if (!biomeFocus.value) return
  requestMapFocus(biomeFocus.value)
  emit('openMaps', biomeFocus.value)
}

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
 * Edge paths come straight from the baked data: the build script decided per link
 * whether it is an arc and at what radius, so there is no orbit maths here. Arcs are
 * what make a ring of nodes read as a ring rather than as a fan of chords.
 */
const edges = computed<EdgeShape[]>(() =>
  ATLAS.edges
    .map((edge) => {
      const [a, b, r, sweep] = edge
      const na = nodesByHash.get(a)
      const nb = nodesByHash.get(b)
      if (!na || !nb) return null
      const d =
        r != null
          ? `M ${na.x} ${na.y} A ${r} ${r} 0 0 ${sweep} ${nb.x} ${nb.y}`
          : `M ${na.x} ${na.y} L ${nb.x} ${nb.y}`
      return { key: `${a}-${b}`, d, subtree: na.subtree, on: allocated.value.has(a) && allocated.value.has(b) }
    })
    .filter((e): e is EdgeShape => e != null),
)

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

// 本轮点击新分配的节点:短暂脉冲,让"哪里变了"在总览缩放下也一眼可见。
// 计时令牌防串:连续点击时只清自己那一批。
const justAdded = ref<Set<number>>(new Set())
let pulseToken = 0

function nodeLabel(n: AtlasNode): string {
  return zhName(n.name) ?? n.name
}

function clickNode(n: AtlasNode) {
  if (n.kind === 'mastery') {
    notice.value = t('精通位是树的标记点,不能投入天赋点。')
    return
  }
  notice.value = null
  if (allocated.value.has(n.hash)) {
    const before = allocated.value.size
    allocated.value = unallocate(ATLAS_INDEX, allocated.value, n.hash)
    const removed = before - allocated.value.size
    notice.value =
      t('已取消 ') +
      nodeLabel(n) +
      (removed > 1 ? t(',连带取消后面挂着的 ') + (removed - 1) + t(' 个节点') : '')
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
  notice.value =
    t('已投入 ') +
    nodeLabel(n) +
    (path.length > 1 ? t(',自动补上通往它的路径 ') + (path.length - 1) + t(' 个节点') : '')
  const mine = new Set(path)
  justAdded.value = mine
  const token = ++pulseToken
  window.setTimeout(() => {
    if (pulseToken === token) justAdded.value = new Set()
  }, 1100)
}

function clearPlan() {
  clearAllocated()
  notice.value = null
}

const progress = computed(() => subtreeProgress(ATLAS_INDEX, ATLAS, allocated.value))
const allocatedCount = computed(() => allocated.value.size)

/**
 * The plan's mechanics, strongest first — the same ranking the strategy card
 * uses, here to lead the tablet card with the mechanics the plan actually farms.
 */
const subtreeRank = computed(() =>
  strategyBrief(ATLAS, ATLAS_INDEX, allocated.value, AREAS).mechanics.map((m) => m.id),
)

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

function subtreeColor(n: AtlasNode): string {
  return ATLAS.subtrees.find((s) => s.id === n.subtree)?.color ?? '#8a93ad'
}

/** 未点是暗槽+机制色描边;已点填进机制色,描边转亮——"空槽变实"的层级语言。 */
function nodeFill(n: AtlasNode): string {
  if (n.kind === 'normal' || n.kind === 'mastery') return subtreeColor(n)
  if (allocated.value.has(n.hash)) return subtreeColor(n)
  return '#0e1119'
}

function nodeStroke(n: AtlasNode): string {
  if (allocated.value.has(n.hash)) return '#f4e6c0'
  if (n.kind === 'normal') return 'rgba(0,0,0,0.55)'
  return subtreeColor(n)
}

function nodeOpacity(n: AtlasNode): number {
  if (dimmed(n)) return 0.12
  if (n.kind === 'normal' || n.kind === 'mastery') return allocated.value.has(n.hash) ? 1 : 0.42
  return allocated.value.has(n.hash) ? 0.92 : 1
}


/**
 * 节点的游戏图标。icon 字段是游戏内路径(AtlasTrees/ExpeditionNotable5.dds),按
 * 小写基名查 fetch-atlas-sprites.mjs 抓回的图标包;没有条目的(极少数新节点)
 * 返回 null,由形状语言兜底。
 */
function iconFor(n: AtlasNode): string | null {
  // 普通节点保持纯点:575 个小图标铺满总览只会读成噪点,游戏总览也是点状。
  if (n.kind === 'normal') return null
  const base = n.icon?.replace(/^.*\//, '').replace(/\.dds$/i, '').toLowerCase()
  return base ? ICON_URLS[base] ?? null : null
}

/** 图标的绘制尺寸:索引里存的是精灵图像素(2x),游戏/树坐标是它的一半。 */
function iconHalf(n: AtlasNode): { w: number; h: number } | null {
  const base = n.icon?.replace(/^.*\//, '').replace(/\.dds$/i, '').toLowerCase()
  const r = base ? ICON_RECTS[base] : null
  if (!r) return null
  const [, , , w, h, scale] = r
  return { w: w / scale, h: h / scale }
}

type ArtRect = { si: number; x: number; y: number; w: number; h: number; scale: number }

function iconRectAll(n: AtlasNode): ArtRect | null {
  const base = n.icon?.replace(/^.*\//, '').replace(/\.dds$/i, '').toLowerCase()
  const r = base ? ICON_RECTS[base] : null
  return r ? { si: r[0], x: r[1], y: r[2], w: r[3], h: r[4], scale: r[5] } : null
}

function iconSprite(n: AtlasNode): string {
  return SPRITES[iconRectAll(n)!.si]
}

function iconSheetIndex(n: AtlasNode): number {
  return iconRectAll(n)?.si ?? 0
}

function iconViewBox(n: AtlasNode): string {
  const r = iconRectAll(n)!
  return `${r.x} ${r.y} ${r.w} ${r.h}`
}

function sheetW(si: number): number {
  return SHEET_SIZES[si][0]
}

function sheetH(si: number): number {
  return SHEET_SIZES[si][1]
}

/** 框:关键点/显著点各有 normal(未点)与 active(已点)两态游戏美术。 */
function frameRect(n: AtlasNode): [number, number, number, number, number, number] {
  const name = (n.kind === 'keystone' ? 'keystoneframe' : 'notableframe') + (allocated.value.has(n.hash) ? 'active' : 'normal')
  return FRAMES[name]
}

function frameHalf(n: AtlasNode): { w: number; h: number } {
  const [, , , w, h, scale] = frameRect(n)
  return { w: w / scale, h: h / scale }
}

function frameViewBox(n: AtlasNode): string {
  const [, x, y, w, h] = frameRect(n)
  return `${x} ${y} ${w} ${h}`
}

/** 机制子树的起点美术(游戏里那颗"入口"图标);主树起点没有专属美术。 */
function startingRect(n: AtlasNode): [number, number, number, number, number, number] | null {
  const key = 'startingpoint' + n.subtree.toLowerCase() + 'active'
  return FRAMES[key] ?? null
}

function startingSprite(n: AtlasNode): string {
  return SPRITES[startingRect(n)![0]]
}

function startingFor(n: AtlasNode): boolean {
  return startingRect(n) !== null
}

function startingSheetIndex(n: AtlasNode): number {
  return startingRect(n)?.[0] ?? 0
}

function startingViewBox(n: AtlasNode): string {
  const r = startingRect(n)!
  return `${r[1]} ${r[2]} ${r[3]} ${r[4]}`
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
        {{ biomeZh(b) }}
      </button>
      <span v-if="biomeFocus" class="dim small">
        {{ biomeNodeCount }} {{ t('个节点只对') }} {{ biomeZh(biomeFocus) }} {{ t('区域生效。') }}
      </span>
      <button v-if="biomeFocus && biomeAreas.length" class="filter jump" @click="showOnMapPage">
        {{ biomeAreas.length }} {{ t('个该生态的地区 → 在地图页看') }}
      </button>
      <span v-if="biomeFocus && !biomeAreas.length" class="dim small">
        {{ t('(地图表里没有该生态的地区。)') }}
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
              <!--
                游戏原生美术组合:显著/关键点 = 图标(精灵裁切) + 游戏框(未点 normal
                态/已点 active 态)盖顶,框罩住图标边缘;起点 = 子树起点美术;普通点
                保持实心小点(游戏总览同款);精通位 = 虚线圈 + 精通图标。命中区 >=18px。
              -->
              <g v-if="n.kind === 'keystone' || n.kind === 'notable'" :opacity="dimmed(n) ? 0.12 : 1">
                <svg
                  v-if="iconFor(n) && iconHalf(n)"
                  :x="n.x - iconHalf(n)!.w / 2"
                  :y="n.y - iconHalf(n)!.h / 2"
                  :width="iconHalf(n)!.w"
                  :height="iconHalf(n)!.h"
                  :viewBox="iconViewBox(n)"
                  preserveAspectRatio="xMidYMid meet"
                  style="overflow: hidden"
                >
                  <image
                    :href="iconSprite(n)"
                    :x="0"
                    :y="0"
                    :width="sheetW(iconSheetIndex(n))"
                    :height="sheetH(iconSheetIndex(n))"
                    :style="allocated.has(n.hash) ? undefined : { filter: 'brightness(1.9)' }"
                  />
                </svg>
                <svg
                  :x="n.x - frameHalf(n)!.w / 2"
                  :y="n.y - frameHalf(n)!.h / 2"
                  :width="frameHalf(n)!.w"
                  :height="frameHalf(n)!.h"
                  :viewBox="frameViewBox(n)"
                  preserveAspectRatio="xMidYMid meet"
                  style="overflow: hidden; pointer-events: none"
                  :class="{ fresh: justAdded.has(n.hash) }"
                >
                  <image
                    :href="SPRITES[frameRect(n)[0]]"
                    :x="0"
                    :y="0"
                    :width="sheetW(frameRect(n)[0])"
                    :height="sheetH(frameRect(n)[0])"
                  />
                </svg>
              </g>
              <g v-else-if="n.kind === 'root'">
                <svg
                  v-if="startingFor(n)"
                  :x="n.x - nodeRadius(n)"
                  :y="n.y - nodeRadius(n)"
                  :width="nodeRadius(n) * 2"
                  :height="nodeRadius(n) * 2"
                  :viewBox="startingViewBox(n)"
                  preserveAspectRatio="xMidYMid meet"
                  style="overflow: hidden"
                >
                  <image
                    :href="startingSprite(n)"
                    :x="0"
                    :y="0"
                    :width="sheetW(startingSheetIndex(n))"
                    :height="sheetH(startingSheetIndex(n))"
                    :opacity="allocated.has(n.hash) ? 1 : 0.55"
                  />
                </svg>
                <g v-else>
                  <circle
                    :cx="n.x"
                    :cy="n.y"
                    :r="nodeRadius(n)"
                    :fill="nodeFill(n)"
                    :fill-opacity="nodeOpacity(n)"
                    :stroke="nodeStroke(n)"
                    vector-effect="non-scaling-stroke"
                    stroke-width="2.5"
                  />
                  <circle
                    :cx="n.x"
                    :cy="n.y"
                    :r="nodeRadius(n) * 0.32"
                    :fill="allocated.has(n.hash) ? '#f4e6c0' : subtreeColor(n)"
                    fill-opacity="0.9"
                  />
                </g>
              </g>
              <circle
                v-else
                :cx="n.x"
                :cy="n.y"
                :r="nodeRadius(n)"
                :fill="nodeFill(n)"
                :fill-opacity="nodeOpacity(n)"
                :stroke="nodeStroke(n)"
                vector-effect="non-scaling-stroke"
                :stroke-width="allocated.has(n.hash) ? 2.5 : 1.2"
                :stroke-dasharray="n.kind === 'mastery' ? '4 4' : undefined"
                :class="{ fresh: justAdded.has(n.hash) }"
              />
              <image
                v-if="n.kind === 'mastery' && iconFor(n)"
                :x="n.x - (iconHalf(n)?.w ?? 0) / 2"
                :y="n.y - (iconHalf(n)?.h ?? 0) / 2"
                :width="iconHalf(n)?.w ?? 0"
                :height="iconHalf(n)?.h ?? 0"
                :href="iconFor(n)!"
                :opacity="dimmed(n) ? 0.12 : 1"
                pointer-events="none"
              />
              <circle :cx="n.x" :cy="n.y" :r="hitRadius(n)" fill="transparent" stroke="none" />
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
                {{ zhName(n.name) ?? n.name }}
              </text>
            </g>
          </g>
        </svg>

        <div v-if="hovered" class="tip" :style="{ left: `${pointer.x + 16}px`, top: `${pointer.y + 14}px` }">
          <div class="tip-head">
            <b>{{ nodeName(hovered) }}</b>
            <span class="tip-kind">{{ t(KIND_LABEL[hovered.kind] ?? hovered.kind) }}</span>
          </div>
          <div class="tip-sub dim">
            {{ t(ATLAS.subtrees.find((s) => s.id === hovered!.subtree)?.label ?? hovered.subtree) }}
            · {{ hovered.id }}
            <template v-if="hovered.biomes.length"> · {{ hovered.biomes.map(biomeZh).join('/') }}</template>
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

        <div v-if="biomeFocus && biomeAreas.length" class="card block">
          <h3>
            {{ biomeZh(biomeFocus) }}
            <span class="dim small">{{ biomeAreas.length }} {{ t('个地区') }}</span>
          </h3>
          <p class="dim small">{{ t('地图表里属于这个生态的地区,按社区跑图评分排。') }}</p>
          <div class="area-list">
            <button v-for="a in biomeAreas" :key="a.code ?? a.name" class="area-row" @click="showOnMapPage">
              <span class="area-name">{{ a.name }}</span>
              <span class="dim small">{{ a.layout === 'unknown' ? '—' : t(LAYOUT_LABEL[a.layout]) }}</span>
              <span class="dim small">{{ a.navigation == null ? '' : '★'.repeat(a.navigation) }}</span>
              <span
                v-if="measuredBadgeFor(a.code)"
                class="meas"
                :title="t('本场实测:只有记账过的收益才会出现在这里。')"
              >
                {{ measuredBadgeFor(a.code) }}
              </span>
            </button>
          </div>
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
              <span class="node-name">{{ zhName(n.name) ?? n.name }}</span>
              <span v-if="allocated.has(n.hash)" class="tick">✓</span>
            </button>
            <p v-if="focusNodes.length === 0" class="dim small">{{ t('没有匹配的节点。') }}</p>
          </div>
        </div>

        <TabletsCard :subtree-rank="subtreeRank" />
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
.filter.jump {
  color: #7aa5d9;
  border-color: #2c4258;
}
.filter.jump:hover {
  color: #e8b04b;
  border-color: #e8b04b;
}
.area-list {
  overflow-y: auto;
  max-height: 180px;
}
.area-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
  background: none;
  border: none;
  border-bottom: 1px solid #141826;
  color: #cfd4e4;
  font-size: 12px;
  padding: 4px;
  cursor: pointer;
  text-align: left;
}
.area-row:hover {
  background: #141826;
}
.area-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* The session's own measurement, same green the map page uses. The sidebar is
   narrow, so the badge takes a line of its own rather than squeezing the name. */
.area-row .meas {
  flex-basis: 100%;
  text-align: right;
  color: #7ee0a3;
  white-space: nowrap;
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
/* 新投入的节点闪一下:总览缩放下连线很细,不闪根本看不出刚才那次点击改了哪。 */
circle.fresh {
  animation: fresh-pulse 1s ease-out;
}
@keyframes fresh-pulse {
  0% {
    stroke: #ffffff;
    stroke-width: 6;
    fill-opacity: 1;
  }
  60% {
    stroke: #ffffff;
    stroke-width: 3;
  }
  100% {
    stroke-width: 1.2;
  }
}
.node.hit > :first-child {
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

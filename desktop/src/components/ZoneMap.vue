<script lang="ts">
// Module-scope so every map instance on the page gets a unique filter-id suffix.
let uidSeed = 0
</script>

<script setup lang="ts">
/**
 * Schematic zone map for the campaign guide, drawn in the official map-screen
 * style: dark ink sea, hand-inked coastline (feTurbulence displacement wobble),
 * parchment grain on the land, a glowing gold route line, an ornate compass
 * rose and corner brackets. Still a pattern sketch — shapes repeat run to run,
 * the game's own assembly does not — so the data file (campaign-maps.json)
 * carries a spec per zone.
 *
 * Because seeds mostly rotate / mirror / swap-entrances the same pattern, the
 * map is adjustable: rotate in 90° steps, mirror horizontally, and drop a
 * "you are here" marker by clicking. Zones with genuinely different layouts
 * carry altLayouts and get switchable tabs. Per-zone view state persists to
 * localStorage when `mapKey` is provided.
 */
import { computed, ref, watch } from 'vue'
import { t } from '../i18n'

export interface ZoneMapSpot {
  x: number
  y: number
  k: string
  l?: string
}

export interface ZoneMapVariant {
  name: string
  outline: [number, number][]
  spots: ZoneMapSpot[]
  path?: [number, number][]
}

export interface ZoneMapSpec {
  outline: [number, number][]
  spots: ZoneMapSpot[]
  path?: [number, number][]
  conf?: string
  variants?: string
  altLayouts?: ZoneMapVariant[]
}

const props = defineProps<{
  spec: ZoneMapSpec
  labels?: boolean
  /** Show rotate/mirror/marker controls and switchable layout tabs. */
  interactive?: boolean
  /** Stable id (act:zone) used to persist the view state. */
  mapKey?: string
}>()

// unique suffix for filter/gradient ids — several maps share one document
const uid = `zm${++uidSeed}`

const COLORS: Record<string, string> = {
  start: '#7dd087',
  exit: '#e8b04b',
  wp: '#7aa5d9',
  boss: '#e06060',
  opt: '#b39ae8',
  event: '#d9a441',
  camp: '#6dc5b8',
  trial: '#b39ae8',
}

const KIND_ZH: Record<string, string> = {
  start: '入口',
  exit: '出口',
  wp: '传送点',
  boss: '首领',
  opt: '可选',
  event: '任务',
  camp: '营地',
  trial: '试炼',
}

// ------------------------------------------------------------------ view state

const rot = ref(0) // 0..3, 90° CW per step
const flip = ref(false)
const marker = ref<[number, number] | null>(null) // stored in map space
const altIdx = ref(0)

const STORE_PREFIX = 'poe2coach.mapview:'

function loadState() {
  rot.value = 0
  flip.value = false
  marker.value = null
  altIdx.value = 0
  if (!props.mapKey) return
  try {
    const raw = localStorage.getItem(STORE_PREFIX + props.mapKey)
    if (!raw) return
    const s = JSON.parse(raw)
    rot.value = s.r ?? 0
    flip.value = !!s.f
    altIdx.value = s.v ?? 0
    marker.value = Array.isArray(s.m) ? s.m : null
  } catch {
    /* corrupted state falls back to defaults */
  }
}

watch(() => props.mapKey, loadState, { immediate: true })

watch([rot, flip, marker, altIdx], () => {
  if (!props.mapKey) return
  try {
    localStorage.setItem(
      STORE_PREFIX + props.mapKey,
      JSON.stringify({ r: rot.value, f: flip.value, v: altIdx.value, m: marker.value }),
    )
  } catch {
    /* storage full / unavailable — view state just won't persist */
  }
})

function spin(dir: 1 | -1) {
  rot.value = (rot.value + dir + 4) % 4
}

function resetView() {
  rot.value = 0
  flip.value = false
  marker.value = null
}

// ------------------------------------------------------------------ geometry

/** The layout currently on display (base spec or an alt layout). */
const geo = computed(() => {
  const alt = props.spec.altLayouts?.[altIdx.value]
  if (alt) return { outline: alt.outline, spots: alt.spots, path: alt.path ?? [] }
  return {
    outline: props.spec.outline,
    spots: props.spec.spots,
    path: props.spec.path ?? [],
  }
})

/** Rotate 90° CW steps around the canvas centre (screen coords, y down). */
function rot90(p: [number, number], steps: number): [number, number] {
  const [x, y] = p
  const cx = 50
  const cy = 35
  let dx = x - cx
  let dy = y - cy
  for (let i = 0; i < steps; i++) {
    const nd = -dy
    dy = dx
    dx = nd
  }
  return [cx + dx, cy + dy]
}

/** Transformed (flip → rotate) raw points of everything, un-fitted. */
function rawTransformed(): [number, number][] {
  const pts: [number, number][] = [
    ...geo.value.outline,
    ...geo.value.path,
    ...geo.value.spots.map((s) => [s.x, s.y] as [number, number]),
  ]
  return pts.map((p) => rot90(flip.value ? [100 - p[0], p[1]] : p, rot.value))
}

/** Fit scale so rotated geometry stays inside the 100x70 canvas. */
function fitScale(): number {
  const pts = rawTransformed()
  if (!pts.length) return 1
  let minX = 100
  let maxX = 0
  let minY = 70
  let maxY = 0
  for (const [x, y] of pts) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return Math.min(92 / (maxX - minX || 1), 62 / (maxY - minY || 1), 1)
}

/** Full map-space → view-space transform (flip, rotate, fit). */
function tv(p: [number, number]): [number, number] {
  const s = fitScale()
  const [x, y] = rot90(flip.value ? [100 - p[0], p[1]] : p, rot.value)
  const pts = rawTransformed()
  let minX = 100
  let maxX = 0
  let minY = 70
  let maxY = 0
  for (const [qx, qy] of pts) {
    if (qx < minX) minX = qx
    if (qx > maxX) maxX = qx
    if (qy < minY) minY = qy
    if (qy > maxY) maxY = qy
  }
  return [(x - (minX + maxX) / 2) * s + 50, (y - (minY + maxY) / 2) * s + 35]
}

function fmt(p: [number, number]): string {
  return `${p[0].toFixed(1)},${p[1].toFixed(1)}`
}

const polygon = computed(() => geo.value.outline.map((p) => fmt(tv(p))).join(' '))

/** Inner "cartography" line: outline pulled toward the centroid. */
const innerPolygon = computed(() => {
  const pts = geo.value.outline.map(tv)
  const cx = pts.reduce((s, p) => s + p[0], 0) / (pts.length || 1)
  const cy = pts.reduce((s, p) => s + p[1], 0) / (pts.length || 1)
  return pts.map((p) => fmt([cx + (p[0] - cx) * 0.9, cy + (p[1] - cy) * 0.9])).join(' ')
})

const routePoints = computed(() => geo.value.path.map((p) => fmt(tv(p))).join(' '))

const placedSpots = computed(() =>
  geo.value.spots.map((s) => {
    const [vx, vy] = tv([s.x, s.y])
    return { ...s, vx, vy }
  }),
)

const markerView = computed(() => (marker.value ? tv(marker.value) : null))

function color(k: string): string {
  return COLORS[k] ?? '#9aa3bd'
}

function isDiamond(k: string): boolean {
  return k === 'opt' || k === 'event'
}

/** Label placement: right of the dot by default, mirrored near the right edge. */
function labelAnchor(x: number): string {
  return x > 68 ? 'end' : 'start'
}

function labelX(x: number): number {
  return x > 68 ? x - 3.4 : x + 3.4
}

// ------------------------------------------------------------------ marker drop

const svgEl = ref<SVGSVGElement | null>(null)

function onMapClick(e: MouseEvent) {
  if (!props.interactive || !svgEl.value) return
  const rect = svgEl.value.getBoundingClientRect()
  const vx = ((e.clientX - rect.left) / rect.width) * 100
  const vy = ((e.clientY - rect.top) / rect.height) * 70
  // invert fit → rotate → flip to get back to map space
  const s = fitScale()
  const pts = rawTransformed()
  let minX = 100
  let maxX = 0
  let minY = 70
  let maxY = 0
  for (const [qx, qy] of pts) {
    if (qx < minX) minX = qx
    if (qx > maxX) maxX = qx
    if (qy < minY) minY = qy
    if (qy > maxY) maxY = qy
  }
  const rx = (vx - 50) / s + (minX + maxX) / 2
  const ry = (vy - 35) / s + (minY + maxY) / 2
  const ur = rot90([rx, ry], 4 - rot.value)
  marker.value = flip.value ? [100 - ur[0], ur[1]] : ur
}

function clearMarker() {
  marker.value = null
}
</script>

<template>
  <div class="zmap" :class="{ interactive }">
    <!-- switchable tabs for zones with genuinely different layouts -->
    <div v-if="interactive && spec.altLayouts?.length" class="alt-tabs">
      <button
        v-for="(a, i) in spec.altLayouts"
        :key="i"
        class="alt-tab"
        :class="{ on: i === altIdx }"
        @click="altIdx = i; marker = null"
      >
        {{ t(a.name) }}
      </button>
    </div>
    <svg
      ref="svgEl"
      class="zmap-svg"
      viewBox="0 0 100 70"
      xmlns="http://www.w3.org/2000/svg"
      @click="onMapClick"
    >
      <defs>
        <!-- hand-inked wobble for coastlines -->
        <filter :id="`wobble-${uid}`" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.055" numOctaves="2" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <!-- soft glow for the route and key markers -->
        <filter :id="`glow-${uid}`" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="1.1" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <!-- parchment grain, tinted warm and mostly transparent -->
        <filter :id="`grain-${uid}`" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="11" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.85  0 0 0 0 0.78  0 0 0 0 0.58  0 0 0 0.07 0"
          />
        </filter>
        <radialGradient :id="`land-${uid}`" cx="50%" cy="42%" r="72%">
          <stop offset="0%" stop-color="#1d2434" />
          <stop offset="100%" stop-color="#121724" />
        </radialGradient>
        <radialGradient :id="`vign-${uid}`" cx="50%" cy="46%" r="76%">
          <stop offset="0%" stop-color="#000000" stop-opacity="0" />
          <stop offset="70%" stop-color="#000000" stop-opacity="0" />
          <stop offset="100%" stop-color="#000000" stop-opacity="0.42" />
        </radialGradient>
        <clipPath :id="`clip-${uid}`">
          <polygon :points="polygon" />
        </clipPath>
      </defs>

      <!-- ink sea -->
      <rect width="100" height="70" fill="#0b0e15" />
      <rect width="100" height="70" :filter="`url(#grain-${uid})`" opacity="0.55" />

      <!-- landmass: glowing coast, hand-inked -->
      <g :filter="`url(#wobble-${uid})`">
        <polygon :points="polygon" fill="none" stroke="#aeb8cf" stroke-width="2.4" opacity="0.22" />
        <polygon :points="polygon" :fill="`url(#land-${uid})`" stroke="#98a3bc" stroke-width="1.5" opacity="0.95" />
        <polygon :points="innerPolygon" fill="none" stroke="#6a7690" stroke-width="0.6" opacity="0.5" />
      </g>
      <!-- parchment grain clipped to the land -->
      <rect width="100" height="70" :filter="`url(#grain-${uid})`" :clip-path="`url(#clip-${uid})`" opacity="0.9" />

      <!-- compass rose, fixed to the screen like the sheet it is printed on -->
      <g class="rose" transform="translate(90,10.5)">
        <circle r="5.8" fill="none" stroke="#c9a86a" stroke-width="0.45" opacity="0.85" />
        <circle r="3.2" fill="none" stroke="#c9a86a" stroke-width="0.3" opacity="0.5" />
        <path d="M0,-5.2 L1.1,0 L0,5.2 L-1.1,0 Z" fill="#c9a86a" opacity="0.9" />
        <path d="M-5.2,0 L0,1.1 L5.2,0 L0,-1.1 Z" fill="#c9a86a" opacity="0.55" />
        <path d="M0,-3.4 L0.8,0 L0,3.4 L-0.8,0 Z" transform="rotate(45)" fill="#c9a86a" opacity="0.45" />
        <circle r="0.8" fill="#0b0e15" stroke="#c9a86a" stroke-width="0.4" />
        <text y="-7" text-anchor="middle" class="rose-n">N</text>
      </g>

      <!-- suggested run order: glowing gold route, drawn under the markers -->
      <polyline
        v-if="routePoints"
        class="route"
        :points="routePoints"
        fill="none"
        :stroke="'#e2b45f'"
        stroke-width="1.25"
        stroke-dasharray="2.8 2"
        stroke-linecap="round"
        stroke-linejoin="round"
        opacity="0.9"
        :filter="`url(#glow-${uid})`"
      />

      <g v-for="(s, i) in placedSpots" :key="i">
        <!-- exit: ring with a core dot, so it reads as "go here next" -->
        <template v-if="s.k === 'exit'">
          <circle
            :cx="s.vx" :cy="s.vy" r="2.9"
            fill="#0b0e15" stroke="#e8b04b" stroke-width="1.2"
            :filter="`url(#glow-${uid})`"
          />
          <circle :cx="s.vx" :cy="s.vy" r="1.1" fill="#e8b04b" />
        </template>
        <!-- trials: hollow ring -->
        <template v-else-if="s.k === 'trial'">
          <circle :cx="s.vx" :cy="s.vy" r="2.7" fill="none" stroke="#b39ae8" stroke-width="1.2" />
        </template>
        <!-- optional loot / quest events: diamonds -->
        <template v-else-if="isDiamond(s.k)">
          <rect
            :x="s.vx - 2.1"
            :y="s.vy - 2.1"
            width="4.2"
            height="4.2"
            :fill="color(s.k)"
            :transform="`rotate(45 ${s.vx} ${s.vy})`"
          />
        </template>
        <!-- camp: square -->
        <template v-else-if="s.k === 'camp'">
          <rect :x="s.vx - 2.4" :y="s.vy - 2.4" width="4.8" height="4.8" rx="1" fill="#6dc5b8" />
        </template>
        <!-- boss: bigger dot with glow -->
        <template v-else-if="s.k === 'boss'">
          <circle
            :cx="s.vx" :cy="s.vy" r="3.1"
            fill="#e06060" stroke="#7d2f2f" stroke-width="0.8"
            :filter="`url(#glow-${uid})`"
          />
        </template>
        <!-- plain dots: start / wp -->
        <template v-else>
          <circle :cx="s.vx" :cy="s.vy" r="2.2" :fill="color(s.k)" />
        </template>

        <text
          v-if="labels && s.l"
          :x="labelX(s.vx)"
          :y="s.vy + 1.2"
          :text-anchor="labelAnchor(s.vx)"
          class="map-label"
        >
          {{ t(s.l) }}
        </text>
        <title v-if="s.l">{{ t(s.l) }} · {{ t(KIND_ZH[s.k] ?? s.k) }}</title>
      </g>

      <!-- you-are-here marker, drawn last -->
      <g v-if="markerView">
        <circle
          :cx="markerView[0]"
          :cy="markerView[1]"
          r="2.7"
          fill="#5db3ff"
          stroke="#0b0e15"
          stroke-width="0.7"
          class="pulse"
          :filter="`url(#glow-${uid})`"
        />
        <text
          v-if="labels"
          :x="labelX(markerView[0])"
          :y="markerView[1] + 1.2"
          :text-anchor="labelAnchor(markerView[0])"
          class="map-label you"
        >
          你
        </text>
      </g>

      <!-- vignette + ornate corner brackets, printed on the sheet -->
      <rect width="100" height="70" :fill="`url(#vign-${uid})`" pointer-events="none" />
      <g class="brackets" pointer-events="none">
        <path d="M3,11 L3,5 Q3,3 5,3 L11,3" />
        <path d="M89,3 L95,3 Q97,3 97,5 L97,11" />
        <path d="M97,59 L97,65 Q97,67 95,67 L89,67" />
        <path d="M11,67 L5,67 Q3,67 3,65 L3,59" />
      </g>
    </svg>
    <!-- view controls: rotate / mirror / reset / clear marker -->
    <div v-if="interactive" class="viewbar">
      <button :title="t('逆时针旋转 90°')" @click="spin(-1)">⟲</button>
      <button :title="t('顺时针旋转 90°')" @click="spin(1)">⟳</button>
      <button :title="t('左右镜像')" :class="{ on: flip }" @click="flip = !flip">⇋</button>
      <button v-if="marker" :title="t('清除当前位置标记')" @click="clearMarker">⌖</button>
      <button v-if="rot || flip || marker" :title="t('恢复原图')" @click="resetView">✕</button>
      <span class="hint dim">{{ t('点图标记当前位置 · 旋转对齐实际种子') }}</span>
    </div>
  </div>
</template>

<style scoped>
.zmap {
  width: 100%;
}
.zmap.interactive {
  cursor: crosshair;
}
.zmap-svg {
  display: block;
  width: 100%;
  height: auto;
  border: 1px solid #2a3040;
  border-radius: 4px;
  background: #0b0e15;
}
.rose-n {
  font-size: 3.6px;
  fill: #c9a86a;
  font-family: Georgia, 'Times New Roman', serif;
}
.map-label {
  font-size: 3.5px;
  font-family: 'KaiTi', 'STKaiti', 'DFKai-SB', 'BiauKai', serif;
  fill: #ded6bd;
  paint-order: stroke;
  stroke: #0a0c12;
  stroke-width: 0.65px;
  stroke-linejoin: round;
}
.map-label.you {
  fill: #8ec7ff;
  font-weight: 700;
}
.brackets path {
  fill: none;
  stroke: #c9a86a;
  stroke-width: 0.55;
  opacity: 0.65;
}
.alt-tabs {
  display: flex;
  gap: 6px;
  padding: 0 2px 6px;
}
.alt-tab {
  background: #1a1f2c;
  border: 1px solid #2c3244;
  color: #9aa3bd;
  border-radius: 6px;
  padding: 2px 10px;
  font-size: 11px;
  cursor: pointer;
}
.alt-tab.on {
  border-color: #e8b04b;
  color: #e8b04b;
  background: #1f1a10;
}
.viewbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 2px 0;
}
.viewbar button {
  width: 26px;
  height: 22px;
  background: #1a1f2c;
  border: 1px solid #2c3244;
  color: #9aa3bd;
  border-radius: 5px;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}
.viewbar button:hover,
.viewbar button.on {
  border-color: #e8b04b;
  color: #e8b04b;
}
.viewbar .hint {
  font-size: 10px;
  margin-left: auto;
}
.pulse {
  animation: zmap-pulse 1.6s ease-in-out infinite;
}
@keyframes zmap-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}
</style>

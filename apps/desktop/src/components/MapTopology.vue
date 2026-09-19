<script lang="ts">
// Module-scope so every instance gets a unique filter-id suffix.
let uidSeed = 0
</script>

<script setup lang="ts">
/**
 * Official-style renderer for the community map topologies (POE2WAY node-link
 * sketches). The shipped SVG strings are parsed into lines and dots once, then
 * redrawn in the campaign-map look: ink background, bronze twin-rail links and
 * colour-coded nodes — green entrance, blue junctions, rare purple specials,
 * red boss with a glow. Node colours are the source drawing's own, so the
 * legend stays honest.
 */
import { computed } from 'vue'
import { t } from '../i18n'

let uid = `mt${++uidSeed}`

interface Pt {
  x: number
  y: number
}

const props = defineProps<{ svg: string; compact?: boolean }>()

interface TopoData {
  links: { a: Pt; b: Pt }[]
  nodes: { p: Pt; r: number; fill: string; kind: string }[]
  w: number
  h: number
}

const cache = new Map<string, TopoData | null>()

function parse(svg: string): TopoData | null {
  if (cache.has(svg)) return cache.get(svg) ?? null
  try {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
    const links: TopoData['links'] = []
    const nodes: TopoData['nodes'] = []
    let xs = Infinity
    let ys = Infinity
    let xe = -Infinity
    let ye = -Infinity
    const grow = (x: number, y: number) => {
      xs = Math.min(xs, x)
      ys = Math.min(ys, y)
      xe = Math.max(xe, x)
      ye = Math.max(ye, y)
    }
    for (const el of Array.from(doc.querySelectorAll('line'))) {
      const a = { x: Number(el.getAttribute('x1')), y: Number(el.getAttribute('y1')) }
      const b = { x: Number(el.getAttribute('x2')), y: Number(el.getAttribute('y2')) }
      if ([a.x, a.y, b.x, b.y].every(Number.isFinite)) {
        links.push({ a, b })
        grow(a.x, a.y)
        grow(b.x, b.y)
      }
    }
    for (const el of Array.from(doc.querySelectorAll('circle'))) {
      const p = { x: Number(el.getAttribute('cx')), y: Number(el.getAttribute('cy')) }
      const r = Number(el.getAttribute('r')) || 3
      const fill = el.getAttribute('fill') ?? '#3b82f6'
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
      const kind = fill === '#10b981' ? 'start' : fill === '#ef4444' ? 'boss' : fill === '#a855f7' || fill === '#eab308' ? 'special' : 'node'
      nodes.push({ p, r, fill, kind })
      grow(p.x, p.y)
    }
    if (!nodes.length && !links.length) {
      cache.set(svg, null)
      return null
    }
    const data: TopoData = { links, nodes, w: Math.max(xe - xs, 1), h: Math.max(ye - ys, 1) }
    cache.set(svg, data)
    return data
  } catch {
    cache.set(svg, null)
    return null
  }
}

const data = computed(() => parse(props.svg))

/** Normalised view: the parsed bounding box mapped into a 100x70 canvas. */
const view = computed(() => {
  const d = data.value
  if (!d) return null
  const pad = 7
  const s = Math.min((100 - pad * 2) / d.w, (70 - pad * 2) / d.h)
  const ox = pad + ((100 - pad * 2) - d.w * s) / 2 - xs0(d) * s
  const oy = pad + ((70 - pad * 2) - d.h * s) / 2 - ys0(d) * s
  function xs0(dd: TopoData) {
    return Math.min(...dd.nodes.map((n) => n.p.x), ...dd.links.map((l) => l.a.x), ...dd.links.map((l) => l.b.x))
  }
  function ys0(dd: TopoData) {
    return Math.min(...dd.nodes.map((n) => n.p.y), ...dd.links.map((l) => l.a.y), ...dd.links.map((l) => l.b.y))
  }
  return {
    s,
    ox,
    oy,
    tp: (p: Pt): [number, number] => [p.x * s + ox, p.y * s + oy],
  }
})

const links = computed(() => {
  const v = view.value
  if (!v) return []
  return data.value!.links.map((l) => {
    const [x1, y1] = v.tp(l.a)
    const [x2, y2] = v.tp(l.b)
    return { x1, y1, x2, y2 }
  })
})

const nodes = computed(() => {
  const v = view.value
  if (!v) return []
  return data.value!.nodes.map((n) => {
    const [cx, cy] = v.tp(n.p)
    // Same scale as the coordinates, clamped for visibility — the source
    // circles keep their drawn proportions instead of dominating the view.
    const base = Math.min(Math.max(n.r * v.s, props.compact ? 1.3 : 1.6), 5.2)
    const r = base + (n.kind === 'boss' ? (props.compact ? 0.4 : 0.7) : n.kind === 'start' ? (props.compact ? 0.2 : 0.4) : 0)
    return { cx, cy, r, fill: n.fill, kind: n.kind }
  })
})
</script>

<template>
  <div class="mtopo" :class="{ compact }">
    <svg v-if="view" class="mt-svg" viewBox="0 0 100 70" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter :id="`glow-${uid}`" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="1.1" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect width="100" height="70" fill="#0b0e15" />
      <g stroke-linecap="round">
        <g>
          <line
            v-for="(l, i) in links"
            :key="`o${i}`"
            :x1="l.x1" :y1="l.y1" :x2="l.x2" :y2="l.y2"
            stroke="#5e5238"
            :stroke-width="compact ? 1.1 : 1.5"
          />
        </g>
        <g>
          <line
            v-for="(l, i) in links"
            :key="`i${i}`"
            :x1="l.x1" :y1="l.y1" :x2="l.x2" :y2="l.y2"
            stroke="#0e0d0a"
            :stroke-width="compact ? 0.4 : 0.55"
          />
        </g>
      </g>
      <g>
        <template v-for="(n, i) in nodes" :key="i">
          <circle
            :cx="n.cx" :cy="n.cy" :r="n.r"
            :fill="n.fill"
            :stroke="'#0b0e15'"
            :stroke-width="0.6"
            :filter="n.kind === 'boss' ? `url(#glow-${uid})` : undefined"
          />
          <circle
            v-if="n.kind === 'start' && !compact"
            :cx="n.cx" :cy="n.cy" :r="n.r + 1.3"
            fill="none"
            stroke="#34d399"
            stroke-width="0.45"
            opacity="0.7"
          />
        </template>
      </g>
    </svg>
    <div v-if="!compact" class="mt-legend dim">
      <span class="lg"><i class="dot" style="background: #10b981" />{{ t('入口') }}</span>
      <span class="lg"><i class="dot" style="background: #3b82f6" />{{ t('节点') }}</span>
      <span class="lg"><i class="dot" style="background: #a855f7" />{{ t('特殊') }}</span>
      <span class="lg"><i class="dot" style="background: #ef4444" />{{ t('Boss') }}</span>
    </div>
  </div>
</template>

<style scoped>
.mtopo {
  width: 100%;
}
.mt-svg {
  display: block;
  width: 100%;
  height: auto;
  border: 1px solid #1d2331;
  border-radius: 6px;
  background: #0b0e15;
}
.mt-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin-top: 8px;
  font-size: 11px;
  color: #9aa3bd;
}
.lg {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
</style>

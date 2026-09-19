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
  /**
   * The class start node. It anchors the highlighted path even though a build's
   * node list usually does not mention it — the game always has it allocated.
   */
  startNode?: number | null
  /**
   * `null` leaves the canvas transparent, for the overlay, where the game's own
   * tree shows through underneath.
   */
  background?: string | null
  /**
   * Node id -> the step it is taken at in the leveling order. Drawn as a number
   * on the node, which is what turns the overlay from "these are your targets"
   * into "click this one next".
   */
  order?: Map<number, number>
  /**
   * Frame the view on these nodes instead of on everything drawn. The overlay
   * uses it to show only the region the selection sits in, which is what lets it
   * be a small card: there is nothing to line up with the game, so it does not
   * have to be the whole tree.
   */
  fitTo?: Set<number> | null
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
  /**
   * Bounding-box centre, not the mean of the node positions: a cluster is
   * denser on one side, and the mean would sit off-centre in the hole by
   * however much it is.
   */
  centre: Pt
  /** Distance from {@link centre} to the cluster's furthest node. */
  radius: number
  /** The ascendancy's own entry node, whose state lights the cluster's plate. */
  startId: number | null
}

let art: TreeArt | null = null
interface PreparedLineEdge {
  kind: 'line'
  a: number
  b: number
}

interface PreparedArcEdge {
  kind: 'arc'
  a: number
  b: number
  cx: number
  cy: number
  radius: number
  startAngle: number
  endAngle: number
  counterclockwise: boolean
}

type PreparedEdge = PreparedLineEdge | PreparedArcEdge

let preparedEdges: PreparedEdge[] = []
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
  // The tree data has no isMastery flag — a mastery is the one kind carrying
  // an activeEffectImage without being a notable or keystone.
  const isMastery = !!h.node.activeEffectImage && !h.node.isNotable && !h.node.isKeystone
  const kind = t(
    h.node.isKeystone
      ? '核心天赋 Keystone'
      : h.node.isNotable
        ? '显著天赋 Notable'
        : h.node.ascendancyName
          ? '升华天赋 Ascendancy'
          : isMastery
            ? '专精 Mastery'
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
  const starts = new Map<string, number>()
  for (const [id, xy] of Object.entries(TREE_GEOMETRY.positions)) {
    const nodeId = Number(id)
    const node = props.tree.nodes[nodeId]
    if (!node) continue
    const point = { x: xy[0], y: xy[1] }
    if (node.ascendancyName) {
      const list = clustersByName.get(node.ascendancyName)
      if (list) list.push(point)
      else clustersByName.set(node.ascendancyName, [point])
      if (node.isAscendancyStart) starts.set(node.ascendancyName, nodeId)
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
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of points) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
    const centre = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
    const radius = points.reduce((best, p) => Math.max(best, Math.hypot(p.x - centre.x, p.y - centre.y)), 0)
    clusters.set(name, { centre, radius, startId: starts.get(name) ?? null })
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

  /*
   * Only nodes that will actually be drawn get a position. That matters beyond
   * this map: the edge list is filtered against it below, and the ascendancy
   * clusters that are not selected sit ~17000 units out, so leaving them in drew
   * connections out into empty space with nothing at the far end.
   */
  positions = new Map()
  const inBounds = new Set<number>()
  for (const [id, xy] of Object.entries(TREE_GEOMETRY.positions)) {
    const nodeId = Number(id)
    const node = props.tree.nodes[nodeId]
    if (!node) continue
    const selected = !!node.ascendancyName && node.ascendancyName === props.ascendancy
    if (node.ascendancyName && !selected) continue
    let point = { x: xy[0], y: xy[1] }
    if (selected && wanted) {
      point = {
        x: mainCentre.x + (point.x - wanted.centre.x) * ascScale,
        y: mainCentre.y + (point.y - wanted.centre.y) * ascScale,
      }
    }
    inBounds.add(nodeId)
    positions.set(nodeId, point)
  }

  edges = []
  preparedEdges = []
  for (const rawEdge of TREE_GEOMETRY.edges) {
    const from = Number(rawEdge[0])
    const to = Number(rawEdge[1])
    if (!positions.has(from) || !positions.has(to)) continue
    // A class start connects straight to its ascendancy's start node, but the
    // two trees are separate and no character walks between them — and now that
    // the cluster sits in the middle, such a link would be a long line running
    // from the main tree into the centre for no reason.
    if ((props.tree.nodes[from]?.ascendancyName ?? null) !== (props.tree.nodes[to]?.ascendancyName ?? null)) continue
    edges.push([from, to])

    const pa = positions.get(from)!
    const pb = positions.get(to)!
    const isArc = rawEdge.length >= 5 && rawEdge[2] != null && (rawEdge[2] as number) > 0
    if (isArc) {
      let ox = rawEdge[3] as number
      let oy = rawEdge[4] as number
      if (wanted && props.tree.nodes[from]?.ascendancyName === props.ascendancy) {
        ox = mainCentre.x + (ox - wanted.centre.x) * ascScale
        oy = mainCentre.y + (oy - wanted.centre.y) * ascScale
      }
      const radius = Math.hypot(pa.x - ox, pa.y - oy)
      if (radius > 1) {
        const a1 = Math.atan2(pa.y - oy, pa.x - ox)
        const a2 = Math.atan2(pb.y - oy, pb.x - ox)
        let diff = (a2 - a1) % (Math.PI * 2)
        if (diff <= -Math.PI) diff += Math.PI * 2
        else if (diff > Math.PI) diff -= Math.PI * 2
        preparedEdges.push({
          kind: 'arc',
          a: from,
          b: to,
          cx: ox,
          cy: oy,
          radius,
          startAngle: a1,
          endAngle: a2,
          counterclockwise: diff < 0,
        })
        continue
      }
    }

    preparedEdges.push({
      kind: 'line',
      a: from,
      b: to,
    })
  }

  // Frame the main tree plus the relocated cluster. Every other ascendancy
  // cluster stays parked ~17000 units out, and letting those into the bounds is
  // what used to shrink the tree to half the canvas.
  //
  // `fitTo` narrows that to a set of nodes, padded so the outermost ones are
  // not flush against the edge.
  const framed = props.fitTo && props.fitTo.size > 0 ? new Set([...props.fitTo].filter((id) => inBounds.has(id))) : null
  const framing = framed && framed.size > 0 ? framed : inBounds
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const id of framing) {
    const p = positions.get(id)!
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }

  if (framed) {
    // One node's own width, so a single selected node is centred rather than
    // filling the card with its own edge.
    const pad = 220
    minX -= pad
    minY -= pad
    maxX += pad
    maxY += pad
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
 * Nodes that are allocated merely by existing: the class start, and the start
 * node of the ascendancy the character has taken. The game charges nothing for
 * either and neither can be un-allocated, so both are always lit and both anchor
 * their own tree's path.
 */
const implicitIds = computed(() => {
  const ids = new Set<number>()
  if (props.startNode != null) ids.add(props.startNode)
  const cluster = props.ascendancy ? clusters.get(props.ascendancy) : undefined
  if (cluster?.startId != null) ids.add(cluster.startId)
  return ids
})

/**
 * Four visual states, because the tree answers two different questions: which
 * nodes this build wants (`active`), and which of them are already taken
 * (`progress`). Frames only ship unallocated / canAllocate / allocated, so
 * both "next up" and "wanted later" wear the highlighted frame and are told
 * apart by the glow.
 */
function stateOf(node: TreeNode): NodeState {
  if (props.progress?.has(node.id) || implicitIds.value.has(node.id)) return 'allocated'
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
  const background = props.background === undefined ? '#080a0f' : props.background
  if (background) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, w, h)
  }

  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * panX, dpr * panY)

  const progress = props.progress ?? new Set<number>()
  const index = art?.index

  // Viewport in world units, so both layers can skip what is off screen.
  const viewMinX = -panX / scale
  const viewMinY = -panY / scale
  const viewMaxX = (w - panX) / scale
  const viewMaxY = (h - panY) / scale

  // ---- the ascendancy cluster's plate ------------------------------------
  // The relocated cluster sits on the atlas's main circle, sized to the empty
  // centre rather than to the art's own 4000 units, which would spill over the
  // innermost main-tree nodes.
  if (placedCluster && index && Number.isFinite(holeRadius)) {
    const disc = index.groups.circle
    const discActive = index.groups.circleActive
    if (disc) {
      // The lit plate belongs to an ascendancy the character has actually taken.
      const taken = placedCluster.startId != null && progress.has(placedCluster.startId)
      const wanted = taken && discActive ? discActive : disc
      const image = art?.images['group-background']
      const size = holeRadius * 2
      if (image) {
        ctx.drawImage(
          image,
          wanted.x,
          wanted.y,
          wanted.w,
          wanted.h,
          mainCentre.x - size / 2,
          mainCentre.y - size / 2,
          size,
          size,
        )
      }
    }
  }

  // ---- connections -------------------------------------------------------
  // Two kinds of link, as the game has them. Nodes sharing an orbit are joined
  // by the ring art; everything else by a straight connector band.
  //
  // The path taken and the path this build wants both draw with the lit art;
  // without it a hand-picked tree shows its nodes ringed in gold but no route
  // between them, which is the one thing the rings are there to let you trace.
  //
  /** Lit but a touch softer, so "still to take" reads apart from "already taken". */
  const WANTED_ALPHA = 0.82
  // The class start and the ascendancy start are always allocated in game,
  // whether or not the build's node list mentions them, so they anchor the
  // highlight on their own.
  const implicit = implicitIds.value
  const taken = (id: number) => progress.has(id) || implicit.has(id)
  const wanted = (id: number) => props.active.has(id) || implicit.has(id)
  /**
   * Which tree a node belongs to. A class start connects straight to its
   * ascendancy's start node — the Witch start has six such links — but no
   * character can walk that link, so it must never light up as part of a path.
   */
  const treeOf = (id: number) => props.tree.nodes[id]?.ascendancyName ?? null

  const inView = (edge: PreparedEdge) => {
    if (edge.kind === 'line') {
      const pa = positions.get(edge.a)!
      const pb = positions.get(edge.b)!
      return !(
        (pa.x < viewMinX && pb.x < viewMinX) ||
        (pa.x > viewMaxX && pb.x > viewMaxX) ||
        (pa.y < viewMinY && pb.y < viewMinY) ||
        (pa.y > viewMaxY && pb.y > viewMaxY)
      )
    } else {
      return !(
        edge.cx + edge.radius < viewMinX ||
        edge.cx - edge.radius > viewMaxX ||
        edge.cy + edge.radius < viewMinY ||
        edge.cy - edge.radius > viewMaxY
      )
    }
  }

  function addEdgeToPath(path: Path2D, edge: PreparedEdge) {
    if (edge.kind === 'line') {
      const pa = positions.get(edge.a)!
      const pb = positions.get(edge.b)!
      path.moveTo(pa.x, pa.y)
      path.lineTo(pb.x, pb.y)
    } else {
      path.moveTo(
        edge.cx + edge.radius * Math.cos(edge.startAngle),
        edge.cy + edge.radius * Math.sin(edge.startAngle),
      )
      path.arc(edge.cx, edge.cy, edge.radius, edge.startAngle, edge.endAngle, edge.counterclockwise)
    }
  }

  const normalPath = new Path2D()
  const wantedPath = new Path2D()
  const takenPath = new Path2D()

  let hasNormal = false
  let hasWanted = false
  let hasTaken = false

  for (const edge of preparedEdges) {
    if (!inView(edge)) continue
    const sameTree = treeOf(edge.a) === treeOf(edge.b)
    const onTaken = sameTree && taken(edge.a) && taken(edge.b)
    const onWanted = sameTree && !onTaken && wanted(edge.a) && wanted(edge.b)
    if (onTaken) {
      addEdgeToPath(takenPath, edge)
      hasTaken = true
    } else if (onWanted) {
      addEdgeToPath(wantedPath, edge)
      hasWanted = true
    } else {
      addEdgeToPath(normalPath, edge)
      hasNormal = true
    }
  }

  // Width in tree coordinates. When zoomed far out, scale up slightly so lines don't vanish into sub-pixel dust.
  const baseThick = 14
  const drawWidth = Math.max(baseThick, 1.8 / scale)
  const drawGap = Math.max(5.5, drawWidth * 0.42)

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // 1. Normal unallocated paths: twin bronze rails with dark inner channel
  if (hasNormal) {
    ctx.lineWidth = drawWidth
    ctx.strokeStyle = '#625232'
    ctx.stroke(normalPath)

    ctx.lineWidth = drawGap
    ctx.strokeStyle = '#0e0d0a'
    ctx.stroke(normalPath)
  }

  // 2. Wanted / planned paths: warm gold twin rails
  if (hasWanted) {
    ctx.save()
    ctx.globalAlpha = WANTED_ALPHA
    ctx.lineWidth = drawWidth
    ctx.strokeStyle = '#d4a23f'
    ctx.stroke(wantedPath)

    ctx.lineWidth = drawGap
    ctx.strokeStyle = '#fff0ba'
    ctx.stroke(wantedPath)
    ctx.restore()
  }

  // 3. Taken / allocated paths: brilliant glowing gold
  if (hasTaken) {
    ctx.lineWidth = drawWidth
    ctx.strokeStyle = '#fcde86'
    ctx.stroke(takenPath)

    ctx.lineWidth = drawGap
    ctx.strokeStyle = '#fffbe8'
    ctx.stroke(takenPath)
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

  // Mastery patterns are the client's background flourish: a swirl much larger
  // than the node itself that sits UNDER everything — the official layout even
  // parks some masteries directly under a notable's ring. Draw every pattern
  // before any node so that layering holds, dimmed by allocation state.
  const MASTERY_FLOURISH = 220
  for (const { node, pos } of ordered) {
    if (!node.activeEffectImage) continue
    const rect = index?.masteries[node.activeEffectImage]
    if (!rect) continue
    const half = MASTERY_FLOURISH / 2
    if (pos.x + half < viewMinX || pos.x - half > viewMaxX || pos.y + half < viewMinY || pos.y - half > viewMaxY)
      continue
    const state = stateOf(node)
    ctx.save()
    ctx.globalAlpha = state === 'allocated' ? 0.42 : state === 'canAllocate' ? 0.46 : state === 'planned' ? 0.3 : 0.18
    blit(ctx, 'mastery-effect-active', rect, pos.x, pos.y, MASTERY_FLOURISH)
    ctx.restore()
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

    // Ascendancy nodes sit on a plate the plain frames do not have, drawn at the
    // size it was authored for.
    const backing = index?.frames[`${kindName}.backing`]
    if (backing) {
      blit(ctx, 'frame', backing, pos.x, pos.y, (index?.drawFrame[`${kindName}.backing`] ?? frameSize) * shrink)
    }

    /*
     * Icon first, frame over it, and the icon masked to a circle.
     *
     * The node art in the atlas is square — 34, 49 and 68 pixel boxes whose
     * corners are opaque — so drawing it at its own size lets those corners
     * cross the ring. The game shows a disc, so the icon is clipped to one and
     * the frame is then laid on top, which is also what hides the seam.
     *
     * Anything the build wants gets the lit art; only nodes with no part in it
     * stay desaturated. Previously only the leveling-progress set lit up, so a
     * hand-picked tree showed gold rings around grey icons.
     */
    const entry = index?.nodes[node.icon ?? '']?.[kind]
    const lit = state !== 'unallocated'
    // A mastery has no skills-atlas entry; its plate comes from the mastery
    // atlas and is drawn to fill the frame's inner disc, because the art is
    // authored far larger than a node (488 units against a 102-unit frame).
    const mastery = !entry && node.activeEffectImage ? index?.masteries[node.activeEffectImage] : undefined
    /*
     * The icon is sized to the frame's clear aperture, not to the atlas's own
     * icon size: that size is the art's native box, about twice the hole it has
     * to fit through, and drawing at it pushed icons out through the ring. A
     * mastery plate has no separate icon, so it keeps filling the frame.
     */
    const inset = art?.iconInset[`${kindName}.${shape}`]
    const iconSize = (inset ?? drawSize) * shrink
    const discSize = mastery ? frameSize * 0.98 : iconSize
    if (mastery) {
      // Allocated masteries fill their disc brightly; unallocated ones rely on
      // the dim under-layer flourish drawn earlier plus the bare frame.
      if (lit) {
        ctx.save()
        ctx.beginPath()
        ctx.arc(pos.x, pos.y, discSize / 2, 0, Math.PI * 2)
        ctx.clip()
        blit(ctx, 'mastery-effect-active', mastery, pos.x, pos.y, discSize)
        ctx.restore()
      }
    } else if (entry) {
      const iconRect = lit ? entry.allocated : entry.unallocated
      if (iconRect) {
        ctx.save()
        ctx.beginPath()
        ctx.arc(pos.x, pos.y, (discSize / 2) * 0.98, 0, Math.PI * 2)
        ctx.clip()
        blit(ctx, lit ? 'skills' : 'skills-disabled', iconRect, pos.x, pos.y, discSize)
        ctx.restore()
      }
    }

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

    // Mastery nodes have no entry in this build's atlas, so they keep the bare
    // frame rather than a hole.

    // The allocation order, so the overlay answers "which one next".
    const order = props.order?.get(node.id)
    if (order != null) {
      ctx.font = `600 ${Math.max(9 / scale, drawSize * 0.62)}px 'Segoe UI', sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineWidth = 3 / scale
      ctx.strokeStyle = 'rgba(8,10,15,0.9)'
      ctx.strokeText(String(order), pos.x, pos.y)
      ctx.fillStyle = '#ffd979'
      ctx.fillText(String(order), pos.x, pos.y)
    }
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
        // The official layout stacks some masteries directly under another
        // node's ring; whatever is visible on top should win the hover, so
        // masteries only take the pick when nothing else is as close.
        const node = props.tree.nodes[id]
        const hidden = !!node?.activeEffectImage && !node.isNotable && !node.isKeystone
        const d = (dx * dx + dy * dy) * (hidden ? 2.25 : 1)
        if (d < bestDist) {
          bestDist = d
          best = node ?? null
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

/** A different selection is a different region to frame. */
watch(
  () => props.fitTo,
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

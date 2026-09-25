<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  PobParseError,
  buildLevelingPlan,
  REALM_IDS,
  decodeShareSnapshot,
  extractShareCode,
  isShareCode,
  buildToShareCode,
  countPoints,
  isAscendancy,
  parseItemText,
  parsePobCode,
  QUEST_POINT_TOTAL,
  resolveStartNode,
  strategyBrief,
  validateTreeSelection,
} from '@poe2coach/core'
import type { BuildSnapshot, GameItem, ParsedItem, ShareSnapshot, TreeData } from '@poe2coach/core'
import TreePanel from './components/TreePanel.vue'
import ResistancePanel from './components/ResistancePanel.vue'
import GearPanel from './components/GearPanel.vue'
import LevelingPage from './components/LevelingPage.vue'
import SkillsPanel from './components/SkillsPanel.vue'
import MapsPanel from './components/MapsPanel.vue'
import AtlasPanel from './components/AtlasPanel.vue'
import PricePanel from './components/PricePanel.vue'
import FarmPanel from './components/FarmPanel.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import { loadTree } from './treeData'
import { bilingual, t } from './i18n'
import { addBuild, loadBuilds, removeBuild } from './buildStore'
import type { StoredBuild } from './buildStore'
import {
  addTreePreset,
  loadTreePresets,
  removeTreePreset,
  removeTreeStage,
  upsertTreeStage,
} from './treePresetStore'
import type { StoredTreePreset } from './treePresetStore'
import { treeEdges } from './treeArt'
import { realm, realmId, selectRealm } from './settings'
import { rememberLeague, savedLeague } from './tradeClient'
import { allocated as atlasAllocated, setAllocated as setAtlasAllocated } from './atlasPlan'
import SharePanel from './components/SharePanel.vue'
import StrategyCard from './components/StrategyCard.vue'
import { initCampaignFollow } from './campaignFollow'
import { AREAS, FARMABLE_COUNT as MAP_COUNT } from './mapData'
import { requestAtlasFocus } from './atlasFocus'
import { requestMapFocus } from './mapFocus'
import { ATLAS, ATLAS_INDEX } from './atlasData'
import { isShareUrl, resolveShareLink } from './shareLink'

type View = 'home' | 'tree' | 'gear' | 'skills' | 'leveling' | 'atlas' | 'maps' | 'price' | 'farm' | 'settings'

const NAV: { key: View; label: string; requiresBuild?: boolean }[] = [
  { key: 'home', label: '主页' },
  // Reachable without a build: a tree preset carries its own class, and the
  // page is still browsable read-only.
  { key: 'tree', label: '天赋树' },
  { key: 'gear', label: '装备', requiresBuild: true },
  { key: 'skills', label: '技能', requiresBuild: true },
  { key: 'leveling', label: '升级', requiresBuild: true },
  { key: 'price', label: '查价' },
  // The endgame tree. Build-independent, like the map table it informs.
  { key: 'atlas', label: '异界' },
  { key: 'maps', label: '地图' },
  // Also build-independent: a farming session is about the clock and the book,
  // not about which build is loaded.
  { key: 'farm', label: '刷图' },
  { key: 'settings', label: '设置' },
]

/** The map page asks for a biome; the atlas page picks the request up itself. */
function openAtlas(biome: string) {
  requestAtlasFocus({ biome })
  view.value = 'atlas'
}

/** The strategy card names a mechanic; the atlas page opens with that subtree lit. */
function openAtlasMechanic(id: string) {
  requestAtlasFocus({ subtree: id })
  view.value = 'atlas'
}

const ATLAS_NODES = ATLAS.nodes.length

/** The atlas page asks for a biome; the map page picks the request up itself. */
function openMaps(biome: string) {
  requestMapFocus(biome)
  view.value = 'maps'
}

const tree: TreeData = loadTree()
const view = ref<View>('home')
const codeInput = ref('')
const error = ref<string | null>(null)
const build = ref<BuildSnapshot | null>(null)
const currentPoints = ref<number | null>(null)
const builds = ref<StoredBuild[]>(loadBuilds())

// The campaign guide follows the client log for the app's lifetime; only the
// main window runs it (the overlay windows re-use this entry point).
initCampaignFollow()

const activeSet = computed(() => new Set(build.value?.passiveNodes ?? []))
const gameItems = computed<GameItem[]>(() => (build.value?.items ?? []).map((i) => parseItemText(i.text)))
const plan = computed(() =>
  build.value
    ? buildLevelingPlan(
        tree,
        build.value.passiveNodes,
        resolveStartNode(tree, build.value.className),
        treeEdges(),
      )
    : null,
)
const progressSet = computed(() => {
  const n = currentPoints.value
  if (!plan.value || n == null || n <= 0) return new Set<number>()
  return new Set(plan.value.steps.slice(0, n).map((s) => s.nodeId))
})

const hasBuild = computed(() => !!build.value)

/**
 * The strategy the current Atlas plan implies — what the share code will read as,
 * and what an import just restored. One derivation feeds the home card and the
 * share panel, so the two never tell different stories.
 */
const strategy = computed(() => strategyBrief(ATLAS, ATLAS_INDEX, atlasAllocated.value, AREAS))

/** "中文 English" with the language setting applied; see i18n.ts. */
function bi(en: string | null | undefined, fallback = ''): string {
  return bilingual(en, fallback)
}

const buildTitle = computed(() => {
  const b = build.value
  if (!b) return ''
  const cls = bi(b.className, t('未知'))
  const asc = b.ascendClassName ? ` · ${bi(b.ascendClassName)}` : ''
  return `${cls}${asc} Lv${b.level ?? '?'}`
})

const summary = computed(() => {
  const b = build.value
  if (!b) return null
  return [
    { k: t('职业'), v: bi(b.className, '—') },
    { k: t('升华'), v: bi(b.ascendClassName, '—') },
    { k: t('等级'), v: b.level ?? '—' },
    { k: t('目标树版本'), v: b.treeVersion?.replace('_', '.') ?? '—' },
    { k: t('天赋节点'), v: b.passiveNodes.length },
    { k: t('技能组'), v: b.skills.length },
    { k: t('装备'), v: b.items.length },
  ]
})

const totalGems = computed(() => (build.value?.skills ?? []).reduce((s, g) => s + g.gems.length, 0))

/**
 * Everything a share code carries, read from live state.
 *
 * The session cookie is not here and cannot get here: `ShareSnapshot` has no field
 * for it, so a code can never carry a login out of the app.
 */
const shareSnapshot = computed<ShareSnapshot>(() => ({
  v: 1,
  realm: realmId.value,
  league: savedLeague(),
  level: build.value?.level ?? null,
  className: build.value?.className ?? null,
  ascendClassName: build.value?.ascendClassName ?? null,
  treeVersion: build.value?.treeVersion ?? null,
  passiveNodes: build.value?.passiveNodes ?? [],
  questPoints: questPoints.value,
  atlasNodes: [...atlasAllocated.value],
  items: (build.value?.items ?? []).map((i) => ({ text: i.text, slot: i.slot })),
  skills: (build.value?.skills ?? []).map((g) => ({
    label: g.label,
    gems: g.gems.map((gem) => ({
      name: gem.name,
      level: gem.level ?? null,
      quality: gem.quality ?? null,
      enabled: gem.enabled !== false,
    })),
  })),
}))

/** Items travel as their raw text — the only form that re-parses on the far side. */
function itemFromText(text: string, slot: string | null, id: number): ParsedItem {
  const parsed = parseItemText(text)
  return { id, rarity: parsed.rarity, name: parsed.name, base: parsed.base, itemClass: parsed.itemClass, slot, text }
}

/** Replace the whole setup with what a code carried. */
function applyShare(snapshot: ShareSnapshot) {
  error.value = null
  currentPoints.value = null
  if (snapshot.realm) {
    const known = REALM_IDS.includes(snapshot.realm as (typeof REALM_IDS)[number])
    if (known) selectRealm(snapshot.realm as (typeof REALM_IDS)[number])
  }
  if (snapshot.league) rememberLeague(snapshot.league)
  if (snapshot.questPoints != null) questPoints.value = snapshot.questPoints
  // Only hashes this tree actually has; a code from another patch must not put the
  // planner into a state it cannot draw or validate.
  setAtlasAllocated(snapshot.atlasNodes.filter((h) => ATLAS_INDEX.byHash.has(h)))
  build.value = {
    className: snapshot.className,
    ascendClassName: snapshot.ascendClassName,
    level: snapshot.level,
    treeVersion: snapshot.treeVersion,
    passiveNodes: snapshot.passiveNodes,
    treeSpecUrls: [],
    skills: snapshot.skills.map((g) => ({
      label: g.label,
      gems: g.gems.map((gem) => ({ name: gem.name, level: gem.level, quality: gem.quality, enabled: gem.enabled })),
    })),
    items: snapshot.items.map((item, i) => itemFromText(item.text, item.slot, i + 1)),
  }
  view.value = 'home'
  saveMessage.value = t('已导入分享码。')
}

async function onParse() {
  // The same box takes every shape we hand out: our code (announced by its
  // prefix), the whole strategy-card block (the code is pulled out of the prose),
  // a share link (resolved against the share server), and finally a PoB code.
  // Each branch hands the next one only what it could not read itself.
  const pasted = codeInput.value
  const code = isShareCode(pasted) ? pasted : extractShareCode(pasted)
  if (code) {
    try {
      applyShare(decodeShareSnapshot(code))
      codeInput.value = ''
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
    return
  }
  if (isShareUrl(pasted)) {
    error.value = null
    try {
      const resolved = await resolveShareLink(pasted)
      applyShare(decodeShareSnapshot(resolved))
      codeInput.value = ''
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
    return
  }
  onParsePob()
}

function onParsePob() {
  error.value = null
  try {
    currentPoints.value = null
    build.value = parsePobCode(codeInput.value)
    view.value = 'home'
  } catch (e) {
    build.value = null
    error.value = e instanceof PobParseError ? e.message : String(e)
  }
}

function loadDemo() {
  /*
   * Grow the sample from the Witch's class start, the way a real tree is
   * allocated. Starting from an arbitrary keystone instead — which this used to
   * do — produces a cluster with no route back to the start, and the save-time
   * connectivity check then reports every node as an orphan.
   *
   * The walk uses the official edge list, not `node.connections`: that field is
   * sparsest around the class starts, where a BFS on it alone stalls after a
   * couple dozen nodes and the "sample" comes out a stub.
   */
  const adjacency = new Map<number, number[]>()
  for (const [a, b] of treeEdges()) {
    if (!adjacency.has(a)) adjacency.set(a, [])
    if (!adjacency.has(b)) adjacency.set(b, [])
    adjacency.get(a)!.push(b)
    adjacency.get(b)!.push(a)
  }
  const startNode = resolveStartNode(tree, 'Witch')
  const picked: number[] = []
  const seen = new Set<number>()
  const queue: number[] = [startNode ?? Number(Object.keys(tree.nodes)[0])]
  while (queue.length > 0 && picked.length < 80) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    const node = tree.nodes[id]
    // Ascendancy nodes hang off the start but are bought with trial points, so
    // they stay out of the sample's main-tree budget.
    if (!node || node.isMastery || node.ascendancyName) continue
    seen.add(id)
    picked.push(id)
    for (const next of adjacency.get(id) ?? []) queue.push(next)
  }
  const demo: BuildSnapshot = {
    className: 'Witch',
    ascendClassName: 'Infernalist',
    level: 88,
    treeVersion: '0_5',
    passiveNodes: picked,
    treeSpecUrls: [],
    skills: [
      {
        label: 'Fireball',
        gems: [
          { name: 'Fireball', level: 20, quality: 20, enabled: true },
          { name: 'Concentrated Effect', level: 20, quality: 0, enabled: true },
          { name: 'Arcane Tempo', level: 19, quality: 0, enabled: false },
        ],
      },
    ],
    items: [
      {
        id: 1,
        rarity: 'UNIQUE',
        name: 'Headhunter',
        base: 'Heavy Belt',
        itemClass: 'Belts',
        slot: 'Belt',
        text: 'Rarity: UNIQUE\nItem Class: Belts\nHeadhunter\nHeavy Belt\n',
      },
    ],
  }
  codeInput.value = buildToShareCode(demo)
  onParse()
}

function saveCurrent() {
  const b = build.value
  if (!b) return
  builds.value = addBuild(builds.value, buildTitle.value.trim(), codeInput.value.trim()).list
}

function loadStored(stored: StoredBuild) {
  codeInput.value = stored.code
  onParse()
}

function deleteStored(id: string) {
  builds.value = removeBuild(builds.value, id)
}

/**
 * The overlay lives in its own window, so it has its own JavaScript context and
 * cannot see this one's state. The share code is the hand-off: both windows
 * share an origin, so localStorage carries it, and a `storage` event tells the
 * overlay to re-read when this changes.
 */
const OVERLAY_BUILD_KEY = 'poe2coach.currentBuild'

watch(
  build,
  (b) => {
    try {
      if (b) localStorage.setItem(OVERLAY_BUILD_KEY, buildToShareCode(b))
      else localStorage.removeItem(OVERLAY_BUILD_KEY)
    } catch {
      /* storage unavailable — the overlay just will not see a build */
    }
  },
  { immediate: true },
)

// ---------------------------------------------------------------- tree editing

const presets = ref<StoredTreePreset[]>(loadTreePresets())
const saveMessage = ref<string | null>(null)

/** Every class the tree knows, which is what makes a class pickable cold. */
const classNames = computed(() => tree.classes.map((c) => c.name))

/** Ascendancies this build's class can pick, which is what the picker offers. */
const ascendancies = computed(() => {
  const className = build.value?.className
  if (!className) return []
  const klass = tree.classes.find((c) => c.name === className)
  return klass?.ascendancies.map((a) => a.name) ?? []
})

const treeCheck = computed(() =>
  build.value
    ? validateTreeSelection(tree, build.value.passiveNodes, startNodeId.value, treeEdges())
    : null,
)

/**
 * Campaign Books of Specialisation taken, 0-24. They are consumable quest
 * items, so the ceiling genuinely depends on this and it cannot be derived from
 * the build; 24 is what Path of Building assumes, and what a finished character
 * has.
 */
const questPoints = ref(QUEST_POINT_TOTAL)

const pointBudget = computed(() =>
  countPoints(tree, build.value?.passiveNodes ?? [], { level: build.value?.level ?? null, questPoints: questPoints.value }, treeEdges()),
)

const startNodeId = computed(() => resolveStartNode(tree, build.value?.className ?? null))

/** Replace the whole array: `activeSet` and `plan` recompute off its identity. */
function patchBuild(patch: {
  className?: string | null
  ascendClassName?: string | null
  passiveNodes?: number[]
  level?: number | null
}) {
  if (!build.value) return
  build.value = { ...build.value, ...patch }
  saveMessage.value = null
}

function toggleTreeNode(id: number) {
  const b = build.value
  if (!b) return
  const has = b.passiveNodes.includes(id)
  patchBuild({ passiveNodes: has ? b.passiveNodes.filter((n) => n !== id) : [...b.passiveNodes, id] })
}

/**
 * Choosing a class is what makes the tree usable without importing anything:
 * the start node, the leveling plan and the connectivity check all hang off it.
 * With no build yet, this creates an empty one; with a build already loaded the
 * nodes are kept, because the orphan check will say plainly if the old
 * selection no longer reaches the new start.
 *
 * Ascendancies are class-specific, so the pick is dropped either way. That
 * matches how switching ascendancy behaves, which throws away the nodes that
 * belonged to the old tree.
 */
function setClass(name: string | null) {
  const b = build.value
  if (!b) {
    if (!name) return
    build.value = {
      className: name,
      ascendClassName: null,
      level: null,
      treeVersion: tree.version,
      passiveNodes: [],
      treeSpecUrls: [],
      skills: [],
      items: [],
    }
    saveMessage.value = `${t('已选择职业')} ${name}${t(',现在可以点天赋了。')}`
    return
  }
  if (b.className === name) return
  // A different class means a different start node, so the whole tree is void:
  // every node was picked as reachable from the old one. Ascendancy changes are
  // narrower — see setAscendancy, which only drops the old ascendancy's nodes.
  patchBuild({ className: name, ascendClassName: null, passiveNodes: [] })
  saveMessage.value = name
    ? `${t('职业已改为')} ${name}${t(',天赋与升华已清空(起点变了)。')}`
    : t('已取消职业选择,天赋与升华已清空。')
}

/**
 * Switching ascendancy drops the old one's nodes: they belong to a tree the
 * character no longer has, so keeping them would leave points the game would
 * never grant.
 */
function setAscendancy(name: string | null) {
  const b = build.value
  if (!b) return
  const previous = b.ascendClassName
  const kept =
    previous && previous !== name
      ? b.passiveNodes.filter((id) => {
          const node = tree.nodes[id]
          return !node || !isAscendancy(node) || node.ascendancyName !== previous
        })
      : b.passiveNodes
  patchBuild({ ascendClassName: name, passiveNodes: kept })
}

/** A save writes a freshly encoded code, never the imported one. */
function currentCode(): string | null {
  return build.value ? buildToShareCode(build.value) : null
}

/** The same code surfaced for the share panel's PoB export — the official-format twin. */
const currentPobCode = computed(currentCode)

function saveTree() {
  const b = build.value
  if (!b) return
  const budget = pointBudget.value
  if (budget.ascendancyUsed > budget.ascendancyCap) {
    saveMessage.value = `${t('升华已用')} ${budget.ascendancyUsed} ${t('点,超过上限')} ${budget.ascendancyCap} ${t('点,无法保存。')}`
    return
  }
  if (budget.mainCap != null && budget.mainUsed > budget.mainCap) {
    saveMessage.value = `${t('主树已用')} ${budget.mainUsed} ${t('点,超过上限')} ${budget.mainCap} ${t('点,无法保存。')}`
    return
  }
  const check = treeCheck.value
  if (check && check.orphans.length > 0) {
    saveMessage.value = `${t('有')} ${check.orphans.length} ${t('个节点没有连回职业起点,无法保存。先用「移除孤立节点」修好。')}`
    return
  }
  if (!b.className) {
    saveMessage.value = t('这份 Build 没有职业,无法校验天赋是否点得出来;已按现状保存。')
  }
  const code = currentCode()
  if (!code) return
  const named = `${buildTitle.value.trim()} (${t('已改天赋')})`
  builds.value = addBuild(builds.value, named, code).list
  codeInput.value = code
  saveMessage.value = t('已保存到 Build 库(分享码按当前天赋重新生成)。')
}

function setQuestPoints(value: number) {
  questPoints.value = Math.max(0, Math.min(QUEST_POINT_TOTAL, value))
  saveMessage.value = null
}

function removeOrphans() {
  const b = build.value
  const check = treeCheck.value
  if (!b || !check || check.orphans.length === 0) return
  const drop = new Set(check.orphans)
  patchBuild({ passiveNodes: b.passiveNodes.filter((id) => !drop.has(id)) })
  saveMessage.value = `${t('已移除')} ${check.orphans.length} ${t('个孤立节点。')}`
}

function saveTreePreset(name: string) {
  const b = build.value
  if (!b) return
  const result = addTreePreset(presets.value, {
    name,
    className: b.className,
    ascendClassName: b.ascendClassName,
    treeVersion: b.treeVersion,
    stages: [{ level: b.level ?? 1, nodes: b.passiveNodes }],
  })
  presets.value = result.list
  saveMessage.value = `${t('已保存预设')}「${result.preset.name}」${t('(Lv')}${b.level ?? 1})。`
}

/** Write the current nodes as this preset's stage for the current level. */
function saveTreeStage(id: string) {
  const b = build.value
  const preset = presets.value.find((p) => p.id === id)
  if (!b || !preset) return
  const level = b.level ?? 1
  const replaced = preset.stages.some((s) => s.level === level)
  presets.value = upsertTreeStage(presets.value, id, level, b.passiveNodes)
  saveMessage.value = `${t(replaced ? '已更新' : '已加入')}「${preset.name}」${t('的 Lv')}${level}${t('天赋')}。`
}

function loadStage(id: string, level: number) {
  const preset = presets.value.find((p) => p.id === id)
  const stage = preset?.stages.find((s) => s.level === level)
  if (!preset || !stage) return
  const b = build.value
  const sameClass = !preset.className || preset.className === b?.className
  if (!b) {
    // A preset carries its own class and level, so it can stand in for a build
    // snapshot when nothing has been imported yet.
    build.value = {
      className: preset.className,
      ascendClassName: preset.ascendClassName,
      level,
      treeVersion: preset.treeVersion,
      passiveNodes: stage.nodes,
      treeSpecUrls: [],
      skills: [],
      items: [],
    }
  } else {
    patchBuild({
      passiveNodes: stage.nodes,
      level,
      ascendClassName: preset.ascendClassName ?? b.ascendClassName,
      ...(sameClass ? {} : { className: preset.className }),
    })
  }
  saveMessage.value =
    `${t('已载入')}「${preset.name}」${t('的 Lv')}${level}${t('天赋')}(${stage.nodes.length} ${t('点')})` +
    (sameClass ? '。' : `${t(',职业随之改为')} ${preset.className}。`)
}

/**
 * Applying a preset loads the stage for the current level when it has one, and
 * otherwise the nearest stage below it — a plan for level 30 is the right thing
 * to see when you are at 45 and have not planned 45 yet.
 */
function applyTreePreset(id: string) {
  const preset = presets.value.find((p) => p.id === id)
  if (!preset || preset.stages.length === 0) return
  const level = build.value?.level ?? null
  if (level == null) {
    loadStage(id, preset.stages[preset.stages.length - 1].level)
    return
  }
  const exact = preset.stages.find((s) => s.level === level)
  if (exact) {
    loadStage(id, level)
    return
  }
  const below = [...preset.stages].filter((s) => s.level < level).sort((a, b) => b.level - a.level)[0]
  loadStage(id, (below ?? preset.stages[0]).level)
}

function deleteTreeStage(id: string, level: number) {
  presets.value = removeTreeStage(presets.value, id, level)
}

function deleteTreePreset(id: string) {
  presets.value = removeTreePreset(presets.value, id)
}

/** The level drives the main-tree ceiling, so it is part of the draft. */
function setLevel(level: number | null) {
  if (!build.value) return
  patchBuild({ level })
}
</script>

<template>
  <div class="app">
    <header class="nav">
      <span class="logo" @click="view = 'home'">PoE2 Build Coach</span>
      <nav class="tabs">
        <button
          v-for="n in NAV"
          :key="n.key"
          class="tab"
          :class="{ active: view === n.key, disabled: n.requiresBuild && !hasBuild }"
          :disabled="n.requiresBuild && !hasBuild"
          @click="view = n.key"
        >
          {{ t(n.label) }}
        </button>
      </nav>
      <span
        class="realm-badge"
        :title="`${realm.apiBase}\n${t('尾标是客户端写物品的语言,决定你粘贴的装备能不能匹配;界面语言跟着服务器走。')}`"
        @click="view = 'settings'"
      >
        {{ t(realm.label) }} · {{ realm.lang === 'en' ? 'EN' : realm.lang === 'zh-Hans' ? '简' : '繁' }}
      </span>
      <span v-if="hasBuild" class="build-badge">{{ buildTitle }}</span>
    </header>

    <!-- ===================== 主页 ===================== -->
    <main v-if="view === 'home'" class="home">
      <section class="hero-card">
        <h2>{{ t('导入 Build') }}</h2>
        <textarea v-model="codeInput" rows="5" :placeholder="t('粘贴 Path of Building 分享码…')" spellcheck="false" />
        <div class="btn-row">
          <button class="primary" :disabled="!codeInput.trim()" @click="onParse">{{ t('解析 Build') }}</button>
          <button @click="loadDemo">{{ t('加载示例') }}</button>
        </div>
        <p v-if="error" class="error">{{ error }}</p>
        <p class="dim small hint">
          {{ t('这个框两种码都收:PoB 分享码,或本工具自己的分享码(会一并还原设置、异界天赋与装备)。') }}
        </p>
      </section>

      <StrategyCard
        v-if="strategy.allocatedCount > 0"
        class="span-2"
        :brief="strategy"
        interactive
        @focus-mechanic="openAtlasMechanic"
        @focus-biome="openMaps"
      />

      <SharePanel :snapshot="shareSnapshot" :brief="strategy" :pob-code="currentPobCode" @apply="applyShare" />

      <section v-if="hasBuild" class="card span-2">
        <h3>{{ t('概览') }}</h3>
        <div class="kv">
          <div v-for="row in summary" :key="row.k" class="kv-row">
            <span class="k">{{ row.k }}</span>
            <span class="v">{{ row.v }}</span>
          </div>
        </div>
      </section>

      <section v-if="hasBuild" class="card">
        <h3>{{ t('元素抗性') }}</h3>
        <ResistancePanel :items="gameItems" />
      </section>

      <button class="card feature" :disabled="!hasBuild" @click="view = 'tree'">
        <h3>🌳 {{ t('天赋树') }}</h3>
        <p class="desc">
          {{ hasBuild ? t(`${build!.passiveNodes.length} 个目标节点,悬停看中英对照`) : t('先导入一份 Build') }}
        </p>
        <p class="go">{{ t('进入') }} →</p>
      </button>

      <button class="card feature" :disabled="!hasBuild" @click="view = 'gear'">
        <h3>🛡 {{ t('装备') }}</h3>
        <p class="desc">
          {{ hasBuild ? t(`${build!.items.length} 件装备 · 词缀重心与换装比对`) : t('先导入一份 Build') }}
        </p>
        <p class="go">{{ t('进入') }} →</p>
      </button>

      <button class="card feature" :disabled="!hasBuild" @click="view = 'skills'">
        <h3>💎 {{ t('技能') }}</h3>
        <p class="desc">
          {{ hasBuild ? t(`${build!.skills.length} 组 · ${totalGems} 颗宝石`) : t('先导入一份 Build') }}
        </p>
        <p class="go">{{ t('进入') }} →</p>
      </button>

      <button class="card feature" :disabled="!hasBuild" @click="view = 'leveling'">
        <h3>📈 {{ t('升级') }}</h3>
        <p class="desc">
          {{ hasBuild ? t('剧情跑图路线 · 永久奖励清单 · 逐级点法') : t('先导入一份 Build') }}
        </p>
        <p class="go">{{ t('进入') }} →</p>
      </button>

      <button class="card feature" @click="view = 'atlas'">
        <h3>🌌 {{ t('异界') }}</h3>
        <p class="desc">{{ t(`${ATLAS_NODES} 个天赋节点 · 6 棵机制子树 · 按生态找节点`) }}</p>
        <p class="go">{{ t('进入') }} →</p>
      </button>

      <button class="card feature" @click="view = 'maps'">
        <h3>🗺 {{ t('地图') }}</h3>
        <p class="desc">{{ t(`${MAP_COUNT} 个异界地区 · 跑图评分/布局/Boss 一览`) }}</p>
        <p class="go">{{ t('进入') }} →</p>
      </button>

      <button class="card feature" @click="view = 'price'">
        <h3>💰 {{ t('查价') }}</h3>
        <p class="desc">{{ t('粘贴装备取回官方交易站实时挂单 · 只读接口') }}</p>
        <p class="go">{{ t('进入') }} →</p>
      </button>

      <button class="card feature" @click="view = 'farm'">
        <h3>⏱ {{ t('刷图') }}</h3>
        <p class="desc">{{ t('读客户端日志算地图数/每图耗时/死亡 · 产出靠粘贴记账') }}</p>
        <p class="go">{{ t('进入') }} →</p>
      </button>

      <button class="card feature" @click="view = 'settings'">
        <h3>⚙️ {{ t('设置') }}</h3>
        <p class="desc">{{ t('切换国际服 / 国服 / 台服；国服在这里关联登录') }}</p>
        <p class="go">{{ t('进入') }} →</p>
      </button>

      <section class="card span-2">
        <div class="lib-head">
          <h3>{{ t('我的 Build 库') }}({{ builds.length }})</h3>
          <button v-if="hasBuild" class="lib-save" @click="saveCurrent">+ {{ t('保存当前') }}</button>
        </div>
        <div v-for="b in builds" :key="b.id" class="lib-item">
          <span class="lib-name" :title="t('载入这份 Build')" @click="loadStored(b)">{{ b.name }}</span>
          <span class="dim">{{ new Date(b.savedAt).toLocaleDateString() }}</span>
          <span class="lib-del" :title="t('删除')" @click="deleteStored(b.id)">✕</span>
        </div>
        <div v-if="!builds.length" class="dim">{{ t('保存后多份 Build 可随时切换,刷新不丢。') }}</div>
      </section>
    </main>

    <!-- ===================== 功能视图 ===================== -->
    <main v-else-if="view === 'tree'" class="full">
      <TreePanel
        :tree="tree"
        :build="build"
        :active="activeSet"
        :progress="progressSet"
        :presets="presets"
        :classes="classNames"
        :start-node="startNodeId"
        :ascendancies="ascendancies"
        :check="treeCheck"
        :budget="pointBudget"
        :quest-points="questPoints"
        :save-message="saveMessage"
        @toggle-node="toggleTreeNode"
        @set-class="setClass"
        @set-ascendancy="setAscendancy"
        @set-quest-points="setQuestPoints"
        @set-level="setLevel"
        @save="saveTree"
        @remove-orphans="removeOrphans"
        @save-preset="saveTreePreset"
        @apply-preset="applyTreePreset"
        @delete-preset="deleteTreePreset"
        @save-stage="saveTreeStage"
        @apply-stage="loadStage"
        @delete-stage="deleteTreeStage"
      />
    </main>

    <main v-else-if="view === 'gear'" class="centered">
      <GearPanel :items="gameItems" />
    </main>

    <main v-else-if="view === 'skills'" class="centered">
      <SkillsPanel :build="build!" />
    </main>

    <main v-else-if="view === 'leveling'" class="centered">
      <LevelingPage
        v-model:currentPoints="currentPoints"
        :tree="tree"
        :build="build!"
        :plan="plan!"
        @open-tree="view = 'tree'"
      />
    </main>

    <main v-else-if="view === 'atlas'" class="full">
      <AtlasPanel @open-maps="openMaps" />
    </main>

    <main v-else-if="view === 'maps'" class="centered">
      <MapsPanel @open-atlas="openAtlas" />
    </main>

    <main v-else-if="view === 'price'" class="centered">
      <PricePanel @open-settings="view = 'settings'" />
    </main>

    <main v-else-if="view === 'farm'" class="full">
      <FarmPanel />
    </main>

    <main v-else-if="view === 'settings'" class="centered">
      <SettingsPanel />
    </main>
  </div>
</template>

<style scoped>
.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
}
.nav {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 0 18px;
  height: 48px;
  min-height: 48px;
  background: #10131b;
  border-bottom: 1px solid #232939;
}
.logo {
  color: #e8b04b;
  font-weight: 700;
  font-size: 15px;
  cursor: pointer;
}
.tabs {
  display: flex;
  gap: 4px;
}
.tab {
  background: none;
  border: none;
  color: #8a93ad;
  font-size: 13px;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
}
.tab:hover {
  color: #cfd4e4;
  background: #1a1f2c;
}
.tab.active {
  color: #e8b04b;
  background: #1f1a10;
}
.tab.disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.build-badge {
  margin-left: 8px;
  font-size: 12px;
  color: #7dd087;
  background: #14201a;
  border: 1px solid #2f4a38;
  border-radius: 10px;
  padding: 3px 10px;
}
.realm-badge {
  margin-left: auto;
  font-size: 11px;
  color: #9aa3bd;
  background: #171b26;
  border: 1px solid #2c3244;
  border-radius: 10px;
  padding: 3px 10px;
  cursor: pointer;
  white-space: nowrap;
}
.realm-badge:hover {
  border-color: #e8b04b;
  color: #e8b04b;
}

.home {
  flex: 1;
  overflow-y: auto;
  padding: 22px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
  align-content: start;
}
.card {
  background: #10131b;
  border: 1px solid #232939;
  border-radius: 10px;
  padding: 14px 16px;
  text-align: left;
  color: inherit;
  font: inherit;
}
.card h3 {
  font-size: 14px;
  color: #e8b04b;
  margin-bottom: 10px;
}
.span-2 {
  grid-column: span 2;
}
.feature {
  cursor: pointer;
  transition: transform 0.12s ease, border-color 0.12s ease;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.feature:hover:not(:disabled) {
  transform: translateY(-2px);
  border-color: #e8b04b;
}
.feature:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.feature .desc {
  font-size: 12px;
  color: #9aa3bd;
  flex: 1;
}
.feature .go {
  font-size: 12px;
  color: #e8b04b;
}
.hero-card {
  grid-column: 1 / -1;
  background: #10131b;
  border: 1px solid #232939;
  border-radius: 10px;
  padding: 14px 16px;
}
.hero-card h2 {
  font-size: 14px;
  color: #e8b04b;
  margin-bottom: 10px;
}
textarea {
  width: 100%;
  box-sizing: border-box;
  background: #0b0d12;
  color: #cfd4e4;
  border: 1px solid #2c3244;
  border-radius: 6px;
  padding: 8px;
  font-size: 11px;
  font-family: Consolas, monospace;
  resize: vertical;
}
textarea:focus {
  outline: none;
  border-color: #e8b04b;
}
.btn-row {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
button.primary {
  background: #e8b04b;
  border: none;
  color: #14120a;
}
.btn-row button {
  flex: 1;
  padding: 8px 0;
  border: 1px solid #2c3244;
  border-radius: 6px;
  background: #1a1f2c;
  color: #cfd4e4;
  cursor: pointer;
  font-size: 13px;
}
.btn-row button.primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.error {
  color: #e06c6c;
  font-size: 12px;
  margin: 8px 0 0;
}
.kv-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  padding: 3px 0;
}
.kv-row .k {
  color: #7a8299;
}
.lib-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.lib-head h3 {
  margin-bottom: 0;
}
.lib-save {
  background: #1a2c1f;
  border: 1px solid #2f4a38;
  color: #7dd087;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
}
.lib-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 12px;
}
.lib-item:hover {
  background: #171b26;
}
.lib-name {
  flex: 1;
  color: #cfd4e4;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lib-name:hover {
  color: #e8b04b;
}
.lib-del {
  color: #7a5a5a;
  cursor: pointer;
  padding: 0 4px;
}
.lib-del:hover {
  color: #e06c6c;
}
.dim {
  color: #6b7390;
  font-size: 11px;
}

.full {
  flex: 1;
  min-height: 0;
}
.centered {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  display: flex;
  justify-content: center;
}
.centered > :deep(*) {
  width: 100%;
  max-width: 720px;
}
</style>

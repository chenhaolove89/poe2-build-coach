<script setup lang="ts">
import { computed, ref } from 'vue'
import { PobParseError, buildLevelingPlan, buildToShareCode, parseItemText, parsePobCode, resolveStartNode } from '@poe2coach/core'
import type { BuildSnapshot, GameItem, TreeData } from '@poe2coach/core'
import TreeCanvas from './components/TreeCanvas.vue'
import ResistancePanel from './components/ResistancePanel.vue'
import GearPanel from './components/GearPanel.vue'
import LevelingPanel from './components/LevelingPanel.vue'
import SkillsPanel from './components/SkillsPanel.vue'
import MapsPanel from './components/MapsPanel.vue'
import PricePanel from './components/PricePanel.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import { loadTree } from './treeData'
import { bilingual, t } from './i18n'
import { addBuild, loadBuilds, removeBuild } from './buildStore'
import type { StoredBuild } from './buildStore'
import { realm } from './settings'
import mapsJson from '@poe2coach/data/maps.json'

const MAP_COUNT = (mapsJson as unknown as { maps: unknown[] }).maps.length

type View = 'home' | 'tree' | 'gear' | 'skills' | 'leveling' | 'maps' | 'price' | 'settings'

const NAV: { key: View; label: string; requiresBuild?: boolean }[] = [
  { key: 'home', label: '主页' },
  { key: 'tree', label: '天赋树', requiresBuild: true },
  { key: 'gear', label: '装备', requiresBuild: true },
  { key: 'skills', label: '技能', requiresBuild: true },
  { key: 'leveling', label: '升级', requiresBuild: true },
  { key: 'price', label: '查价' },
  { key: 'maps', label: '地图' },
  { key: 'settings', label: '设置' },
]

const tree: TreeData = loadTree()
const view = ref<View>('home')
const codeInput = ref('')
const error = ref<string | null>(null)
const build = ref<BuildSnapshot | null>(null)
const currentPoints = ref<number | null>(null)
const builds = ref<StoredBuild[]>(loadBuilds())

const activeSet = computed(() => new Set(build.value?.passiveNodes ?? []))
const gameItems = computed<GameItem[]>(() => (build.value?.items ?? []).map((i) => parseItemText(i.text)))
const plan = computed(() =>
  build.value ? buildLevelingPlan(tree, build.value.passiveNodes, resolveStartNode(tree, build.value.className)) : null,
)
const progressSet = computed(() => {
  const n = currentPoints.value
  if (!plan.value || n == null || n <= 0) return new Set<number>()
  return new Set(plan.value.steps.slice(0, n).map((s) => s.nodeId))
})

const hasBuild = computed(() => !!build.value)

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

function onParse() {
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
  const firstKeystone = Object.values(tree.nodes).find((n) => n.isKeystone && !n.ascendancyName)
  const picked: number[] = []
  const seen = new Set<number>()
  const queue: number[] = firstKeystone ? [firstKeystone.id] : [Number(Object.keys(tree.nodes)[0])]
  while (queue.length > 0 && picked.length < 80) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    const node = tree.nodes[id]
    if (!node || node.ascendancyName || node.isMastery) continue
    seen.add(id)
    picked.push(id)
    for (const c of node.connections ?? []) queue.push(c.id)
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
      <span class="realm-badge" :title="realm.apiBase" @click="view = 'settings'">
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
      </section>

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
          {{ hasBuild ? t(`${plan!.steps.length} 步逐级点法 · 输入点数看进度`) : t('先导入一份 Build') }}
        </p>
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

      <button class="card feature" @click="view = 'settings'">
        <h3>⚙️ {{ t('设置') }}</h3>
        <p class="desc">{{ t('切换国际服 / 国服 / 台服，切换简体与繁体') }}</p>
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
      <TreeCanvas :tree="tree" :active="activeSet" :progress="progressSet" />
    </main>

    <main v-else-if="view === 'gear'" class="centered">
      <GearPanel :items="gameItems" />
    </main>

    <main v-else-if="view === 'skills'" class="centered">
      <SkillsPanel :build="build!" />
    </main>

    <main v-else-if="view === 'leveling'" class="centered">
      <LevelingPanel v-model:currentPoints="currentPoints" :tree="tree" :build="build!" :plan="plan!" />
    </main>

    <main v-else-if="view === 'maps'" class="centered">
      <MapsPanel />
    </main>

    <main v-else-if="view === 'price'" class="centered">
      <PricePanel @open-settings="view = 'settings'" />
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

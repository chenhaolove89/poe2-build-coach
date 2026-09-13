<script setup lang="ts">
import { computed, ref } from 'vue'
import { PobParseError, buildToShareCode, parsePobCode } from '@poe2coach/core'
import type { BuildSnapshot, TreeData } from '@poe2coach/core'
import TreeCanvas from './components/TreeCanvas.vue'
import { loadTree } from './treeData'

const tree: TreeData = loadTree()

const codeInput = ref('')
const error = ref<string | null>(null)
const build = ref<BuildSnapshot | null>(null)

const activeSet = computed(() => new Set(build.value?.passiveNodes ?? []))

function onParse() {
  error.value = null
  try {
    build.value = parsePobCode(codeInput.value)
  } catch (e) {
    build.value = null
    error.value = e instanceof PobParseError ? e.message : String(e)
  }
}

/** Demo fixture: a connected blob of nodes from the real tree, re-encoded as a share code. */
function loadDemo() {
  const firstKeystone = Object.values(tree.nodes).find((n) => n.isKeystone && !n.isAscendancyNode)
  const picked: number[] = []
  const seen = new Set<number>()
  const queue: number[] = firstKeystone ? [firstKeystone.id] : [Number(Object.keys(tree.nodes)[0])]
  while (queue.length > 0 && picked.length < 80) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    const node = tree.nodes[id]
    if (!node || node.isAscendancyNode || node.isMastery) continue
    seen.add(id)
    picked.push(id)
    for (const c of node.connections ?? []) queue.push(c.id)
  }
  const demo: BuildSnapshot = {
    className: 'Witch',
    ascendClassName: 'Infernalist',
    level: 88,
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
        name: 'Mailbreaker',
        base: 'Ancient Spirit Helmet',
        itemClass: 'Helmet',
        slot: 'Helmet',
        text: 'Rarity: UNIQUE\nItem Class: Helmets\nMailbreaker\nAncient Spirit Helmet\n',
      },
    ],
  }
  codeInput.value = buildToShareCode(demo)
  onParse()
}

const summary = computed(() => {
  const b = build.value
  if (!b) return null
  return [
    { k: '职业', v: b.className ?? '—' },
    { k: '升华', v: b.ascendClassName ?? '—' },
    { k: '等级', v: b.level ?? '—' },
    { k: '天赋节点', v: b.passiveNodes.length },
    { k: '技能组', v: b.skills.length },
    { k: '装备', v: b.items.length },
  ]
})
</script>

<template>
  <div class="app">
    <aside class="panel">
      <h1>PoE2 Build Coach</h1>
      <p class="sub">粘贴 PoB 分享码,即刻得到这份 Build 的天赋目标与执行清单。数据:PoB2 TreeData 0_5(MIT)。</p>

      <textarea v-model="codeInput" rows="5" placeholder="粘贴 Path of Building 分享码…" spellcheck="false" />
      <div class="btn-row">
        <button class="primary" :disabled="!codeInput.trim()" @click="onParse">解析 Build</button>
        <button @click="loadDemo">加载示例</button>
      </div>
      <p v-if="error" class="error">{{ error }}</p>

      <template v-if="summary">
        <h2>概览</h2>
        <div class="kv">
          <div v-for="row in summary" :key="row.k" class="kv-row">
            <span class="k">{{ row.k }}</span>
            <span class="v">{{ row.v }}</span>
          </div>
        </div>

        <h2>技能组</h2>
        <div v-for="(g, i) in build!.skills" :key="i" class="skill-group">
          <div class="skill-label">{{ g.label ?? '未命名技能组' }}</div>
          <div v-for="gem in g.gems" :key="gem.name" class="gem" :class="{ off: !gem.enabled }">
            {{ gem.name }}<span class="dim"> Lv{{ gem.level ?? '?' }}{{ gem.quality ? ` Q${gem.quality}` : '' }}{{ gem.enabled ? '' : ' ·停用' }}</span>
          </div>
        </div>
        <div v-if="build!.skills.length === 0" class="dim">—</div>

        <h2>装备</h2>
        <div v-for="item in build!.items" :key="item.id" class="item">
          <div :class="'rarity-' + (item.rarity ?? 'NORMAL').toLowerCase()">
            {{ item.name ?? item.base }}<span v-if="item.name && item.base" class="dim"> · {{ item.base }}</span>
          </div>
          <div class="dim">{{ item.rarity }}{{ item.slot ? ` · ${item.slot}` : '' }}</div>
        </div>
        <div v-if="build!.items.length === 0" class="dim">—</div>
      </template>
    </aside>

    <main class="tree-area">
      <TreeCanvas :tree="tree" :active="activeSet" />
    </main>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  height: 100vh;
}
.panel {
  width: 340px;
  min-width: 340px;
  overflow-y: auto;
  padding: 18px 16px 32px;
  background: #10131b;
  border-right: 1px solid #232939;
}
h1 {
  font-size: 18px;
  color: #e8b04b;
  margin: 0 0 4px;
}
h2 {
  font-size: 13px;
  color: #8a93ad;
  margin: 18px 0 8px;
  border-bottom: 1px solid #232939;
  padding-bottom: 4px;
}
.sub {
  font-size: 12px;
  color: #6b7390;
  line-height: 1.6;
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
button {
  flex: 1;
  padding: 8px 0;
  border: 1px solid #2c3244;
  border-radius: 6px;
  background: #1a1f2c;
  color: #cfd4e4;
  cursor: pointer;
  font-size: 13px;
}
button.primary {
  background: #e8b04b;
  border-color: #e8b04b;
  color: #14120a;
  font-weight: 600;
}
button:disabled {
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
.skill-group {
  margin-bottom: 10px;
}
.skill-label {
  font-size: 13px;
  color: #d9a441;
  margin-bottom: 3px;
}
.gem {
  font-size: 12px;
  padding: 2px 0 2px 10px;
  border-left: 2px solid #2c3244;
}
.gem.off {
  color: #5b6379;
  text-decoration: line-through;
}
.item {
  margin-bottom: 10px;
  font-size: 13px;
}
.rarity-unique {
  color: #af6025;
}
.rarity-rare {
  color: #ffff77;
}
.rarity-magic {
  color: #8888ff;
}
.dim {
  color: #6b7390;
  font-size: 11px;
}
.tree-area {
  flex: 1;
  min-width: 0;
}
</style>

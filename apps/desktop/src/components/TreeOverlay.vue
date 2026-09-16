<script setup lang="ts">
/**
 * The passive-tree overlay: a reference the player summons over the game with a
 * hotkey, and dismisses the same way.
 *
 * It reads nothing from the game. The node order comes from the build's own
 * leveling plan, so what it shows is "the tree you imported, in the order you
 * planned to take it" — the player matches it up by eye. That is the whole
 * reason it is allowed to exist over the game at all: no memory, no injection,
 * no packets, and nothing drawn unless asked for.
 *
 * It lives in its own window, which means its own JavaScript context, so the
 * build is picked up from the share code the main window keeps in storage.
 * Both windows share an origin, so localStorage is the hand-off.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { buildLevelingPlan, parsePobCode, resolveStartNode } from '@poe2coach/core'
import type { BuildSnapshot, TreeData } from '@poe2coach/core'
import { bilingual, t } from '../i18n'
import { loadTree } from '../treeData'
import TreeCanvas from './TreeCanvas.vue'

const tree: TreeData = loadTree()
const build = ref<BuildSnapshot | null>(null)
const notice = ref<string | null>(null)

/** Where the main window leaves the build for us. */
const BUILD_KEY = 'poe2coach.currentBuild'

function readBuild() {
  try {
    const code = localStorage.getItem(BUILD_KEY)
    build.value = code ? parsePobCode(code) : null
    notice.value = build.value ? null : t('主窗口还没有导入 Build。')
  } catch {
    build.value = null
    notice.value = t('读取 Build 失败。')
  }
}

const active = computed(() => new Set(build.value?.passiveNodes ?? []))
const startNode = computed(() => resolveStartNode(tree, build.value?.className ?? null))

/**
 * The order to take the nodes in, keyed by node id. Connector nodes the plan
 * walks through are included, because the player has to click those too.
 */
const order = computed(() => {
  const b = build.value
  if (!b) return new Map<number, number>()
  const plan = buildLevelingPlan(tree, b.passiveNodes, startNode.value)
  const map = new Map<number, number>()
  plan.steps.forEach((step, i) => map.set(step.nodeId, i + 1))
  return map
})

const nextStep = computed(() => {
  const b = build.value
  if (!b) return null
  const plan = buildLevelingPlan(tree, b.passiveNodes, startNode.value)
  const first = plan.steps[0]
  if (!first) return null
  return { order: 1, name: bilingual(first.name), total: plan.steps.length }
})

function onKey(e: KeyboardEvent) {
  // Esc closes it from inside too, in case the hotkey is taken by the game.
  if (e.key === 'Escape') window.close()
}

onMounted(() => {
  readBuild()
  // The main window writes this whenever the build changes, and storage events
  // reach other windows of the same origin.
  window.addEventListener('storage', (e) => {
    if (e.key === BUILD_KEY) readBuild()
  })
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="overlay">
    <div v-if="nextStep" class="hud">
      <span class="label">{{ t('下一个') }}</span>
      <span class="num">#1</span>
      <span class="name">{{ nextStep.name }}</span>
      <span class="dim">{{ t('共') }} {{ nextStep.total }} {{ t('步') }} · F8 {{ t('关闭') }}</span>
    </div>
    <div v-else-if="notice" class="hud">{{ notice }}</div>
    <main class="canvas-wrap">
      <TreeCanvas
        :tree="tree"
        :active="active"
        :start-node="startNode"
        :background="null"
        :order="order"
        :editable="false"
      />
    </main>
  </div>
</template>

<style scoped>
/*
 * The window itself is transparent, so nothing here may paint a background:
 * the game shows through everywhere the tree is not drawn.
 */
.overlay {
  position: relative;
  height: 100vh;
  background: transparent;
}
.canvas-wrap {
  height: 100%;
  background: transparent;
}
.hud {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2;
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 8px 18px;
  border-radius: 999px;
  background: rgba(10, 12, 18, 0.82);
  border: 1px solid rgba(232, 176, 75, 0.5);
  color: #cfd4e4;
  font: 14px/1.4 'Segoe UI', 'Microsoft YaHei', sans-serif;
  pointer-events: none;
}
.hud .label {
  color: #8a93ad;
  font-size: 12px;
}
.hud .num {
  color: #ffd979;
  font-weight: 700;
  font-size: 18px;
}
.hud .name {
  font-weight: 600;
}
.hud .dim {
  color: #6b7390;
  font-size: 12px;
}
</style>

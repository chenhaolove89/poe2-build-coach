<script setup lang="ts">
/**
 * The passive-tree overlay: a small reference card the player summons over the
 * game with a hotkey, and dismisses the same way.
 *
 * It shows **only the region the selected nodes sit in**, framed automatically,
 * rather than the whole tree laid over the game's. Lining the two up was the
 * first attempt and it cannot work: the app has no way to know how the game has
 * panned or zoomed its own tree, so the two renderings never match. Cropping to
 * the selection sidesteps that entirely — there is nothing to align, it is a
 * card the player parks somewhere and reads.
 *
 * It reads nothing from the game. The node order comes from the build's own
 * leveling plan, and the player follows it by eye. That is the whole reason it
 * is allowed over the game at all: no memory, no injection, no packets, and
 * nothing drawn unless asked for.
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

const steps = computed(() => {
  const b = build.value
  if (!b) return []
  return buildLevelingPlan(tree, b.passiveNodes, startNode.value).steps
})

const nextStep = computed(() => {
  const first = steps.value[0]
  if (!first) return null
  return { name: bilingual(first.name), total: steps.value.length }
})

/**
 * Node id -> the step it is taken at. Connector nodes the plan walks through are
 * included, because the player has to click those too.
 */
const order = computed(() => {
  const map = new Map<number, number>()
  steps.value.forEach((step, i) => map.set(step.nodeId, i + 1))
  return map
})

/** The region to frame: the selection, plus the start it grows from. */
const framed = computed(() => {
  const b = build.value
  if (!b) return null
  const ids = new Set(b.passiveNodes)
  if (startNode.value != null) ids.add(startNode.value)
  return ids
})

function onKey(e: KeyboardEvent) {
  // Esc closes it from inside too, in case the hotkey is taken by the game.
  if (e.key === 'Escape') window.close()
}

onMounted(() => {
  readBuild()
  // The main window writes this whenever the build changes, and storage events
  // reach the other windows of the same origin.
  window.addEventListener('storage', (e) => {
    if (e.key === BUILD_KEY) readBuild()
  })
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="overlay">
    <!-- Dragging the card: this bar is the window's handle. -->
    <header class="bar" data-tauri-drag-region>
      <template v-if="nextStep">
        <span class="label" data-tauri-drag-region>{{ t('下一个') }}</span>
        <span class="num" data-tauri-drag-region>#1</span>
        <span class="name" data-tauri-drag-region>{{ nextStep.name }}</span>
        <span class="dim" data-tauri-drag-region>· {{ t('共') }} {{ nextStep.total }} {{ t('步') }}</span>
      </template>
      <span v-else class="dim" data-tauri-drag-region>{{ notice ?? t('这份 Build 还没有天赋') }}</span>
      <span class="spacer" data-tauri-drag-region />
      <span class="move" data-tauri-drag-region>{{ t('拖动此处移动') }}</span>
    </header>
    <main class="canvas-wrap">
      <TreeCanvas
        :tree="tree"
        :active="active"
        :start-node="startNode"
        :background="null"
        :order="order"
        :fit-to="framed"
        :editable="false"
      />
    </main>
  </div>
</template>

<style scoped>
/*
 * A card, not a full-screen sheet: it sits in a corner of the screen and the
 * game shows around it. The window is transparent only so the corners can be
 * rounded.
 */
.overlay {
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
  background: rgba(9, 11, 16, 0.9);
  border: 1px solid rgba(232, 176, 75, 0.45);
  border-radius: 10px;
  overflow: hidden;
  color: #cfd4e4;
  font: 13px/1.4 'Segoe UI', 'Microsoft YaHei', sans-serif;
}
.bar {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 7px 12px;
  background: rgba(16, 19, 28, 0.95);
  border-bottom: 1px solid rgba(44, 50, 68, 0.9);
  cursor: move;
  user-select: none;
  flex: 0 0 auto;
}
.bar .label {
  color: #8a93ad;
  font-size: 11px;
}
.bar .num {
  color: #ffd979;
  font-weight: 700;
  font-size: 16px;
}
.bar .name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bar .dim {
  color: #6b7390;
  font-size: 11px;
}
.bar .spacer {
  flex: 1;
}
.bar .move {
  color: #4d5570;
  font-size: 10px;
  white-space: nowrap;
}
.canvas-wrap {
  flex: 1;
  min-height: 0;
  background: transparent;
}
</style>

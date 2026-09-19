<script setup lang="ts">
/**
 * The leveling view: a campaign route guide for players still in the story,
 * with the imported build's allocation order as a secondary tab.
 *
 * The campaign tab is the default — a player in the acts needs "where do I go
 * and what do I grab" far more often than "which node next", and the node
 * order only makes sense once they have a target tree to follow.
 */
import { ref } from 'vue'
import type { BuildSnapshot, LevelingPlan, TreeData } from '@poe2coach/core'
import CampaignGuide from './CampaignGuide.vue'
import LevelingPanel from './LevelingPanel.vue'
import { t } from '../i18n'

const props = defineProps<{
  tree: TreeData
  build: BuildSnapshot
  plan: LevelingPlan
  currentPoints: number | null
}>()

const emit = defineEmits<{
  (e: 'update:currentPoints', v: number | null): void
  (e: 'openTree'): void
}>()

const tab = ref<'route' | 'talent'>('route')
</script>

<template>
  <div class="leveling-page">
    <div class="page-tabs">
      <button :class="{ active: tab === 'route' }" @click="tab = 'route'">{{ t('剧情路线') }}</button>
      <button :class="{ active: tab === 'talent' }" @click="tab = 'talent'">{{ t('天赋点法') }}</button>
    </div>

    <CampaignGuide v-if="tab === 'route'" :level="build.level" />
    <LevelingPanel
      v-else
      :tree="tree"
      :build="build"
      :plan="plan"
      :current-points="currentPoints"
      @update:current-points="emit('update:currentPoints', $event)"
      @open-tree="emit('openTree')"
    />
  </div>
</template>

<style scoped>
.leveling-page {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.page-tabs {
  display: flex;
  gap: 6px;
}
.page-tabs button {
  background: #10131b;
  border: 1px solid #232939;
  color: #8a93ad;
  border-radius: 8px;
  padding: 6px 16px;
  font-size: 12px;
  cursor: pointer;
}
.page-tabs button:hover {
  color: #cfd4e4;
}
.page-tabs button.active {
  color: #e8b04b;
  border-color: #4a3d20;
  background: #1f1a10;
}
</style>

<script setup lang="ts">
import { computed } from 'vue'
import type { BuildSnapshot, LevelingPlan, TreeData } from '@poe2coach/core'

const props = defineProps<{
  tree: TreeData
  build: BuildSnapshot
  plan: LevelingPlan
  currentPoints: number | null
}>()

const shownSteps = computed(() => {
  const steps = props.plan.steps
  const n = props.currentPoints ?? 0
  if (n <= 0) return { past: [], next: steps.slice(0, 12) }
  return {
    past: steps.slice(0, n),
    next: steps.slice(n, n + 12),
  }
})
</script>

<template>
  <div>
    <h2>逐级点法(从{{ build.className }}起点出发)</h2>
    <div class="pts-row">
      <label class="dim">你当前已用点数:</label>
      <input
        :value="currentPoints ?? ''"
        type="number"
        min="0"
        :max="plan.steps.length"
        placeholder="0"
        @input="$emit('update:currentPoints', ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value))"
      />
      <span class="dim">/ 共 {{ plan.steps.length }} 点 · 树上亮金=应已点</span>
    </div>

    <template v-if="currentPoints != null && currentPoints > 0">
      <div class="sec-label done">应已分配({{ shownSteps.past.length }})</div>
      <div class="step done" v-for="step in shownSteps.past" :key="step.order">
        {{ step.order }}. {{ step.name }}<span v-if="!step.isTarget" class="connector"> ·路径</span>
      </div>
      <div class="sec-label next" v-if="shownSteps.next.length">接下来</div>
    </template>

    <div class="step" v-for="step in shownSteps.next" :key="step.order">
      {{ step.order }}. {{ step.name }}<span v-if="!step.isTarget" class="connector"> ·路径</span>
    </div>

    <div v-if="plan.unreachable.length" class="asc">
      另有 {{ plan.unreachable.length }} 点为升华节点,通过迷宫获取,不占天赋点顺序。
    </div>
  </div>
</template>

<style scoped>
h2 {
  font-size: 13px;
  color: #8a93ad;
  margin: 18px 0 8px;
  border-bottom: 1px solid #232939;
  padding-bottom: 4px;
}
.pts-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 12px;
}
input {
  width: 64px;
  background: #0b0d12;
  color: #cfd4e4;
  border: 1px solid #2c3244;
  border-radius: 4px;
  padding: 3px 6px;
  font-size: 12px;
}
.sec-label {
  font-size: 11px;
  margin: 8px 0 4px;
}
.done {
  color: #7dd087;
}
.next {
  color: #e8b04b;
}
.step {
  font-size: 12px;
  padding: 1px 0;
  color: #cfd4e4;
}
.step.done {
  color: #7dd087;
}
.connector {
  color: #5b6379;
  font-size: 11px;
}
.asc {
  margin-top: 8px;
  font-size: 12px;
  color: #9a8ae0;
  border-top: 1px dashed #2c3244;
  padding-top: 6px;
}
.dim {
  color: #6b7390;
  font-size: 11px;
}
</style>

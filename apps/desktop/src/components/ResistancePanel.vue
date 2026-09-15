<script setup lang="ts">
import { computed } from 'vue'
import { resistanceGap, sumResistances } from '@poe2coach/core'
import type { GameItem } from '@poe2coach/core'
import { t } from '../i18n'

const props = defineProps<{ items: GameItem[] }>()

const CAP = 75
const totals = computed(() => sumResistances(props.items))
const gap = computed(() => resistanceGap(totals.value))

const ROWS = [
  { key: 'fire', label: '火抗', color: '#d07a4e' },
  { key: 'cold', label: '冰抗', color: '#5aa0d0' },
  { key: 'lightning', label: '电抗', color: '#d0c05a' },
  { key: 'chaos', label: '混沌', color: '#9a6ae0' },
] as const

function pct(total: number): number {
  return Math.min(100, (total / CAP) * 100)
}
</script>

<template>
  <div class="res-panel">
    <div v-for="row in ROWS" :key="row.key" class="res-row">
      <span class="label">{{ t(row.label) }}</span>
      <div class="bar">
        <div class="fill" :style="{ width: pct(totals[row.key]) + '%', background: row.color }" />
        <div class="cap-line" />
      </div>
      <span class="value" :class="{ short: gap[row.key] > 0 }">
        {{ totals[row.key] }}/{{ CAP }}<template v-if="gap[row.key] > 0"> {{ t('缺') }}{{ gap[row.key] }}</template>
      </span>
    </div>
  </div>
</template>

<style scoped>
.res-panel {
  margin-top: 6px;
}
.res-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.label {
  width: 34px;
  font-size: 12px;
  color: #8a93ad;
}
.bar {
  position: relative;
  flex: 1;
  height: 10px;
  background: #171b26;
  border-radius: 5px;
  overflow: hidden;
}
.fill {
  height: 100%;
  border-radius: 5px;
}
.cap-line {
  position: absolute;
  left: 100%;
  top: -2px;
  bottom: -2px;
}
.value {
  width: 82px;
  text-align: right;
  font-size: 11px;
  color: #7dd087;
}
.value.short {
  color: #e06c6c;
}
</style>

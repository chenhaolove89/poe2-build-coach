<script setup lang="ts">
import { computed } from 'vue'
import type { BuildSnapshot } from '@poe2coach/core'

const props = defineProps<{ build: BuildSnapshot }>()

const totalGems = computed(() => props.build.skills.reduce((sum, g) => sum + g.gems.length, 0))
const activeGems = computed(() => props.build.skills.reduce((sum, g) => sum + g.gems.filter((x) => x.enabled).length, 0))
</script>

<template>
  <div class="skills-wrap">
    <div class="skills-meta dim">共 {{ build.skills.length }} 组 · {{ totalGems }} 颗宝石(启用 {{ activeGems }})。</div>
    <div v-for="(g, i) in build.skills" :key="i" class="skill-group">
      <div class="skill-label">{{ g.label ?? '未命名技能组' }}</div>
      <div v-for="gem in g.gems" :key="gem.name + i" class="gem" :class="{ off: !gem.enabled }">
        {{ gem.name }}<span class="dim"> Lv{{ gem.level ?? '?' }}{{ gem.quality ? ` Q${gem.quality}` : '' }}{{ gem.enabled ? '' : ' ·停用' }}</span>
      </div>
    </div>
    <div v-if="build.skills.length === 0" class="dim">这份 Build 没有配置技能组。</div>
  </div>
</template>

<style scoped>
.skills-wrap {
  max-width: 640px;
}
.skills-meta {
  margin-bottom: 12px;
}
.skill-group {
  margin-bottom: 14px;
  background: #10131b;
  border: 1px solid #232939;
  border-radius: 8px;
  padding: 10px 12px;
}
.skill-label {
  font-size: 14px;
  color: #d9a441;
  margin-bottom: 6px;
}
.gem {
  font-size: 13px;
  padding: 2px 0 2px 10px;
  border-left: 2px solid #2c3244;
}
.gem.off {
  color: #5b6379;
  text-decoration: line-through;
}
.dim {
  color: #6b7390;
  font-size: 11px;
}
</style>

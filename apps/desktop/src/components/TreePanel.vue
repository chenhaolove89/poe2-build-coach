<script setup lang="ts">
/**
 * The passive tree view: the canvas plus everything you can do to a selection.
 *
 * Editing is opt-in. Panning has no movement threshold of its own, so a
 * read-only default is what keeps a stray drag from rewriting the node set.
 *
 * This component owns the controls and the preset list; App owns the build and
 * therefore the mutations, since changing nodes also has to regenerate the
 * share code that a save writes.
 */
import { computed, ref } from 'vue'
import type { BuildSnapshot, PointBudget, TreeData, TreeSelectionCheck } from '@poe2coach/core'
import { QUEST_POINT_TOTAL } from '@poe2coach/core'
import { bilingual, t } from '../i18n'
import type { StoredTreePreset } from '../treePresetStore'
import TreeCanvas from './TreeCanvas.vue'

const props = defineProps<{
  tree: TreeData
  build: BuildSnapshot | null
  active: Set<number>
  progress?: Set<number>
  presets: StoredTreePreset[]
  /** Every class the tree data knows, for the class picker. */
  classes: string[]
  /** Ascendancy names offered for the current class. */
  ascendancies: string[]
  /** Result of validating the current selection, for the save button's state. */
  check: TreeSelectionCheck | null
  /** Points spent against their caps, for the readout and the save guard. */
  budget: PointBudget
  /**
   * Campaign books taken, 0-24. They are consumable quest items rather than an
   * automatic reward, so the caller has to say — the ceiling depends on it.
   */
  questPoints: number
  /** Set after a save attempt that was refused or completed. */
  saveMessage: string | null
}>()

const emit = defineEmits<{
  toggleNode: [id: number]
  setClass: [name: string | null]
  setAscendancy: [name: string | null]
  setQuestPoints: [value: number]
  save: []
  removeOrphans: []
  savePreset: [name: string]
  applyPreset: [id: string]
  deletePreset: [id: string]
}>()

const editing = ref(false)
const presetName = ref('')

const selected = computed(() => props.build?.passiveNodes.length ?? 0)
const orphanCount = computed(() => props.check?.orphans.length ?? 0)

/** Both pools are capped, and either one being over is a reason to refuse. */
const mainOver = computed(() => props.budget.mainCap != null && props.budget.mainUsed > props.budget.mainCap)
const ascendancyOver = computed(() => props.budget.ascendancyUsed > props.budget.ascendancyCap)
const overBudget = computed(() => mainOver.value || ascendancyOver.value)

/**
 * Ascendancy already in the selection, which the current class may no longer
 * offer once the build's class changes.
 */
const ascendancyLabel = computed(() => {
  const name = props.build?.ascendClassName
  if (!name) return t('未选')
  return props.ascendancies.includes(name) ? bilingual(name) : `${bilingual(name)} (${t('该职业无此升华')})`
})

function onSavePreset() {
  const name = presetName.value.trim() || t('未命名天赋')
  emit('savePreset', name)
  presetName.value = ''
}
</script>

<template>
  <div class="tree-panel">
    <div class="bar">
      <label class="check">
        <input v-model="editing" type="checkbox" />
        {{ t('编辑模式') }}
      </label>

      <label class="field">
        <span class="dim">{{ t('职业') }}</span>
        <select
          :value="build?.className ?? ''"
          @change="emit('setClass', ($event.target as HTMLSelectElement).value || null)"
        >
          <option value="">{{ t('未选') }}</option>
          <!-- `value` stays the English name: it is what the tree data and the
               connectivity check key on. Only the label is localised. -->
          <option v-for="c in classes" :key="c" :value="c">{{ bilingual(c) }}</option>
        </select>
      </label>

      <label class="field">
        <span class="dim">{{ t('升华') }}</span>
        <select
          :value="build?.ascendClassName ?? ''"
          :disabled="!ascendancies.length"
          @change="emit('setAscendancy', ($event.target as HTMLSelectElement).value || null)"
        >
          <option value="">{{ t('未选') }}</option>
          <option v-for="a in ascendancies" :key="a" :value="a">{{ bilingual(a) }}</option>
        </select>
      </label>
      <span v-if="build?.ascendClassName && !ascendancies.includes(build.ascendClassName)" class="warn">
        {{ ascendancyLabel }}
      </span>

      <span class="points">
        <span :class="{ over: mainOver }">
          {{ t('主树') }} <b>{{ budget.mainUsed }}</b>
          <template v-if="budget.mainCap != null"> / {{ budget.mainCap }}</template>
        </span>
        <span :class="{ over: ascendancyOver }">
          · {{ t('升华') }} <b>{{ budget.ascendancyUsed }}</b> / {{ budget.ascendancyCap }}
        </span>
        <span v-if="budget.granted" class="dim"> · {{ t('节点加成 +') }}{{ budget.granted }}</span>
        <span v-if="build?.level" class="dim"> · Lv{{ build.level }}</span>
      </span>

      <label class="field" :title="t('战役里的 12 本书各给 2 点,是消耗品、不是自动获得,所以要你来填。默认按做完战役算。')">
        <span class="dim">{{ t('战役书') }}</span>
        <input
          class="quests"
          type="number"
          min="0"
          :max="QUEST_POINT_TOTAL"
          step="2"
          :value="questPoints"
          @change="emit('setQuestPoints', Number(($event.target as HTMLInputElement).value) || 0)"
        />
      </label>

      <span class="spacer" />

      <button class="primary" :disabled="!build || overBudget" @click="emit('save')">
        {{ t('保存为 Build') }}
      </button>
    </div>

    <p v-if="!build" class="notice">
      {{ t('先在上方选一个职业就能开始点天赋。也可以载入天赋预设(预设自带职业),或从主页导入 PoB 分享码。') }}
    </p>
    <p v-else-if="!build.passiveNodes.length" class="notice">
      {{ t('这份职业还没有天赋。勾选「编辑模式」后点击节点开始配置。') }}
    </p>
    <p v-else-if="!editing" class="notice dim">
      {{ t('勾选「编辑模式」后点击节点即可加/减天赋。修改会同步到升级顺序。') }}
    </p>
    <p v-else-if="ascendancyOver" class="notice warn">
      {{ t('升华已用') }} {{ budget.ascendancyUsed }} {{ t('点,超过上限') }} {{ budget.ascendancyCap }} {{ t('点(4 次试炼各 2 点)。') }}
    </p>
    <p v-else-if="mainOver" class="notice warn">
      {{ t('主树已用') }} {{ budget.mainUsed }} {{ t('点,超过 Lv') }}{{ build?.level }}{{ t(' 加战役书的') }}
      {{ budget.mainCap }} {{ t('点上限。') }}
    </p>
    <p v-else-if="orphanCount" class="notice warn">
      {{ t('有') }} {{ orphanCount }} {{ t('个节点没有连回职业起点,游戏里点不出来。保存时会被拦下。') }}
    </p>
    <p v-if="saveMessage" class="notice ok">{{ saveMessage }}</p>

    <div class="canvas-wrap">
      <TreeCanvas
        :tree="tree"
        :active="active"
        :progress="progress"
        :editable="editing"
        :ascendancy="build?.ascendClassName ?? null"
        @toggle-node="emit('toggleNode', $event)"
      />
    </div>

    <div class="presets">
      <div class="preset-head">
        <span class="dim">{{ t('天赋预设') }} ({{ presets.length }})</span>
        <input v-model="presetName" class="preset-name" :placeholder="t('预设名称')" @keyup.enter="onSavePreset" />
        <button :disabled="!selected" @click="onSavePreset">{{ t('保存预设') }}</button>
      </div>
      <div v-for="p in presets" :key="p.id" class="preset-item">
        <span class="preset-label" :title="t('套用到当前 Build')" @click="emit('applyPreset', p.id)">
          {{ p.name }}
          <span class="dim">{{ p.className ?? t('未知职业') }} · {{ p.nodes.length }} {{ t('点') }}</span>
        </span>
        <span class="dim">{{ new Date(p.savedAt).toLocaleDateString() }}</span>
        <span class="del" :title="t('删除')" @click="emit('deletePreset', p.id)">✕</span>
      </div>
      <div v-if="!presets.length" class="dim small">
        {{ t('保存后可以随时套用到别的 Build,或作为起点重新配置。') }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.tree-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.bar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 14px;
  background: #10131b;
  border-bottom: 1px solid #232939;
  flex-wrap: wrap;
}
.check {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #cfd4e4;
  cursor: pointer;
  user-select: none;
}
.check input {
  accent-color: #e8b04b;
  cursor: pointer;
  margin: 0;
}
.field {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
select {
  background: #0b0d12;
  color: #cfd4e4;
  border: 1px solid #2c3244;
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 12px;
}
.points {
  font-size: 12px;
  color: #9aa3bd;
}
.points b {
  color: #e8b04b;
  font-size: 14px;
}
.points .over, .points .over b {
  color: #e06c6c;
}
.points span {
  margin-right: 8px;
}
.quests {
  width: 58px;
  background: #0b0d12;
  color: #cfd4e4;
  border: 1px solid #2c3244;
  border-radius: 6px;
  padding: 4px 6px;
  font-size: 12px;
}
.quests:focus {
  outline: none;
  border-color: #e8b04b;
}
.spacer {
  flex: 1;
}
button {
  background: #1a1f2c;
  border: 1px solid #2c3244;
  color: #cfd4e4;
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
}
button:hover:not(:disabled) {
  border-color: #e8b04b;
  color: #e8b04b;
}
button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
button.primary {
  background: #e8b04b;
  border-color: #e8b04b;
  color: #14120a;
  font-weight: 600;
}
button.primary:hover:not(:disabled) {
  color: #14120a;
  filter: brightness(1.08);
}
.notice {
  margin: 0;
  padding: 6px 14px;
  font-size: 11.5px;
  line-height: 1.6;
  background: #171b26;
  border-bottom: 1px solid #232939;
}
.notice.dim {
  color: #8a93ad;
}
.notice.warn {
  background: #241f14;
  color: #d9a441;
}
.notice.ok {
  background: #14201a;
  color: #7dd087;
}
.canvas-wrap {
  flex: 1;
  min-height: 0;
}
.presets {
  border-top: 1px solid #232939;
  background: #10131b;
  padding: 8px 14px;
  max-height: 150px;
  overflow-y: auto;
}
.preset-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.preset-name {
  flex: 1;
  max-width: 240px;
  background: #0b0d12;
  color: #cfd4e4;
  border: 1px solid #2c3244;
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 12px;
}
.preset-name:focus {
  outline: none;
  border-color: #e8b04b;
}
.preset-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 3px 4px;
  border-radius: 4px;
  font-size: 12px;
}
.preset-item:hover {
  background: #171b26;
}
.preset-label {
  flex: 1;
  color: #cfd4e4;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.preset-label:hover {
  color: #e8b04b;
}
.preset-label .dim {
  margin-left: 8px;
  font-size: 11px;
}
.del {
  color: #7a5a5a;
  cursor: pointer;
  padding: 0 4px;
}
.del:hover {
  color: #e06c6c;
}
.warn {
  font-size: 11px;
  color: #d9a441;
}
.dim {
  color: #6b7390;
  font-size: 11px;
}
.small {
  font-size: 11px;
}
</style>

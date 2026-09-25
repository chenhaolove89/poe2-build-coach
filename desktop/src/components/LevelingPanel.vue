<script setup lang="ts">
/**
 * Step-by-step allocation guide for the imported tree.
 *
 * The plan is just an order; the coaching value here is threefold: mark how far
 * you already are (which also lights those nodes up on the tree canvas), show
 * what each upcoming node actually grants, and hand off cleanly to the
 * ascendancy. Progress is set by clicking a step — the raw point count is
 * derived bookkeeping, not something a player thinks in.
 */
import { computed, ref } from 'vue'
import {
  isAscendancy,
  translateStat,
  type BuildSnapshot,
  type LevelingPlan,
  type LevelingStep,
  type TreeData,
  type TreeNode,
} from '@poe2coach/core'
import statTranslationJson from '@poe2coach/data/stat-translations.json'
import { bilingual, t, zhName } from '../i18n'

const STAT_TRANSLATIONS = statTranslationJson as unknown as Parameters<typeof translateStat>[1]

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

/** Upcoming steps rendered as cards; the rest stay reachable through +/- and the tree. */
const NEXT_COUNT = 10

const total = computed(() => props.plan.steps.length)
/** Clamped view of the raw input, so a stray typed 999 cannot break the slices. */
const spent = computed(() => Math.max(0, Math.min(props.currentPoints ?? 0, total.value)))
const past = computed(() => props.plan.steps.slice(0, spent.value))
const next = computed(() => props.plan.steps.slice(spent.value, spent.value + NEXT_COUNT))
const remaining = computed(() => total.value - spent.value)

const pastOpen = ref(false)

const startLabel = computed(() => bilingual(props.build.className, t('未知')))

const labNodes = computed(() => props.plan.unreachable.filter(isAscendancy))
/** Targets the pathing could not reach at all — the tree page draws these as orphans. */
const stranded = computed(() => props.plan.unreachable.filter((n) => !isAscendancy(n)))

function setPoints(n: number) {
  emit('update:currentPoints', Math.max(0, Math.min(n, total.value)))
}

function nodeOf(step: LevelingStep): TreeNode | undefined {
  return props.tree.nodes[step.nodeId]
}

/** First translated stats of the node; falls back to the raw English line. */
function stepStats(step: LevelingStep): string[] {
  const node = nodeOf(step)
  if (!node) return []
  return node.stats.slice(0, 2).map((s) => t(translateStat(s, STAT_TRANSLATIONS) ?? s))
}

/** All raw stats for the hover title, untranslated — the dictionary covers the card. */
function stepTitle(step: LevelingStep): string {
  const node = nodeOf(step)
  return node ? node.stats.join('\n') : ''
}

/**
 * The level at which this step first becomes affordable, on the "one point per
 * level" floor. Book-of-Specialisation points only bring it earlier, so the
 * estimate errs late and never tells the player something is locked that is not.
 */
function earliestLevel(step: LevelingStep): number {
  return step.order + 1
}

/** Kind chip under the same terms the tree canvas' hover uses. */
function kindOf(step: LevelingStep): { label: string; cls: string } | null {
  if (!step.isTarget) return { label: t('路径'), cls: 'path' }
  const node = nodeOf(step)
  if (!node) return null
  if (node.isKeystone) return { label: t('核心天赋 Keystone'), cls: 'keystone' }
  if (node.isNotable) return { label: t('显著天赋 Notable'), cls: 'notable' }
  return null
}

/** zh + en display pair for a node name, or the raw name when unknown. */
function names(step: LevelingStep): { zh: string; en: string | null } {
  const zh = zhName(step.name)
  return zh ? { zh, en: step.name } : { zh: step.name, en: null }
}

function labName(node: TreeNode): string {
  const zh = zhName(node.name)
  return zh ? `${zh} ${node.name}` : node.name
}
</script>

<template>
  <div class="leveling">
    <div class="head">
      <h2>{{ t('逐级点法 · 从') }} {{ startLabel }} {{ t('出发') }}</h2>
      <button class="ghost" @click="emit('openTree')">{{ t('去天赋树高亮 ↗') }}</button>
    </div>

    <div class="progress card">
      <div class="bar-outer" :title="`${spent} / ${total}`">
        <div class="bar-inner" :style="{ width: `${total ? (spent / total) * 100 : 0}%` }" />
      </div>
      <div class="bar-row">
        <button class="step-btn" :disabled="spent <= 0" @click="setPoints(spent - 1)">−</button>
        <input
          :value="currentPoints ?? ''"
          type="number"
          min="0"
          :max="total"
          placeholder="0"
          @input="
            emit(
              'update:currentPoints',
              ($event.target as HTMLInputElement).value === ''
                ? null
                : Number(($event.target as HTMLInputElement).value),
            )
          "
        />
        <button class="step-btn" :disabled="spent >= total" @click="setPoints(spent + 1)">＋</button>
        <span class="dim nums">
          {{ t('已点') }} {{ spent }} / {{ total }} {{ t('点') }}
          <template v-if="remaining > 0">· {{ t('还差') }} {{ remaining }} {{ t('点') }}</template>
          <template v-else>· {{ t('全部点完') }}</template>
        </span>
      </div>
      <p v-if="currentPoints == null" class="hint dim">
        {{ t('在下面的步骤上点「到此」,或用 ＋/− 告诉工具你点到了哪 —— 天赋树页会同步亮起应已点亮的节点。') }}
      </p>
    </div>

    <template v-if="past.length">
      <button class="sec-label done clickable" @click="pastOpen = !pastOpen">
        {{ t('应已分配') }} ({{ past.length }})
        <span class="tri">{{ pastOpen ? '▾' : '▸' }}</span>
      </button>
      <div v-show="pastOpen">
        <div v-for="step in past" :key="step.order" class="step card past">
          <span class="order">{{ step.order }}</span>
          <span class="name">
            <template v-if="names(step).en"><b>{{ names(step).zh }}</b><span class="en">{{ names(step).en }}</span></template>
            <template v-else>{{ names(step).zh }}</template>
            <span v-if="kindOf(step)" class="chip" :class="kindOf(step)!.cls">{{ kindOf(step)!.label }}</span>
          </span>
          <button class="rewind" @click="setPoints(step.order - 1)">{{ t('退到这里') }}</button>
        </div>
      </div>

      <div class="sec-label next">{{ t('接下来') }} ({{ remaining }})</div>
    </template>

    <div v-for="(step, i) in next" :key="step.order" class="step card upcoming" :class="{ first: i === 0 }">
      <span class="order">{{ step.order }}</span>
      <span class="body">
        <span class="name">
          <template v-if="names(step).en"><b>{{ names(step).zh }}</b><span class="en">{{ names(step).en }}</span></template>
          <template v-else>{{ names(step).zh }}</template>
          <span v-if="kindOf(step)" class="chip" :class="kindOf(step)!.cls">{{ kindOf(step)!.label }}</span>
        </span>
        <span v-if="stepStats(step).length" class="stats" :title="stepTitle(step)">
          <span v-for="s in stepStats(step)" :key="s" class="stat">{{ s }}</span>
        </span>
      </span>
      <span class="lvl" :title="t('按主树每级 1 点估算,战役书奖励点会让它更早;仅供参考。')">{{ t('最早') }} Lv~{{ earliestLevel(step) }}</span>
      <button class="mark" @click="setPoints(step.order)">{{ t('到此') }}</button>
    </div>
    <p v-if="!next.length && total > 0" class="state ok">{{ t('主树点完了 —— 剩下的只有升华点。') }}</p>

    <div v-if="labNodes.length" class="card lab">
      {{ t('另有') }} {{ labNodes.length }} {{ t('个升华节点,迷宫试炼获取,不占上面的顺序:') }}
      <span class="lab-names">{{ labNodes.map(labName).join('、') }}</span>
    </div>
    <div v-if="stranded.length" class="card lab warn">
      {{ t('还有') }} {{ stranded.length }} {{ t('个目标节点连不回职业起点,游戏里点不出来 —— 到天赋树页用「移除孤立节点」清理。') }}
    </div>
  </div>
</template>

<style scoped>
.leveling {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid #232939;
  padding-bottom: 6px;
  margin-bottom: 4px;
}
h2 {
  font-size: 13px;
  color: #8a93ad;
  margin: 0;
}
.card {
  background: #10131b;
  border: 1px solid #232939;
  border-radius: 8px;
}
.progress {
  padding: 12px 14px;
  margin-bottom: 6px;
}
.bar-outer {
  height: 6px;
  background: #0b0d12;
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 10px;
}
.bar-inner {
  height: 100%;
  background: #e8b04b;
  border-radius: 3px;
  transition: width 0.15s ease;
}
.bar-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.bar-row input {
  width: 64px;
  background: #0b0d12;
  color: #cfd4e4;
  border: 1px solid #2c3244;
  border-radius: 4px;
  padding: 3px 6px;
  font-size: 12px;
}
.nums {
  margin-left: auto;
}
.hint {
  margin: 8px 0 0;
  font-size: 11px;
  line-height: 1.7;
}
.step-btn {
  width: 28px;
  padding: 3px 0;
  background: #1a1f2c;
  border: 1px solid #2c3244;
  color: #cfd4e4;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
}
.step-btn:hover:not(:disabled) {
  border-color: #e8b04b;
  color: #e8b04b;
}
.step-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.sec-label {
  font-size: 11px;
  margin: 8px 0 2px;
}
.sec-label.done {
  color: #7dd087;
}
.sec-label.next {
  color: #e8b04b;
}
.clickable {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
}
.clickable:hover {
  color: #cfd4e4;
}
.tri {
  font-size: 9px;
  color: #6b7390;
}
.step {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  margin: 4px 0;
}
.step.past {
  color: #7dd087;
}
.step.upcoming {
  align-items: flex-start;
}
.step.upcoming.first {
  border-color: #4a3d20;
  background: #17130a;
}
.order {
  flex: 0 0 26px;
  font-family: 'Consolas', 'Menlo', monospace;
  font-size: 12px;
  color: #6b7390;
  text-align: right;
}
.body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}
.name {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 12px;
  color: #cfd4e4;
}
.name .en {
  color: #6b7390;
  font-size: 11px;
}
.chip {
  font-size: 10px;
  border-radius: 8px;
  padding: 0 7px;
  line-height: 16px;
}
.chip.path {
  color: #6b7390;
  border: 1px solid #2c3244;
}
.chip.keystone {
  color: #d9a441;
  border: 1px solid #4a3d20;
}
.chip.notable {
  color: #7aa5d9;
  border: 1px solid #2c3d55;
}
.stats {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.stat {
  font-size: 11px;
  color: #9aa3bd;
  line-height: 1.5;
}
.lvl {
  flex: 0 0 auto;
  font-size: 10px;
  color: #6b7390;
  white-space: nowrap;
  align-self: center;
}
.mark,
.rewind {
  flex: 0 0 auto;
  background: #1a1f2c;
  border: 1px solid #2c3244;
  color: #9aa3bd;
  border-radius: 5px;
  padding: 3px 9px;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}
.mark:hover {
  border-color: #e8b04b;
  color: #e8b04b;
}
.rewind:hover {
  border-color: #7dd087;
  color: #7dd087;
}
.ghost {
  background: none;
  border: 1px solid #2c3244;
  color: #9aa3bd;
  border-radius: 6px;
  padding: 3px 10px;
  font-size: 11px;
  cursor: pointer;
}
.ghost:hover {
  border-color: #e8b04b;
  color: #e8b04b;
}
.lab {
  margin-top: 8px;
  padding: 9px 12px;
  font-size: 12px;
  color: #9a8ae0;
  line-height: 1.7;
}
.lab.warn {
  color: #d9a441;
}
.lab-names {
  color: #c4b8f0;
}
.state {
  font-size: 12px;
  margin: 8px 0;
}
.state.ok {
  color: #7dd087;
}
.dim {
  color: #6b7390;
  font-size: 11px;
}
</style>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { compareItems, itemPriorityCheck, itemResistances, parseItemText } from '@poe2coach/core'
import type { GameItem, ItemDiff } from '@poe2coach/core'
import priorityJson from '@poe2coach/data/affix-priorities.json'

const PRIORITY = priorityJson as unknown as Parameters<typeof itemPriorityCheck>[1]

const KEYWORD_LABEL: Record<string, string> = {
  'maximum Life': '生命',
  Resistances: '抗性',
  'Movement Speed': '移速',
  Damage: '伤害',
  Speed: '攻/施速',
  Critical: '暴击',
  'maximum Mana': '魔力',
  'Level of': '+技能等级',
}

const props = defineProps<{ items: GameItem[] }>()

/** Flasks and jewelry-adjacent consumables carry no affix expectations. */
function priorityApplies(item: GameItem): boolean {
  const hay = `${item.itemClass ?? ''} ${item.base ?? ''}`.toLowerCase()
  return !(hay.includes('flask') || hay.includes('jewel') || hay.includes('soul core'))
}

function priorityOf(item: GameItem) {
  return itemPriorityCheck(item, PRIORITY)
}

function kwLabel(kw: string): string {
  return KEYWORD_LABEL[kw] ?? kw
}

const selectedIndex = ref<number | null>(null)
const pasteText = ref('')
const pasteError = ref<string | null>(null)
const pasted = ref<GameItem | null>(null)

const selected = computed(() => (selectedIndex.value == null ? null : props.items[selectedIndex.value] ?? null))

function select(i: number) {
  selectedIndex.value = selectedIndex.value === i ? null : i
}

function onParsePaste() {
  pasteError.value = null
  pasted.value = null
  try {
    pasted.value = parseItemText(pasteText.value)
  } catch (e) {
    pasteError.value = String(e)
  }
}

const diff = computed<ItemDiff | null>(() => {
  if (!selected.value || !pasted.value) return null
  return compareItems(selected.value, pasted.value)
})

const selectedRes = computed(() => (selected.value ? itemResistances(selected.value) : null))
const pastedRes = computed(() => (pasted.value ? itemResistances(pasted.value) : null))

const KIND_COLOR: Record<string, string> = {
  implicit: '#7a8299',
  rune: '#6fa8dc',
  enchant: '#6fa8dc',
  fractured: '#d4a343',
  crafted: '#7dd087',
  explicit: '#cfd4e4',
  pseudo: '#8a93ad',
}
const KIND_LABEL: Record<string, string> = {
  implicit: '隐式',
  rune: '符文',
  enchant: '魔附',
  fractured: '裂变',
  crafted: '制作',
  explicit: '',
}

function resText(r: { fire: number; cold: number; lightning: number; chaos: number }): string {
  const parts: string[] = []
  if (r.fire) parts.push(`火${r.fire > 0 ? '+' : ''}${r.fire}`)
  if (r.cold) parts.push(`冰${r.cold > 0 ? '+' : ''}${r.cold}`)
  if (r.lightning) parts.push(`电${r.lightning > 0 ? '+' : ''}${r.lightning}`)
  if (r.chaos) parts.push(`混沌${r.chaos > 0 ? '+' : ''}${r.chaos}`)
  return parts.length ? parts.join(' / ') : '—'
}

function resDeltaClass(v: number): string {
  return v > 0 ? 'up' : v < 0 ? 'down' : ''
}
</script>

<template>
  <div>
    <h2>装备 · 点击选中比对</h2>
    <div v-for="(item, i) in items" :key="i" class="gear-card" :class="{ active: selectedIndex === i }" @click="select(i)">
      <div class="gear-title">
        <span :class="'rarity-' + (item.rarity ?? 'NORMAL').toLowerCase()">{{ item.name ?? item.base ?? '未知物品' }}</span>
        <span class="dim" v-if="item.base && item.name"> · {{ item.base }}</span>
      </div>
      <div class="dim meta">
        {{ item.rarity }}{{ item.itemClass ? ` · ${item.itemClass}` : '' }}{{ item.corrupted ? ' · 已腐化' : ''
        }}{{ item.rune ? ` · ${item.rune}` : '' }} · {{ item.mods.length }} 词缀
      </div>
      <div v-if="priorityApplies(item) && priorityOf(item).core.length" class="core-row">
        <span
          v-for="kw in priorityOf(item).core"
          :key="kw"
          class="core-badge"
          :class="priorityOf(item).coreHits.includes(kw) ? 'has' : 'missing'"
          :title="'核心词缀:' + kw"
        >
          {{ priorityOf(item).coreHits.includes(kw) ? '✓' : '✗' }} {{ kwLabel(kw) }}
        </span>
      </div>
      <div v-if="selectedIndex === i" class="mods">
        <div v-for="(mod, mi) in item.mods" :key="mi" class="mod">
          <span class="kind" :style="{ color: KIND_COLOR[mod.kind] }">{{ KIND_LABEL[mod.kind] || '' }}</span>
          <span :style="{ color: KIND_COLOR[mod.kind] }">{{ mod.text }}</span>
        </div>
        <div v-if="selectedRes" class="dim res-line">抗性贡献:{{ resText(selectedRes) }}</div>
      </div>
    </div>

    <h2>换装比对</h2>
    <p class="dim tip">
      游戏内对物品按 Ctrl+C 复制,粘贴到这里。<template v-if="selected">将与选中的「{{ selected.name ?? selected.base }}」比对。</template>
      <template v-else>先在上方点击选中一件 Build 装备再粘贴,可直接看差异。</template>
    </p>
    <textarea v-model="pasteText" rows="5" placeholder="粘贴游戏内物品文本…" spellcheck="false" />
    <div class="btn-row">
      <button :disabled="!pasteText.trim()" @click="onParsePaste">解析物品</button>
    </div>
    <p v-if="pasteError" class="error">{{ pasteError }}</p>

    <div v-if="pasted" class="paste-result">
      <div class="gear-title">
        <span :class="'rarity-' + (pasted.rarity ?? 'NORMAL').toLowerCase()">{{ pasted.name ?? pasted.base }}</span>
        <span class="dim" v-if="pasted.base && pasted.name"> · {{ pasted.base }}</span>
      </div>
      <div class="dim meta">{{ pasted.rarity }} · {{ pasted.mods.length }} 词缀 · 抗性 {{ resText(pastedRes!) }}</div>

      <template v-if="diff">
        <div class="diff-title dim">相比「{{ selected!.name ?? selected!.base }}」:</div>
        <div v-for="(m, i) in diff.added" :key="'a' + i" class="mod-line up">+ {{ m.text }}</div>
        <div v-for="(m, i) in diff.removed" :key="'r' + i" class="mod-line down">− {{ m.text }}</div>
        <div class="mod-line dim">抗性变化:火 <b :class="resDeltaClass(diff.resistances.fire)">{{ diff.resistances.fire }}</b> · 冰 <b :class="resDeltaClass(diff.resistances.cold)">{{ diff.resistances.cold }}</b> · 电 <b :class="resDeltaClass(diff.resistances.lightning)">{{ diff.resistances.lightning }}</b> · 混沌 <b :class="resDeltaClass(diff.resistances.chaos)">{{ diff.resistances.chaos }}</b></div>
      </template>
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
.tip {
  font-size: 12px;
  margin-bottom: 8px;
}
.gear-card {
  border: 1px solid #232939;
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 8px;
  cursor: pointer;
}
.gear-card.active {
  border-color: #e8b04b;
  background: #1a1a12;
}
.gear-title {
  font-size: 13px;
}
.meta {
  font-size: 11px;
  margin-top: 2px;
}
.core-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.core-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  border: 1px solid #2c3244;
}
.core-badge.has {
  color: #7dd087;
  border-color: #2f4a38;
}
.core-badge.missing {
  color: #e06c6c;
  border-color: #4a2f2f;
}
.mods {
  margin-top: 6px;
  border-top: 1px dashed #2c3244;
  padding-top: 6px;
}
.mod {
  font-size: 12px;
  padding: 1px 0;
}
.kind {
  display: inline-block;
  width: 32px;
  font-size: 10px;
}
.res-line {
  margin-top: 4px;
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
  margin-top: 6px;
}
button {
  width: 100%;
  padding: 7px 0;
  border: 1px solid #2c3244;
  border-radius: 6px;
  background: #1a1f2c;
  color: #cfd4e4;
  cursor: pointer;
  font-size: 13px;
}
button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.paste-result {
  margin-top: 10px;
  border: 1px solid #232939;
  border-radius: 6px;
  padding: 8px 10px;
}
.diff-title {
  margin: 6px 0 4px;
}
.mod-line {
  font-size: 12px;
  padding: 1px 0;
}
.up {
  color: #7dd087;
}
.down {
  color: #e06c6c;
}
.error {
  color: #e06c6c;
  font-size: 12px;
  margin: 8px 0 0;
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
</style>

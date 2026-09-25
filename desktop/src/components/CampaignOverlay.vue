<script setup lang="ts">
/**
 * The in-game campaign pin: a small always-on-top panel over the game showing
 * the current act only, with a pointer the player advances after each zone.
 *
 * Two interactions matter while the game has the foreground:
 *  - The window is never focusable, so clicking 下一条 cannot pull the game out
 *    of focus — the panel behaves like a sticky note, not a second app.
 *  - The lock switch decides whether the header is a drag region. Locked (the
 *    settled state) the panel cannot be dragged by accident; unlocked the
 *    header drags the window so it can be parked where the HUD has room.
 *
 * All state is localStorage shared with the main window's 剧情路线 tab; `storage`
 * events keep the two views in step while both are open. This window has only
 * the two Tauri permissions it needs (start-dragging, hide) — see
 * capabilities/campaign-overlay.json.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { LogicalSize } from '@tauri-apps/api/dpi'
import { t } from '../i18n'
import ZoneMap from './ZoneMap.vue'
import {
  CAMPAIGN_ACTS,
  actById,
  mapFor,
  readDone,
  readNotes,
  readPanelPrefs,
  readPointer,
  writeDone,
  writePanelPrefs,
  writePointer,
  zoneKey,
  type CampaignReward,
  type CampaignZone,
} from '../campaign'

const done = ref<Set<string>>(readDone())
const pointer = ref(readPointer())
const prefs = ref(readPanelPrefs())
const notes = ref(readNotes())

function sync() {
  done.value = readDone()
  pointer.value = readPointer()
  notes.value = readNotes()
}

onMounted(() => window.addEventListener('storage', sync))
onBeforeUnmount(() => window.removeEventListener('storage', sync))

const act = computed(() => actById(pointer.value.act) ?? CAMPAIGN_ACTS[0])
const index = computed(() => pointer.value.index)
const zone = computed(() => act.value.zones[index.value])
const isDone = computed(() => done.value.has(zoneKey(act.value, zone.value)))
const actDoneCount = computed(() => act.value.zones.filter((z) => done.value.has(zoneKey(act.value, z))).length)
const curSpec = computed(() => mapFor(act.value, zone.value))
const curNote = computed(() => notes.value[zoneKey(act.value, zone.value)] ?? '')
const onLastZoneOfLastAct = computed(() => {
  const last = CAMPAIGN_ACTS[CAMPAIGN_ACTS.length - 1]
  return pointer.value.act === last.id && index.value === last.zones.length - 1
})

/** Tick one zone of the current act by list position (the ✓ box on each row). */
function toggleTickAt(i: number) {
  const target = act.value.zones[i]
  const next = new Set(done.value)
  const key = zoneKey(act.value, target)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  done.value = next
  writeDone(next)
}

/** Advance the pointer; at the end of an act it rolls into the next one. */
function goNext() {
  if (onLastZoneOfLastAct.value) return
  if (index.value < act.value.zones.length - 1) {
    pointer.value = { act: act.value.id, index: index.value + 1 }
  } else {
    const i = CAMPAIGN_ACTS.indexOf(act.value)
    pointer.value = { act: CAMPAIGN_ACTS[i + 1].id, index: 0 }
  }
  writePointer(pointer.value)
}

function goPrev() {
  if (index.value > 0) {
    pointer.value = { act: act.value.id, index: index.value - 1 }
  } else {
    const i = CAMPAIGN_ACTS.indexOf(act.value)
    if (i > 0) pointer.value = { act: CAMPAIGN_ACTS[i - 1].id, index: CAMPAIGN_ACTS[i - 1].zones.length - 1 }
  }
  writePointer(pointer.value)
}

function jumpTo(i: number) {
  pointer.value = { act: act.value.id, index: i }
  writePointer(pointer.value)
}

function toggleLock() {
  prefs.value = { ...prefs.value, locked: !prefs.value.locked }
  writePanelPrefs(prefs.value)
}

function toggleCollapse() {
  prefs.value = { ...prefs.value, collapsed: !prefs.value.collapsed }
  writePanelPrefs(prefs.value)
}

async function hidePanel() {
  try {
    await getCurrentWebviewWindow().hide()
  } catch {
    /* browser preview has no window to hide */
  }
}

/**
 * Fit the window to the content so a short act never shows a big empty pane:
 * collapsed is one bar plus the act's route map, expanded adds the current
 * zone's sketch. Estimates only — the routes list scrolls if an act runs long.
 */
async function syncSize() {
  try {
    const h = prefs.value.collapsed
      ? Math.min(400, Math.max(120, 58 + act.value.zones.length * 21))
      : 500
    await getCurrentWebviewWindow().setSize(new LogicalSize(330, h))
  } catch {
    /* browser preview has no window to size */
  }
}

watch([() => prefs.value.collapsed, () => act.value.id], syncSize, { immediate: true })

const ELE_ZH: Record<string, string> = { cold: '冰', lightning: '雷', fire: '火' }

/**
 * Route-map markers: the map stays clean, so only the rewards a player hunts
 * get a badge — the book points, and the choose-one stat picks. Everything else
 * lives in the row's hover title.
 */
function mapChip(zone: CampaignZone): { label: string; cls: string } | null {
  for (const r of zone.rewards ?? []) {
    if (r.kind === 'points') return { label: `+${r.amount ?? 2}`, cls: 'points' }
    if (r.kind === 'attribute' || r.kind === 'choice') return { label: '◆', cls: 'attr' }
  }
  return null
}

function rowTitle(zone: CampaignZone): string {
  const labels = (zone.rewards ?? []).map((r) => chipOf(r).label + (chipOf(r).title ? `(${chipOf(r).title})` : ''))
  const parts: string[] = []
  if (labels.length) parts.push(t(labels.join('、')))
  if (zone.route) parts.push(t(zone.route))
  return parts.join('\n')
}

interface Chip {
  label: string
  cls: string
  title: string
}

function chipOf(r: CampaignReward): Chip {
  switch (r.kind) {
    case 'points':
      return { label: t(`+${r.amount ?? 2} 天赋点`), cls: 'points', title: r.note ?? '' }
    case 'spirit':
      return { label: t(`+${r.amount ?? 0} 精魂`), cls: 'spirit', title: r.note ?? '' }
    case 'life':
      return { label: t(`+${r.amount ?? 0} 生命`), cls: 'life', title: r.note ?? '' }
    case 'mana':
      return { label: t(`+${r.amount ?? 0}% 魔力`), cls: 'mana', title: r.note ?? '' }
    case 'resist':
      return { label: t(`+${r.amount ?? 0}% ${ELE_ZH[r.ele ?? ''] ?? ''}抗`), cls: 'resist', title: r.note ?? '' }
    case 'charmSlot':
      return { label: t(`+${r.amount ?? 1} 符咒位`), cls: 'mana', title: r.note ?? '' }
    case 'attribute':
      return { label: t(`+${r.amount ?? 5} 属性(择一)`), cls: 'attr', title: r.note ?? '' }
    case 'choice':
      return { label: t('择一强化'), cls: 'choice', title: t((r.options ?? []).join(' / ')) }
    case 'bench':
      return { label: t(r.note ?? '解锁功能'), cls: 'util', title: '' }
    case 'trial':
      return { label: t('升华试炼'), cls: 'trial', title: r.note ?? '' }
    case 'loot':
      return { label: t(r.note ?? '奖励'), cls: 'util', title: '' }
    default:
      return { label: r.note ?? r.kind, cls: 'util', title: '' }
  }
}
</script>

<template>
  <div class="panel" :class="{ mini: prefs.collapsed }">
    <!-- Expanded: act header, the pointer controls, then every zone of the act
         with its objective and rewards — the whole chapter, not just a teaser -->
    <template v-if="!prefs.collapsed">
      <div class="head" :data-tauri-drag-region="prefs.locked ? null : ''">
        <span class="grip" title="拖动标题栏移动位置" :data-tauri-drag-region="prefs.locked ? null : ''">⋮⋮</span>
        <span class="act-name" :data-tauri-drag-region="prefs.locked ? null : ''">{{ t(act.zh) }}</span>
        <span class="dim levels">Lv {{ act.levels }}</span>
        <span class="count">{{ actDoneCount }}/{{ act.zones.length }}</span>
        <button class="ctl" :title="prefs.locked ? t('已锁定：位置固定') : t('已解锁：拖动标题栏移动')" :class="{ on: prefs.locked }" @click="toggleLock">
          {{ prefs.locked ? '🔒' : '🔓' }}
        </button>
        <button class="ctl" :title="t('收缩成一横条')" @click="toggleCollapse">▾</button>
        <button class="ctl" :title="t('隐藏(主窗口可再打开)')" @click="hidePanel">×</button>
      </div>

      <div class="nav">
        <button @click="goPrev">◀</button>
        <button class="next" :disabled="onLastZoneOfLastAct" @click="goNext">
          {{ onLastZoneOfLastAct ? t('全部剧情完成') : t('下一条 ▶') }}
        </button>
      </div>

      <div v-if="curSpec" class="curmap">
        <ZoneMap
          :spec="curSpec"
          :labels="true"
          :interactive="true"
          :map-key="zoneKey(act, zone)"
        />
        <p v-if="curSpec.conf || curSpec.variants" class="mapmeta">
          <span v-if="curSpec.conf" class="conf">布局把握 · {{ curSpec.conf }}</span>
          <span v-if="curSpec.variants" class="dim">{{ curSpec.variants }}</span>
        </p>
        <p v-if="curNote" class="cur-note">📝 {{ curNote }}</p>
      </div>

      <p v-if="act.note" class="dim note">{{ t(act.note) }}</p>

      <div class="zlist">
        <div
          v-for="(z, i) in act.zones"
          :key="z.en"
          class="zrow"
          :class="{ cur: i === index, did: done.has(zoneKey(act, z)) }"
          @click="jumpTo(i)"
        >
          <span
            class="tickbox"
            :class="{ on: done.has(zoneKey(act, z)) }"
            :title="t('标记为已跑过')"
            @click.stop="toggleTickAt(i)"
          >
            {{ done.has(zoneKey(act, z)) ? '✓' : '' }}
          </span>
          <div class="zrow-main">
            <div class="zname">
              <span class="zi">{{ i + 1 }}</span>
              {{ z.zh ? t(z.zh) : z.en }} <span class="dim en">{{ z.en }}</span>
              <span v-if="z.layout" class="chip util">{{ t(z.layout) }}</span>
            </div>
            <div class="dim obj">{{ t(z.objective) }}</div>
            <div v-if="z.route" class="dim obj route">{{ t('跑法') }} · {{ t(z.route) }}</div>
            <div v-if="z.rewards?.length" class="chips">
              <span v-for="(chip, ci) in z.rewards.map(chipOf)" :key="ci" class="chip" :class="chip.cls" :title="chip.title">
                {{ chip.label }}
              </span>
            </div>
          </div>
          <span v-if="notes[zoneKey(act, z)]" class="hasnote" title="有笔记">📝</span>
          <span v-if="i === index" class="here">{{ t('当前') }}</span>
        </div>
      </div>
    </template>

    <!-- Collapsed: one bar with the zone to do next, over the act's route map -->
    <template v-else>
      <div class="head mini-head" :data-tauri-drag-region="prefs.locked ? null : ''">
        <span class="act-mini" :data-tauri-drag-region="prefs.locked ? null : ''">{{ t(act.zh) }}</span>
        <span class="zname-mini" :class="{ did: isDone }" :data-tauri-drag-region="prefs.locked ? null : ''">
          {{ zone.zh ? t(zone.zh) : zone.en }}
        </span>
        <button class="ctl" @click="goPrev">◀</button>
        <button class="ctl next" :disabled="onLastZoneOfLastAct" @click="goNext">▶</button>
        <button class="ctl" :class="{ on: prefs.locked }" @click="toggleLock">{{ prefs.locked ? '🔒' : '🔓' }}</button>
        <button class="ctl" @click="toggleCollapse">▸</button>
        <button class="ctl" @click="hidePanel">×</button>
      </div>
      <div class="routemap">
        <div
          v-for="(z, i) in act.zones"
          :key="z.en"
          class="rm-row"
          :class="{ cur: i === index, did: done.has(zoneKey(act, z)) }"
          :title="rowTitle(z)"
          @click="jumpTo(i)"
        >
          <span v-if="i > 0" class="rm-line" />
          <span class="rm-dot">{{ done.has(zoneKey(act, z)) ? '✓' : '' }}</span>
          <span class="rm-name">{{ z.zh ? t(z.zh) : z.en }}</span>
          <span v-if="mapChip(z)" class="chip" :class="mapChip(z)!.cls">{{ mapChip(z)!.label }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.panel {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #0d1017;
  border: 1px solid #2c3244;
  border-radius: 10px;
  overflow: hidden;
  font-size: 12px;
}
.panel.mini {
  height: auto;
  border-radius: 8px;
}
.head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px 7px 10px;
  background: #141826;
  border-bottom: 1px solid #232939;
  flex: 0 0 auto;
  user-select: none;
}
.mini-head {
  background: #141826;
}
.grip {
  color: #4a5166;
  font-size: 11px;
  letter-spacing: -2px;
  cursor: move;
}
.act-name {
  font-weight: 600;
  color: #e8b04b;
  white-space: nowrap;
}
.act-mini {
  color: #e8b04b;
  white-space: nowrap;
  max-width: 84px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.levels {
  font-size: 10px;
}
.count {
  margin-left: auto;
  font-size: 10px;
  color: #9aa3bd;
  border: 1px solid #2c3244;
  border-radius: 8px;
  padding: 0 6px;
  white-space: nowrap;
}
.zname-mini {
  color: #cfd4e4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}
.zname-mini.did {
  color: #7dd087;
}
.ctl {
  flex: 0 0 auto;
  background: #1a1f2c;
  border: 1px solid #2c3244;
  color: #9aa3bd;
  border-radius: 5px;
  padding: 2px 7px;
  font-size: 11px;
  cursor: pointer;
}
.ctl:hover {
  border-color: #e8b04b;
  color: #e8b04b;
}
.ctl.on {
  border-color: #4a3d20;
  color: #e8b04b;
}
.ctl.next {
  color: #e8b04b;
}
.ctl:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.note {
  margin: 6px 10px 0;
  font-size: 10px;
  line-height: 1.5;
}
.zlist {
  border-top: 1px solid #1a1f2c;
  overflow-y: auto;
  flex: 1;
}
.zrow {
  display: flex;
  gap: 8px;
  padding: 7px 10px 7px 12px;
  border-bottom: 1px solid #141826;
  border-left: 2px solid transparent;
  cursor: pointer;
}
.zrow:hover {
  background: #121623;
}
.zrow.cur {
  border-left-color: #e8b04b;
  background: #17130a;
}
.here {
  flex: 0 0 auto;
  align-self: center;
  font-size: 10px;
  color: #e8b04b;
  border: 1px solid #4a3d20;
  border-radius: 8px;
  padding: 0 6px;
  white-space: nowrap;
}
.tickbox {
  flex: 0 0 18px;
  height: 18px;
  margin-top: 1px;
  border: 1px solid #2c3244;
  border-radius: 5px;
  background: #0b0d12;
  color: #7dd087;
  font-size: 12px;
  line-height: 16px;
  text-align: center;
  cursor: pointer;
}
.tickbox.on {
  border-color: #2c5540;
  background: #12251a;
}
.zrow-main {
  min-width: 0;
  flex: 1;
}
.zrow.did .zname {
  color: #6b7390;
}
.zrow.did .obj {
  color: #4a5166;
}
.zname {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
  color: #cfd4e4;
  font-weight: 600;
  font-size: 12px;
}
.zname .zi {
  flex: 0 0 auto;
  color: #525a72;
  font-family: 'Consolas', 'Menlo', monospace;
  font-size: 10px;
  font-weight: 400;
}
.zrow.cur .zname .zi {
  color: #e8b04b;
}
.zname .en {
  font-weight: 400;
  font-size: 10px;
}
.obj {
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.55;
}
.obj.route {
  color: #7d86a2;
  margin-top: 1px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.chip {
  font-size: 10px;
  border-radius: 8px;
  padding: 0 7px;
  line-height: 16px;
  white-space: nowrap;
}
.chip.points {
  color: #e8b04b;
  border: 1px solid #4a3d20;
}
.chip.spirit,
.chip.trial {
  color: #b39ae8;
  border: 1px solid #3d3364;
}
.chip.life {
  color: #7dd087;
  border: 1px solid #2c5540;
}
.chip.mana {
  color: #6dc5b8;
  border: 1px solid #274b45;
}
.chip.resist {
  color: #7aa5d9;
  border: 1px solid #2c3d55;
}
.chip.attr {
  color: #d98fb0;
  border: 1px solid #552c40;
}
.chip.choice {
  color: #d9a441;
  border: 1px solid #4a3d20;
  background: #1f1a10;
}
.chip.util {
  color: #9aa3bd;
  border: 1px solid #2c3244;
}
.nav {
  display: flex;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid #1a1f2c;
}
.nav button {
  background: #1a1f2c;
  border: 1px solid #2c3244;
  color: #9aa3bd;
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
}
.nav button:hover:not(:disabled) {
  border-color: #e8b04b;
  color: #e8b04b;
}
.nav .next {
  flex: 1;
  color: #e8b04b;
  border-color: #4a3d20;
}
.nav button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.curmap {
  padding: 0 10px 8px;
  border-bottom: 1px solid #1a1f2c;
  background: #0b0d12;
  border-radius: 6px;
  margin: 0 10px 8px;
  border: 1px solid #232939;
}
.curmap + .note {
  margin-top: 6px;
}
.mapmeta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 3px 8px;
  padding: 0 6px 6px;
  font-size: 10px;
}
.mapmeta .conf {
  color: #e8b04b;
  border: 1px solid #4a3d20;
  border-radius: 7px;
  padding: 0 6px;
  line-height: 15px;
  white-space: nowrap;
}
.mapmeta .dim {
  font-size: 10px;
}
.cur-note {
  margin: 0;
  padding: 0 6px 6px;
  font-size: 10px;
  line-height: 1.5;
  color: #c9c0a0;
}
.hasnote {
  font-size: 10px;
  opacity: 0.85;
}
.dim {
  color: #6b7390;
}
.routemap {
  flex: 1;
  overflow-y: auto;
  padding: 9px 10px 11px 12px;
}
.rm-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 3.5px 0;
  position: relative;
  cursor: pointer;
}
.rm-row:hover .rm-name {
  color: #cfd4e4;
}
.rm-dot {
  flex: 0 0 12px;
  height: 12px;
  border-radius: 50%;
  border: 1px solid #3a4358;
  background: #0b0d12;
  position: relative;
  z-index: 1;
  font-size: 8px;
  line-height: 11px;
  text-align: center;
  color: #7dd087;
}
/* the path: a thread from the previous dot down to this one */
.rm-line {
  position: absolute;
  left: 5px;
  top: -9px;
  width: 2px;
  height: 19px;
  background: #232b3d;
}
.rm-row.did .rm-dot {
  background: #12251a;
  border-color: #2c5540;
}
.rm-row.cur .rm-dot {
  background: #e8b04b;
  border-color: #e8b04b;
  box-shadow: 0 0 7px rgba(232, 176, 75, 0.55);
}
.rm-name {
  color: #8a93ad;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.rm-row.did .rm-name {
  color: #525a72;
}
.rm-row.cur .rm-name {
  color: #e8b04b;
  font-weight: 600;
}
.routemap .chip {
  font-size: 9px;
  border-radius: 7px;
  padding: 0 5px;
  line-height: 13px;
  white-space: nowrap;
}
.routemap .chip.points {
  color: #e8b04b;
  border: 1px solid #4a3d20;
}
.routemap .chip.attr {
  color: #d98fb0;
  border: 1px solid #552c40;
}
</style>

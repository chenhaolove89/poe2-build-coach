<script setup lang="ts">
/**
 * Campaign route guide: per-act zone order, what to do there, and — the reason
 * this page exists — which zones permanently miss out if you skip them: the 24
 * book points, +100 spirit, +30% resists, attribute picks. Each zone carries a
 * checkbox so a player can tick their way through the campaign; the ticks live
 * in localStorage and survive restarts.
 *
 * Zone data comes from `@poe2coach/data/campaign.json` (sources in its
 * `source` field). Chinese zone names are the community CN translations and
 * are best-effort: when absent the English name shows, which is also what a
 * map-name search in the client accepts.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { t } from '../i18n'
import { toggleCampaignOverlay, OverlayUnsupported } from '../overlayClient'
import { campaignFollow } from '../campaignFollow'
import ZoneMap from './ZoneMap.vue'
import {
  CAMPAIGN_ACTS,
  CAMPAIGN_GAME_VERSION,
  actForLevel,
  exportProgress,
  hasPointer,
  importProgress,
  mapFor,
  readDone,
  readNotes,
  stepsFor,
  writeDone,
  writeNote,
  writePointer,
  zoneKey,
  type CampaignAct,
  type CampaignReward,
  type CampaignZone,
} from '../campaign'

const acts = CAMPAIGN_ACTS

const props = defineProps<{ level: number | null }>()

// ------------------------------------------------------------------ log following

/**
 * What the log follower is up to, as one status line. The follower writes the
 * shared pointer and this window reads its reactive state directly — a window
 * never gets `storage` events for its own writes.
 */
const followLine = computed(() => {
  const key = campaignFollow.zoneKey
  if (!key) return campaignFollow.error ? `${t('自动跟随未就绪')}:${t(campaignFollow.error)}` : null
  for (const act of acts) {
    const index = act.zones.findIndex((z) => zoneKey(act, z) === key)
    if (index !== -1) {
      const zone = act.zones[index]
      const name = zone.zh ? t(zone.zh) : zone.en
      return `${t('自动跟随')}:${t('当前在')} ${name} (${act.zh} · ${index + 1}/${act.zones.length})`
    }
  }
  return null
})

// ------------------------------------------------------------------ checked zones

const done = ref<Set<string>>(readDone())

watch(
  done,
  (s) => {
    writeDone(s)
  },
  { deep: true },
)

/**
 * The pinned panel writes ticks from its own window; `storage` events carry
 * them over. The identity check stops the ping-pong: replacing the ref would
 * fire the watch, which writes back, which fires the other window's listener
 * again — same-value writes never change anything, so they stop here.
 */
function onStorage(e: StorageEvent) {
  if (e.key === 'poe2coach.campaign.notes') {
    notes.value = readNotes()
    return
  }
  if (e.key !== 'poe2coach.campaign.done' && e.key !== null) return
  const fresh = readDone()
  const changed = fresh.size !== done.value.size || [...fresh].some((k) => !done.value.has(k))
  if (changed) done.value = fresh
}

onMounted(() => window.addEventListener('storage', onStorage))
onBeforeUnmount(() => window.removeEventListener('storage', onStorage))

function toggleZone(act: CampaignAct, zone: CampaignZone) {
  const k = zoneKey(act, zone)
  const next = new Set(done.value)
  if (next.has(k)) next.delete(k)
  else next.add(k)
  done.value = next
}

// ------------------------------------------------------------------ open acts

const openIds = ref<Set<string>>(new Set())

function toggleAct(id: string) {
  const next = new Set(openIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  openIds.value = next
}

// Open the act the build is likely in, once, on mount.
{
  const hit = (props.level != null ? actForLevel(props.level) : null) ?? acts[0]
  if (hit) openIds.value = new Set([hit.id])
}

// ------------------------------------------------------------------ pin to game

const pinError = ref<string | null>(null)

/**
 * The pinned panel opens on the zone the player is probably at: the act the
 * build's level falls into, and its first unticked zone. Only written when the
 * pointer has never been set — afterwards the panel owns its own position.
 */
function seedPointer() {
  if (hasPointer()) return
  const act = (props.level != null ? actForLevel(props.level) : null) ?? acts[0]
  const firstOpen = act.zones.findIndex((z) => !done.value.has(zoneKey(act, z)))
  writePointer({ act: act.id, index: firstOpen === -1 ? 0 : firstOpen })
}

async function pinToGame() {
  pinError.value = null
  seedPointer()
  try {
    await toggleCampaignOverlay()
  } catch (e) {
    pinError.value = e instanceof OverlayUnsupported ? t('置顶面板需要桌面版。') : String(e)
  }
}

// ------------------------------------------------------------------ zone maps

interface MapView {
  act: CampaignAct
  zone: CampaignZone
}

const mapView = ref<MapView | null>(null)

function openMap(act: CampaignAct, zone: CampaignZone) {
  if (mapFor(act, zone)) mapView.value = { act, zone }
}

const LEGEND: [string, string][] = [
  ['start', '入口'],
  ['exit', '出口/下一图'],
  ['wp', '传送点'],
  ['boss', '首领'],
  ['opt', '可选取材'],
  ['event', '任务/事件'],
  ['camp', '营地'],
  ['trial', '升华试炼'],
]

// ------------------------------------------------------------------ aggregates

function allRewards(): { act: CampaignAct; zone: CampaignZone; reward: CampaignReward }[] {
  const out: { act: CampaignAct; zone: CampaignZone; reward: CampaignReward }[] = []
  for (const act of acts) {
    for (const zone of act.zones) {
      for (const reward of zone.rewards ?? []) out.push({ act, zone, reward })
    }
  }
  return out
}

const rewards = computed(allRewards)

const pointSources = computed(() => rewards.value.filter((r) => r.reward.kind === 'points'))
const pointTotal = computed(() => pointSources.value.reduce((s, r) => s + (r.reward.amount ?? 0), 0))
const spiritTotal = computed(() =>
  rewards.value.filter((r) => r.reward.kind === 'spirit').reduce((s, r) => s + (r.reward.amount ?? 0), 0),
)
const lifeTotal = computed(() =>
  rewards.value.filter((r) => r.reward.kind === 'life').reduce((s, r) => s + (r.reward.amount ?? 0), 0),
)
const resistTotal = computed(() => {
  const out: Record<string, number> = {}
  for (const r of rewards.value) {
    if (r.reward.kind === 'resist' && r.reward.ele) {
      out[r.reward.ele] = (out[r.reward.ele] ?? 0) + (r.reward.amount ?? 0)
    }
  }
  return out
})
const choiceCount = computed(
  () => rewards.value.filter((r) => r.reward.kind === 'choice' || r.reward.kind === 'attribute').length,
)
const trialCount = computed(() => rewards.value.filter((r) => r.reward.kind === 'trial').length)

const totalZones = computed(() => acts.reduce((s, a) => s + a.zones.length, 0))
const doneZones = computed(
  () => acts.reduce((s, a) => s + a.zones.filter((z) => done.value.has(zoneKey(a, z))).length, 0),
)
const donePoints = computed(() =>
  pointSources.value
    .filter((r) => done.value.has(zoneKey(r.act, r.zone)))
    .reduce((s, r) => s + (r.reward.amount ?? 0), 0),
)

function actDone(act: CampaignAct): number {
  return act.zones.filter((z) => done.value.has(zoneKey(act, z))).length
}

// ------------------------------------------------------------------ search & filters

const query = ref('')
const hideDone = ref(false)
const rewardFilter = ref('all')

const REWARD_FILTERS: [string, string][] = [
  ['all', '全部'],
  ['points', '+2 天赋点'],
  ['spirit', '精魂'],
  ['resist', '属性·抗性'],
  ['vital', '生命·魔力'],
  ['trial', '升华试炼'],
  ['other', '功能·其他'],
]

function rewardCategory(kind: string): string {
  switch (kind) {
    case 'points':
      return 'points'
    case 'spirit':
      return 'spirit'
    case 'resist':
    case 'attribute':
    case 'choice':
      return 'resist'
    case 'life':
    case 'mana':
    case 'charmSlot':
      return 'vital'
    case 'trial':
      return 'trial'
    default:
      return 'other'
  }
}

function zoneMatches(act: CampaignAct, zone: CampaignZone): boolean {
  if (hideDone.value && done.value.has(zoneKey(act, zone))) return false
  if (rewardFilter.value !== 'all') {
    const kinds = (zone.rewards ?? []).map((r) => rewardCategory(r.kind))
    if (!kinds.includes(rewardFilter.value)) return false
  }
  const q = query.value.trim().toLowerCase()
  if (q) {
    const hay = [
      zone.zh ?? '',
      zone.en,
      zone.objective,
      zone.route ?? '',
      ...(mapFor(act, zone)?.spots ?? []).map((s) => s.l ?? ''),
    ]
      .join(' ')
      .toLowerCase()
    if (!hay.includes(q)) return false
  }
  return true
}

const isFiltering = computed(
  () => hideDone.value || rewardFilter.value !== 'all' || query.value.trim().length > 0,
)

function visibleZones(act: CampaignAct): CampaignZone[] {
  return isFiltering.value ? act.zones.filter((z) => zoneMatches(act, z)) : act.zones
}

// ------------------------------------------------------------------ export / import

const ioMsg = ref<string | null>(null)
const showImport = ref(false)
const importText = ref('')

async function doExport() {
  ioMsg.value = null
  const json = JSON.stringify(exportProgress())
  try {
    await navigator.clipboard.writeText(json)
    ioMsg.value = t('进度已复制到剪贴板, 粘贴到任意地方保存')
  } catch {
    importText.value = json
    showImport.value = true
    ioMsg.value = t('剪贴板不可用, 进度已填入文本框, 全选复制保存')
  }
}

function doImport() {
  try {
    const n = importProgress(JSON.parse(importText.value))
    done.value = readDone()
    notes.value = readNotes()
    ioMsg.value = n ? t(`已恢复 ${n} 个区域的进度`) : t('备份里没有勾选进度')
    showImport.value = false
  } catch {
    ioMsg.value = t('导入失败: 不是有效的备份 JSON')
  }
}

// ------------------------------------------------------------------ notes

const notes = ref<Record<string, string>>(readNotes())
const noteDraft = ref('')

watch(mapView, (mv) => {
  noteDraft.value = mv ? (notes.value[zoneKey(mv.act, mv.zone)] ?? '') : ''
})

function saveNote() {
  if (!mapView.value) return
  const k = zoneKey(mapView.value.act, mapView.value.zone)
  writeNote(k, noteDraft.value)
  notes.value = readNotes()
}

// ------------------------------------------------------------------ walkthrough steps in the lightbox

const curSteps = computed(() => (mapView.value ? stepsFor(mapView.value.act, mapView.value.zone) : []))

// ------------------------------------------------------------------ display

const ELE_ZH: Record<string, string> = { cold: '冰', lightning: '雷', fire: '火' }

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
    case 'choice': {
      const opts = (r.options ?? []).join(' / ')
      return { label: t('择一强化'), cls: 'choice', title: t(opts) + (r.swappable ? t('(可随时切换)') : '') }
    }
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
  <div class="campaign">
    <div class="summary card">
      <button class="pin" @click="pinToGame">📌 {{ t('置顶到游戏') }}</button>
      <div class="sum-row">
        <span class="sum-item"><b class="gold">{{ pointTotal }}</b> {{ t('点剧情天赋') }} · {{ pointSources.length }} {{ t('处') }}</span>
        <span class="sum-item"><b class="violet">+{{ spiritTotal }}</b> {{ t('精魂') }}</span>
        <span class="sum-item"><b class="blue">+{{ resistTotal.cold ?? 0 }}/{{ resistTotal.lightning ?? 0 }}/{{ resistTotal.fire ?? 0 }}%</b> {{ t('冰/雷/火抗') }}</span>
        <span class="sum-item"><b class="green">+{{ lifeTotal }}</b> {{ t('生命') }}</span>
        <span class="sum-item">{{ trialCount }} {{ t('次升华试炼') }} · {{ choiceCount }} {{ t('处择一强化') }}</span>
      </div>
      <div class="bar-outer">
        <div class="bar-inner" :style="{ width: `${totalZones ? (doneZones / totalZones) * 100 : 0}%` }" />
      </div>
      <p class="dim small">
        {{ t('已跑过') }} {{ doneZones }} / {{ totalZones }} {{ t('个区域 · 其中') }} {{ donePoints }} / {{ pointTotal }} {{ t('点剧情天赋已到手') }}。
        {{ t('数据基于国际服') }} {{ CAMPAIGN_GAME_VERSION }}{{ t('，勾选进度保存在本机。') }}
      </p>
      <p v-if="followLine" class="dim small">{{ followLine }}</p>
      <p v-if="pinError" class="dim small">{{ pinError }}</p>
      <div class="io-row">
        <button class="io-btn" @click="doExport">⬆ {{ t('导出进度') }}</button>
        <button class="io-btn" @click="showImport = true">⬇ {{ t('导入进度') }}</button>
        <span v-if="ioMsg" class="dim small">{{ ioMsg }}</span>
      </div>
    </div>

    <div class="toolbar card">
      <input v-model="query" class="search" :placeholder="t('搜索区域 / 首领 / 出口…')" />
      <label class="hd dim">
        <input v-model="hideDone" type="checkbox" />
        {{ t('只看未完成') }}
      </label>
      <div class="rw-filters">
        <button
          v-for="[k, label] in REWARD_FILTERS"
          :key="k"
          class="rw"
          :class="{ on: rewardFilter === k }"
          @click="rewardFilter = k"
        >
          {{ t(label) }}
        </button>
      </div>
    </div>

    <div v-if="showImport" class="lightbox" @click="showImport = false">
      <div class="lb-card io-card" @click.stop>
        <div class="lb-head">
          <b>{{ t('导入进度') }}</b>
          <button class="lb-close" @click="showImport = false">×</button>
        </div>
        <p class="dim small">{{ t('粘贴之前导出的备份 JSON (包含勾选进度与笔记)。') }}</p>
        <textarea v-model="importText" class="io-text" rows="8" />
        <div class="io-row">
          <button class="io-btn primary" @click="doImport">{{ t('恢复') }}</button>
        </div>
      </div>
    </div>

    <div
      v-for="act in acts"
      :key="act.id"
      v-show="!isFiltering || visibleZones(act).length"
      class="act card"
      :class="{ open: openIds.has(act.id) || isFiltering }"
    >
      <button class="act-head" @click="toggleAct(act.id)">
        <span class="tri">{{ openIds.has(act.id) ? '▾' : '▸' }}</span>
        <span class="act-name">{{ t(act.zh) }} <span class="dim en-name">{{ act.en }}</span></span>
        <span class="act-meta">
          <span class="dim">Lv {{ act.levels }}</span>
          <span class="done-count" :class="{ all: actDone(act) === act.zones.length }">
            {{ actDone(act) }}/{{ act.zones.length }}
          </span>
        </span>
      </button>
      <p v-if="act.note && openIds.has(act.id)" class="dim small act-note">{{ t(act.note) }}</p>
      <div v-show="openIds.has(act.id) || isFiltering" class="zones">
        <div
          v-for="zone in visibleZones(act)"
          :key="zone.en"
          class="zone"
          :class="{ done: done.has(zoneKey(act, zone)) }"
          @click="toggleZone(act, zone)"
        >
          <span class="tick">{{ done.has(zoneKey(act, zone)) ? '✓' : '' }}</span>
          <div class="zone-main">
            <div class="zone-line">
              <span class="zname">{{ zone.zh ? t(zone.zh) : zone.en }}</span>
              <span v-if="zone.zh" class="dim en-name">{{ zone.en }}</span>
              <span v-if="zone.layout" class="chip util">{{ t(zone.layout) }}</span>
              <span v-if="notes[zoneKey(act, zone)]" class="chip util" title="有笔记">📝</span>
              <span v-for="(chip, ci) in (zone.rewards ?? []).map(chipOf)" :key="ci" class="chip" :class="chip.cls" :title="chip.title">
                {{ chip.label }}
              </span>
            </div>
            <div class="objective dim">{{ t(zone.objective) }}</div>
            <div v-if="zone.route" class="objective route">{{ t('跑法') }} · {{ t(zone.route) }}</div>
          </div>
          <button
            v-if="mapFor(act, zone)"
            class="zmap"
            :title="t('查看示意图')"
            @click.stop="openMap(act, zone)"
          >
            <ZoneMap :spec="mapFor(act, zone)!" />
          </button>
        </div>
      </div>
    </div>

    <div v-if="mapView" class="lightbox" @click="mapView = null">
      <div class="lb-card" @click.stop>
        <div class="lb-head">
          <b>{{ t(mapView.act.zh) }} · {{ mapView.zone.zh ? t(mapView.zone.zh) : mapView.zone.en }}</b>
          <button class="lb-close" @click="mapView = null">×</button>
        </div>
        <ZoneMap
          :spec="mapFor(mapView.act, mapView.zone)!"
          :labels="true"
          :interactive="true"
          :map-key="zoneKey(mapView.act, mapView.zone)"
        />
        <div class="lb-meta">
          <span v-if="mapFor(mapView.act, mapView.zone)!.conf" class="lb-conf">
            布局把握: {{ mapFor(mapView.act, mapView.zone)!.conf }}
          </span>
          <span v-if="mapFor(mapView.act, mapView.zone)!.variants" class="dim small">
            {{ mapFor(mapView.act, mapView.zone)!.variants }}
          </span>
        </div>
        <div v-if="curSteps.length" class="lb-steps">
          <div v-for="(s, si) in curSteps" :key="si" class="step" :class="{ opt: s.opt }">
            <span class="no">{{ s.opt ? '◆' : si + 1 }}</span>
            <div class="st">
              <span class="st-t">
                {{ t(s.t) }}
                <i v-if="s.opt" class="optb">{{ t('可选') }}</i>
              </span>
              <span v-if="s.tip" class="dim st-tip">{{ t(s.tip) }}</span>
            </div>
          </div>
        </div>
        <div class="lb-legend">
          <span v-for="[k, label] in LEGEND" :key="k" class="lg-item">
            <span class="lg-dot" :data-k="k" />{{ t(label) }}
          </span>
        </div>
        <div class="lb-note">
          <label class="dim small">{{ t('我的笔记') }}</label>
          <textarea
            v-model="noteDraft"
            class="note-text"
            rows="2"
            :placeholder="t('记一点自己的心得, 自动保存')"
            @input="saveNote"
          />
        </div>
        <p class="dim small">{{ t('金色虚线为建议跑法顺序; 北 = 屏幕上方。点图可标记当前位置, 旋转/镜像可对齐实际种子方向。示意图画的是稳定出现的跑法模式, 不是游戏内实景。') }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.campaign {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.card {
  background: #10131b;
  border: 1px solid #232939;
  border-radius: 10px;
}
.summary {
  padding: 12px 14px;
  position: relative;
}
.pin {
  position: absolute;
  top: 10px;
  right: 12px;
  background: #1a1f2c;
  border: 1px solid #2c3244;
  color: #e8b04b;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 11px;
  cursor: pointer;
}
.pin:hover {
  border-color: #e8b04b;
  filter: brightness(1.1);
}
.sum-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  margin-bottom: 10px;
  font-size: 12px;
  color: #9aa3bd;
  padding-right: 104px;
}
.sum-item b {
  font-size: 13px;
}
.gold {
  color: #e8b04b;
}
.violet {
  color: #b39ae8;
}
.blue {
  color: #7aa5d9;
}
.green {
  color: #7dd087;
}
.bar-outer {
  height: 5px;
  background: #0b0d12;
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 8px;
}
.bar-inner {
  height: 100%;
  background: #7dd087;
  transition: width 0.15s ease;
}
.small {
  font-size: 11px;
  margin: 0;
  line-height: 1.6;
}
.act {
  overflow: hidden;
}
.act-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  background: none;
  border: none;
  color: #cfd4e4;
  padding: 10px 14px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  text-align: left;
}
.act-head:hover {
  background: #141826;
}
.tri {
  color: #6b7390;
  font-size: 10px;
  width: 12px;
}
.act-name .en-name {
  font-weight: 400;
}
.en-name {
  font-size: 11px;
  color: #6b7390;
}
.act-meta {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
}
.done-count {
  color: #9aa3bd;
  border: 1px solid #2c3244;
  border-radius: 8px;
  padding: 0 7px;
  font-size: 10px;
}
.done-count.all {
  color: #7dd087;
  border-color: #2c5540;
}
.act-note {
  padding: 0 14px 8px 34px;
}
.zones {
  border-top: 1px solid #1a1f2c;
}
.zone {
  display: flex;
  gap: 10px;
  padding: 7px 14px 7px 12px;
  cursor: pointer;
  border-bottom: 1px solid #141826;
}
.zone:last-child {
  border-bottom: none;
}
.zone:hover {
  background: #121623;
}
.zone.done .zname {
  color: #6b7390;
  text-decoration: line-through;
}
.zone.done .objective {
  color: #4a5166;
}
.tick {
  flex: 0 0 16px;
  height: 16px;
  margin-top: 1px;
  border: 1px solid #2c3244;
  border-radius: 4px;
  font-size: 11px;
  line-height: 14px;
  text-align: center;
  color: #7dd087;
}
.zone.done .tick {
  border-color: #2c5540;
  background: #12251a;
}
.zone-main {
  min-width: 0;
  flex: 1;
}
.zone-line {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
}
.zname {
  font-size: 12px;
  color: #cfd4e4;
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
.objective {
  font-size: 11px;
  line-height: 1.6;
  margin-top: 1px;
}
.objective.route {
  color: #7d86a2;
  margin-top: 2px;
}
.zmap {
  flex: 0 0 128px;
  align-self: center;
  background: #0b0d12;
  border: 1px solid #232939;
  border-radius: 6px;
  overflow: hidden;
  cursor: zoom-in;
  padding: 0;
}
.zmap:hover {
  border-color: #4a5468;
}
.lightbox {
  position: fixed;
  inset: 0;
  background: rgba(4, 6, 10, 0.78);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
}
.lb-card {
  background: #10131b;
  border: 1px solid #2c3244;
  border-radius: 10px;
  padding: 14px 16px;
  width: min(620px, 92vw);
}
.lb-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  color: #e8b04b;
  font-size: 13px;
}
.lb-close {
  background: none;
  border: none;
  color: #9aa3bd;
  font-size: 16px;
  cursor: pointer;
}
.lb-close:hover {
  color: #e06060;
}
.lb-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 12px;
  margin-top: 8px;
  font-size: 11px;
}
.lb-conf {
  color: #e8b04b;
  border: 1px solid #4a3d20;
  border-radius: 8px;
  padding: 0 7px;
  line-height: 16px;
  white-space: nowrap;
}
.io-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.io-btn {
  background: #1a1f2c;
  border: 1px solid #2c3244;
  color: #9aa3bd;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 11px;
  cursor: pointer;
}
.io-btn:hover {
  border-color: #e8b04b;
  color: #e8b04b;
}
.io-btn.primary {
  color: #e8b04b;
  border-color: #4a3d20;
}
.io-card {
  width: min(560px, 92vw);
}
.io-text {
  width: 100%;
  box-sizing: border-box;
  margin-top: 8px;
  background: #0b0d12;
  border: 1px solid #2c3244;
  border-radius: 6px;
  color: #cfd4e4;
  font-size: 11px;
  font-family: 'Consolas', monospace;
  padding: 8px;
  resize: vertical;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 10px 14px;
}
.toolbar .search {
  flex: 1 1 200px;
  min-width: 180px;
  background: #0b0d12;
  border: 1px solid #2c3244;
  border-radius: 6px;
  color: #cfd4e4;
  font-size: 12px;
  padding: 6px 10px;
  outline: none;
}
.toolbar .search:focus {
  border-color: #4a3d20;
}
.toolbar .hd {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.rw-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.rw {
  background: #1a1f2c;
  border: 1px solid #2c3244;
  color: #9aa3bd;
  border-radius: 12px;
  padding: 3px 10px;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}
.rw.on {
  border-color: #e8b04b;
  color: #e8b04b;
  background: #1f1a10;
}
.lb-steps {
  margin-top: 10px;
  border: 1px solid #232939;
  border-radius: 6px;
  padding: 8px 10px;
  background: #0d1017;
}
.step {
  display: flex;
  gap: 8px;
  padding: 3px 0;
  align-items: baseline;
}
.step .no {
  flex: 0 0 16px;
  height: 16px;
  border-radius: 50%;
  background: #232939;
  color: #e8b04b;
  font-size: 10px;
  line-height: 16px;
  text-align: center;
}
.step.opt .no {
  background: none;
  color: #b39ae8;
}
.step .st {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.step .st-t {
  font-size: 12px;
  color: #cfd4e4;
}
.step.opt .st-t {
  color: #b39ae8;
}
.step .optb {
  font-style: normal;
  font-size: 10px;
  border: 1px solid #3d3364;
  border-radius: 7px;
  padding: 0 6px;
  margin-left: 6px;
  color: #b39ae8;
}
.step .st-tip {
  font-size: 11px;
}
.lb-note {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.note-text {
  width: 100%;
  box-sizing: border-box;
  background: #0b0d12;
  border: 1px solid #2c3244;
  border-radius: 6px;
  color: #c9c0a0;
  font-size: 12px;
  padding: 6px 8px;
  resize: vertical;
}
.note-text:focus {
  border-color: #4a3d20;
}
.lb-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin-top: 10px;
  font-size: 11px;
  color: #9aa3bd;
}
.lg-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.lg-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
  background: #6b7390;
}
.lg-dot[data-k='start'] {
  background: #7dd087;
}
.lg-dot[data-k='exit'] {
  background: #0b0d12;
  box-shadow: inset 0 0 0 2px #e8b04b;
}
.lg-dot[data-k='wp'] {
  background: #7aa5d9;
}
.lg-dot[data-k='boss'] {
  background: #e06060;
}
.lg-dot[data-k='opt'] {
  background: #b39ae8;
  transform: rotate(45deg);
  border-radius: 1px;
}
.lg-dot[data-k='event'] {
  background: #d9a441;
  transform: rotate(45deg);
  border-radius: 1px;
}
.lg-dot[data-k='camp'] {
  background: #6dc5b8;
  border-radius: 2px;
}
.lg-dot[data-k='trial'] {
  background: transparent;
  box-shadow: inset 0 0 0 2px #b39ae8;
}
.dim {
  color: #6b7390;
}
</style>

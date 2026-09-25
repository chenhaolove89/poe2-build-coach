<script setup lang="ts">
/**
 * 石板(碑牌) —— the map device's per-run switches.
 *
 * The atlas plan is the slow half of a farming strategy; the tablet is the fast
 * half: one tablet per mechanic slot in the device, ten uses each, its affixes
 * rolled from a pool that is half generic map-value mods and half that
 * mechanic's own. The card lists all eight classes, the player's plan's
 * mechanics first, and renders the pool in the realm's own item language — the
 * one the player's Ctrl+C writes.
 *
 * It is a reference, not advice. It says what *can* roll and what each tablet
 * does by default (its implicit); which affix is worth its slot is answered by
 * the player's own per-map measurements, not by this list.
 */
import { computed, ref } from 'vue'
import {
  splitTabletAffixes,
  tabletText,
  tabletsRankedByPlan,
  type TabletAffix,
  type TabletClass,
  type TabletData,
  type TabletLanguage,
} from '@poe2coach/core'
import tabletsJson from '@poe2coach/data/tablets.json'
import { ATLAS } from '../atlasData'
import { realm } from '../settings'
import { t } from '../i18n'

const props = defineProps<{ subtreeRank: string[] }>()

const DATA = tabletsJson as unknown as TabletData

/** Item text follows the realm, not the reader's UI variant. */
const lang = computed<TabletLanguage>(() => realm.value.lang)

const ranked = computed(() => tabletsRankedByPlan(DATA, props.subtreeRank))

const open = ref<string | null>(null)
function toggle(id: string): void {
  open.value = open.value === id ? null : id
}

function className(tc: TabletClass): string {
  return tabletText(tc.name, lang.value)
}
function implicitOf(tc: TabletClass): string {
  return tabletText(tc.implicit, lang.value)
}
function affixName(a: TabletAffix): string {
  return tabletText(a.name, lang.value)
}
function affixText(a: TabletAffix): string {
  return tabletText(a.text, lang.value)
}

function subtreeLabel(tc: TabletClass): string | null {
  if (!tc.subtree) return null
  const s = ATLAS.subtrees.find((x) => x.id === tc.subtree)
  return s ? t(s.label) : tc.subtree
}

/** Prefixes before suffixes, poe2db's generation id ordering both groups. */
function ordered(affixes: TabletAffix[]): TabletAffix[] {
  return [...affixes].sort((a, b) => a.gen - b.gen || a.name.en.localeCompare(b.name.en))
}

const pools = computed(() => {
  const map = new Map<string, { generic: TabletAffix[]; mechanic: TabletAffix[] }>()
  for (const tc of ranked.value) map.set(tc.id, splitTabletAffixes(tc))
  return map
})
</script>

<template>
  <div class="card block tablets">
    <h3>
      {{ t('石板 · 地图装置') }}
      <span class="dim small">{{ DATA.tablets.length }} {{ t('类 · 每张') }} {{ DATA.tablets[0].uses }} {{ t('次') }}</span>
    </h3>
    <p class="dim small">
      {{ t('一张石板管一张图的机制强度:异界点满的机制,就是这里该上的词缀。池子只说「能掉什么」,值不值看你的实测。') }}
    </p>
    <div v-for="tc in ranked" :key="tc.id" class="tablet" :class="{ open: open === tc.id }">
      <button class="tablet-head" @click="toggle(tc.id)">
        <span class="tri">{{ open === tc.id ? '▾' : '▸' }}</span>
        <span class="tablet-name">{{ className(tc) }}</span>
        <span v-if="subtreeLabel(tc)" class="chip">{{ subtreeLabel(tc) }}</span>
      </button>
      <p class="dim small implicit">{{ implicitOf(tc) }}</p>
      <template v-if="open === tc.id">
        <p class="dim small pool-note">
          {{ t('通用') }} {{ pools.get(tc.id)!.generic.length }} ·
          {{ t('机制') }} {{ pools.get(tc.id)!.mechanic.length }}
        </p>
        <p v-if="pools.get(tc.id)!.generic.length" class="pool-title dim">{{ t('通用词缀(图值/收益)') }}</p>
        <ul class="affixes">
          <li v-for="a in ordered(pools.get(tc.id)!.generic)" :key="a.name.en" class="affix">
            <span class="affix-name dim">{{ affixName(a) }}</span>
            <span class="affix-text">{{ affixText(a) }}</span>
          </li>
        </ul>
        <p v-if="pools.get(tc.id)!.mechanic.length" class="pool-title dim">{{ t('机制词缀') }}</p>
        <ul v-if="pools.get(tc.id)!.mechanic.length" class="affixes">
          <li v-for="a in ordered(pools.get(tc.id)!.mechanic)" :key="a.name.en" class="affix mech">
            <span class="affix-name dim">{{ affixName(a) }}</span>
            <span class="affix-text">{{ affixText(a) }}</span>
          </li>
        </ul>
      </template>
    </div>
    <p class="dim small uniques">
      {{ t('传奇石板(官方交易索引在册,词缀池未收录):') }}
      {{ DATA.uniques.map((u) => `${u.name} (${u.tradeType})`).join(' · ') }}
    </p>
    <p class="dim small source-line">
      {{ t('词缀与隐式来自 poe2db 数据挖掘(GGG 版权),采集于') }} {{ DATA.captured.replace(/-/g, '.') }}。
    </p>
  </div>
</template>

<style scoped>
.tablets {
  gap: 6px;
}
.tablet {
  border-top: 1px solid #141826;
  padding-top: 4px;
}
.tablet-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  background: none;
  border: none;
  color: #cfd4e4;
  font-size: 12px;
  padding: 3px 2px;
  text-align: left;
  cursor: pointer;
}
.tablet-head:hover {
  color: #fff;
}
.tri {
  color: #6b7390;
  font-size: 10px;
}
.tablet-name {
  flex: 1;
  min-width: 0;
}
.chip {
  font-size: 10px;
  color: #9aa3bd;
  border: 1px solid #232939;
  border-radius: 4px;
  padding: 0 5px;
}
.implicit {
  margin: 2px 2px 0;
}
.pool-note {
  margin: 4px 2px 0;
}
.pool-title {
  font-size: 11px;
  margin: 8px 2px 2px;
  color: #8a93ad;
}
.affixes {
  list-style: none;
  margin: 0;
  padding: 0;
}
.affix {
  display: flex;
  gap: 6px;
  padding: 2px 2px;
  border-top: 1px solid #141826;
  font-size: 11px;
  align-items: baseline;
}
.affix.mech .affix-text {
  color: #d9a441;
}
.affix-name {
  flex: 0 0 72px;
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.affix-text {
  flex: 1;
  min-width: 0;
  white-space: pre-line;
  color: #c9c0a0;
}
.uniques {
  border-top: 1px solid #141826;
  padding-top: 6px;
  margin-top: 4px;
  word-break: break-word;
}
.source-line {
  margin-top: 0;
}
</style>

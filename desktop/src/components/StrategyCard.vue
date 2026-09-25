<script setup lang="ts">
/**
 * 刷图策略卡 —— the farming strategy a share code implies, as one glanceable card.
 *
 * The content is derived, never authored: `strategyBrief` reads the Atlas plan and
 * the map table, and everything it says is a claim about those two data files, not
 * about anyone's opinion. That is what lets the same card appear on both ends of a
 * share — the sharer sees it live, the receiver regenerates it from the imported
 * plan — with no text to keep in sync.
 *
 * The card renders in two places with two behaviours. On the home page it is
 * interactive: a mechanic opens the atlas page on that subtree, a biome opens the
 * map page on that filter, reusing the same focus requests the two pages use on
 * each other. In the share preview it is read-only, because the question there is
 * "what will my code say", not "where do I click next".
 */
import { computed } from 'vue'
import type { StrategyBrief } from '@poe2coach/core'
import { t, zhName } from '../i18n'
import { biomeLabel } from '../mapData'
import { strategyHeadline } from '../strategyCard'

const props = defineProps<{ brief: StrategyBrief; interactive?: boolean }>()
const emit = defineEmits<{ focusMechanic: [id: string]; focusBiome: [keyword: string] }>()

const headline = computed(() => strategyHeadline(props.brief))

const areaCount = computed(() => props.brief.biomes.reduce((sum, b) => sum + b.areas.length, 0))

function biomeZh(keyword: string): string {
  const zh = biomeLabel(keyword)
  return zh ? t(zh) : keyword
}

function stars(rating: number | null): string {
  return rating == null ? '' : '★'.repeat(rating)
}

/** Bilingual where the dictionary knows the node, English where it does not. */
function nodeName(name: string): string {
  const zh = zhName(name)
  return zh ? `${zh} ${name}` : name
}

function clickMechanic(id: string) {
  if (props.interactive) emit('focusMechanic', id)
}

function clickBiome(keyword: string, hasAreas: boolean) {
  if (props.interactive && hasAreas) emit('focusBiome', keyword)
}
</script>

<template>
  <section class="strat card">
    <div class="head">
      <h3>🗺 {{ t('刷图策略') }}</h3>
      <b v-if="headline" class="headline">{{ headline }}</b>
    </div>
    <p class="dim small note">
      {{ t('由异界点法自动推导 —— 分享码的接收方导入后看到的也是这一张。') }}
      <template v-if="interactive && areaCount > 0">
        {{ t('点机制跳异界页,点生态跳地图页。') }}
      </template>
    </p>

    <div class="line">
      <span class="k">{{ t('机制') }}</span>
      <button
        v-for="m in brief.mechanics"
        :key="m.id"
        class="chip"
        :class="{ clickable: interactive }"
        :style="{ borderColor: m.color }"
        :title="t('在异界页看这棵子树')"
        @click="clickMechanic(m.id)"
      >
        <i class="dot" :style="{ background: m.color }" />
        {{ t(m.label) }} {{ m.allocated }}/{{ m.total }}
        <span class="dim">{{ t('显著') }} {{ m.notablesTaken }}/{{ m.notablesTotal }}</span>
      </button>
      <span v-if="brief.main" class="chip plain">
        {{ t('主树') }} {{ brief.main.allocated }}/{{ brief.main.total }}
      </span>
      <span v-if="!brief.mechanics.length" class="dim small">
        {{ t('还没点机制子树的节点 —— 这份方案还没定向。') }}
      </span>
    </div>

    <div v-if="brief.biomes.length" class="line">
      <span class="k">{{ t('生态') }}</span>
      <span v-for="b in brief.biomes" :key="b.keyword" class="biome">
        <button
          class="chip"
          :class="{ clickable: interactive && b.areas.length > 0 }"
          :title="t('在地图页看这个生态')"
          @click="clickBiome(b.keyword, b.areas.length > 0)"
        >
          {{ biomeZh(b.keyword) }} ×{{ b.nodes }}
        </button>
        <span v-if="b.areas.length" class="areas dim small">
          {{ b.areas.map((a) => `${zhName(a.name) ?? a.name}${stars(a.navigation)}`).join(' · ') }}
        </span>
      </span>
    </div>

    <div v-if="brief.keystones.length" class="line">
      <span class="k">{{ t('关键') }}</span>
      <span v-for="k in brief.keystones" :key="k.name" class="key">
        <i class="dot" :style="{ background: k.color }" />
        {{ nodeName(k.name) }}
      </span>
    </div>
  </section>
</template>

<style scoped>
.strat {
  background: #10131b;
  border: 1px solid #232939;
  border-radius: 8px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.head h3 {
  font-size: 13px;
  color: #cfd4e4;
  font-weight: 600;
  margin: 0;
}
.headline {
  color: #e8b04b;
  font-size: 12px;
}
.note {
  margin: 0;
}
.line {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 5px 8px;
}
.k {
  flex: 0 0 34px;
  font-size: 11px;
  color: #6b7390;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  border: 1px solid #2c3244;
  border-radius: 9px;
  padding: 2px 8px;
  line-height: 16px;
  color: #cfd4e4;
  background: none;
  white-space: nowrap;
}
.chip.plain {
  color: #9aa3bd;
  border-style: dashed;
}
.chip.clickable {
  cursor: pointer;
}
.chip.clickable:hover {
  color: #e8b04b;
  border-color: #e8b04b;
}
.dot {
  flex: 0 0 7px;
  height: 7px;
  border-radius: 50%;
}
.dim {
  color: #8a93bd;
}
.biome {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
}
.areas {
  white-space: normal;
}
.key {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #cfd4e4;
}
</style>

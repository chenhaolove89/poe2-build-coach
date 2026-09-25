<script setup lang="ts">
/**
 * 分享码 —— one code for the whole setup.
 *
 * What it carries is the four things worth handing over: the realm and league you
 * are on, the passive tree you are following, the Atlas plan, and the gear you
 * pasted in. It deliberately does **not** carry the 国服 session cookie — that is a
 * login, not a setting, and a code that carried it would hand over the account. The
 * panel says so, because a share button that does not explain its blast radius is
 * one nobody should press.
 *
 * The code is generated from live state rather than stored, so it is always the
 * setup on screen; importing replaces that setup.
 *
 * A code alone tells the receiver nothing until they import it, so the panel also
 * copies the strategy card (the home card above, as text) together with the code —
 * one paste into a chat explains the plan and restores it in the same motion. The
 * import box reads that combined block back: the code is extracted from the prose
 * rather than the paste being rejected for not being a bare code.
 */
import { computed, ref } from 'vue'
import { ShareCodeError, decodeShareSnapshot, encodeShareSnapshot, extractShareCode, type ShareSnapshot, type StrategyBrief } from '@poe2coach/core'
import { t } from '../i18n'
import { realm } from '../settings'
import { shareWithCard, strategyTextCard } from '../strategyCard'
import { ShareLinkError, isShareUrl, resolveShareLink, summaryOf, uploadShareCode } from '../shareLink'

const props = defineProps<{ snapshot: ShareSnapshot; brief: StrategyBrief | null; pobCode: string | null }>()
const emit = defineEmits<{ apply: [ShareSnapshot] }>()

const code = computed(() => encodeShareSnapshot(props.snapshot))
const paste = ref('')
const error = ref<string | null>(null)
const done = ref<string | null>(null)
const copied = ref<'' | 'code' | 'blob' | 'pob' | 'link'>('')
const link = ref<string | null>(null)
const linkBusy = ref(false)

/** The card as text, when there is a plan to describe. */
const card = computed(() => (props.brief ? strategyTextCard(props.brief) : ''))

/** What the current code actually carries, so the summary is not a claim. */
const summary = computed(() => {
  const s = props.snapshot
  const parts: string[] = []
  parts.push(realm.value.label)
  if (s.league) parts.push(s.league)
  if (s.className) parts.push(s.ascendClassName ? `${s.className} / ${s.ascendClassName}` : s.className)
  if (s.level != null) parts.push(`${t('等级')} ${s.level}`)
  parts.push(`${s.passiveNodes.length} ${t('个天赋点')}`)
  parts.push(`${s.atlasNodes.length} ${t('个异界节点')}`)
  parts.push(`${s.items.length} ${t('件装备')}`)
  if (s.skills.length) parts.push(`${s.skills.length} ${t('组技能')}`)
  return parts
})

function flash(which: 'code' | 'blob' | 'pob' | 'link') {
  copied.value = which
  window.setTimeout(() => (copied.value = ''), 1600)
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Clipboard access can be refused; the textareas are selectable, which is why
    // they are textareas and not read-only lines.
    error.value = t('复制被系统拒绝,可以手动选中内容复制。')
    return false
  }
}

async function copyCode() {
  error.value = null
  done.value = null
  if (await copyText(code.value)) flash('code')
}

/**
 * Card and code as one block, ready to paste into a chat.
 *
 * This is the "make the receiver understand" button: the card tells them what they
 * are looking at, the code underneath restores it, and the receiving app extracts
 * the code from the block automatically.
 */
async function copyCardAndCode() {
  error.value = null
  done.value = null
  if (await copyText(shareWithCard(card.value, code.value))) flash('blob')
}

/**
 * The official-format twin: a PoB code for someone who has not installed this
 * tool. It carries the character half (tree, gear, gems) but not the Atlas plan
 * or the realm settings — that is exactly the trade-off the tooltip states.
 */
async function copyPob() {
  error.value = null
  done.value = null
  if (!props.pobCode) return
  if (await copyText(props.pobCode)) flash('pob')
}

async function copyLink() {
  error.value = null
  done.value = null
  if (link.value && (await copyText(link.value))) flash('link')
}

/**
 * Link sharing: upload the code, hand out a short URL.
 *
 * The link and the string carry the identical payload — the string stays the
 * always-works fallback, because it needs no server and never expires.
 */
async function generateLink() {
  error.value = null
  done.value = null
  linkBusy.value = true
  try {
    const result = await uploadShareCode(code.value, summaryOf(props.snapshot))
    link.value = result.link
    if (await copyText(result.link)) flash('link')
  } catch (e) {
    link.value = null
    error.value = e instanceof ShareLinkError ? e.message : e instanceof Error ? e.message : String(e)
  } finally {
    linkBusy.value = false
  }
}

/**
 * Import accepts everything the panel can hand out: a bare code, the whole
 * card+code block, or a share link — tried in that order, since each is a subset
 * shape of the paste that plausibly contains it. The link is fetched and its
 * payload then decoded like any pasted code.
 */
async function importCode() {
  error.value = null
  done.value = null
  if (!paste.value.trim()) {
    error.value = t('先粘贴一个分享码或链接。')
    return
  }
  let raw = extractShareCode(paste.value)
  try {
    if (!raw && isShareUrl(paste.value)) raw = await resolveShareLink(paste.value)
  } catch (e) {
    error.value = e instanceof ShareLinkError ? e.message : e instanceof Error ? e.message : String(e)
    return
  }
  if (!raw) {
    error.value = t('没有找到分享码 —— 本工具的码以 P2C1. 开头,链接以 /s/ 结尾形式发给你。')
    return
  }
  try {
    const snapshot = decodeShareSnapshot(raw)
    emit('apply', snapshot)
    paste.value = ''
    const bits = [`${snapshot.passiveNodes.length} ${t('个天赋点')}`, `${snapshot.atlasNodes.length} ${t('个异界节点')}`]
    if (snapshot.items.length) bits.push(`${snapshot.items.length} ${t('件装备')}`)
    done.value = `${t('已导入:')}${bits.join(' · ')}`
  } catch (e) {
    error.value = e instanceof ShareCodeError ? e.message : e instanceof Error ? e.message : String(e)
  }
}
</script>

<template>
  <div class="share card">
    <h3>🔗 {{ t('分享码') }}</h3>
    <p class="dim small">
      {{ t('一个码带走全部:服务器与赛季、天赋树、异界天赋、装备。') }}
      <b>{{ t('不含登录凭证') }}</b
      >{{ t(' —— 国服的会话 Cookie 是登录,不是设置,任何分享码都不会带上它。') }}
    </p>

    <div class="row">
      <span class="dim small label">{{ t('这个码包含') }}</span>
      <span v-for="(part, i) in summary" :key="i" class="chip">{{ part }}</span>
    </div>

    <textarea class="code-box" rows="3" readonly :value="code" spellcheck="false" />

    <div class="row">
      <button class="btn primary" @click="copyCode">{{ copied === 'code' ? t('已复制 ✓') : t('复制分享码') }}</button>
      <button
        class="btn"
        :disabled="!card"
        :title="t('上面的策略卡和这个码合成一段,发出去对方一看就懂')"
        @click="copyCardAndCode"
      >
        {{ copied === 'blob' ? t('已复制 ✓') : t('复制策略卡+码') }}
      </button>
      <button
        class="btn"
        :disabled="!pobCode"
        :title="t('官方 PoB 格式:给还在用 PoB 的朋友。带天赋/装备/技能,不带异界与设置。')"
        @click="copyPob"
      >
        {{ copied === 'pob' ? t('已复制 ✓') : t('复制 PoB 码') }}
      </button>
      <button class="btn" :disabled="linkBusy" :title="t('上传码到分享服务,换一个短链接,对方点开就能看')" @click="generateLink">
        {{ linkBusy ? t('生成中…') : t('生成分享链接') }}
      </button>
      <span class="dim small">{{ code.length }} {{ t('字符') }}</span>
    </div>

    <div v-if="link" class="link-row">
      <input class="link-box" readonly :value="link" spellcheck="false" @focus="($event.target as HTMLInputElement).select()" />
      <button class="btn" @click="copyLink">{{ copied === 'link' ? t('已复制 ✓') : t('复制链接') }}</button>
    </div>
    <p v-if="link" class="dim small">
      {{ t('链接由分享服务保存一年,有人打开就会自动续期;分享码串则是纯离线、永不过期的 —— 两者内容完全一致。') }}
    </p>

    <div class="import">
      <textarea
        v-model="paste"
        class="code-box"
        rows="2"
        spellcheck="false"
        :placeholder="t('粘贴分享码、整段策略卡、或分享链接…')"
      />
      <button class="btn" @click="importCode">{{ t('导入并覆盖当前设置') }}</button>
    </div>

    <p v-if="error" class="msg err">{{ error }}</p>
    <p v-else-if="done" class="msg ok">{{ done }}</p>
  </div>
</template>

<style scoped>
.share {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.share h3 {
  font-size: 13px;
  color: #cfd4e4;
  font-weight: 600;
}
.small {
  font-size: 11px;
  line-height: 1.6;
  margin: 0;
}
.row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px 8px;
}
.label {
  white-space: nowrap;
}
.chip {
  font-size: 10px;
  border-radius: 8px;
  padding: 1px 7px;
  line-height: 16px;
  border: 1px solid #2c3244;
  color: #9aa3bd;
  white-space: nowrap;
}
.link-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.link-box {
  flex: 1;
  min-width: 0;
  background: #0b0d12;
  border: 1px solid #2c4258;
  border-radius: 6px;
  color: #7aa5d9;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 11px;
  padding: 6px 8px;
}
.link-box:focus {
  outline: none;
  border-color: #e8b04b;
}
.code-box {
  width: 100%;
  box-sizing: border-box;
  background: #0b0d12;
  border: 1px solid #2c3244;
  border-radius: 6px;
  color: #9fb4d8;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 11px;
  padding: 6px 8px;
  resize: vertical;
  word-break: break-all;
}
.code-box:focus {
  outline: none;
  border-color: #4a3d20;
}
.btn {
  background: #1a1f2c;
  border: 1px solid #2c3244;
  color: #cfd4e4;
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
}
.btn:hover {
  color: #e8b04b;
  border-color: #e8b04b;
}
.btn.primary {
  color: #e8b04b;
  border-color: #4a3d20;
}
.btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.import {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid #1a1f2c;
}
.msg {
  font-size: 12px;
  margin: 0;
}
.msg.err {
  color: #e0885a;
}
.msg.ok {
  color: #7dd087;
}
</style>

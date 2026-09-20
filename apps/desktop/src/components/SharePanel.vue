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
 */
import { computed, ref } from 'vue'
import { ShareCodeError, decodeShareSnapshot, encodeShareSnapshot, type ShareSnapshot } from '@poe2coach/core'
import { t } from '../i18n'
import { realm } from '../settings'

const props = defineProps<{ snapshot: ShareSnapshot }>()
const emit = defineEmits<{ apply: [ShareSnapshot] }>()

const code = computed(() => encodeShareSnapshot(props.snapshot))
const paste = ref('')
const error = ref<string | null>(null)
const done = ref<string | null>(null)
const copied = ref(false)

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

async function copyCode() {
  error.value = null
  done.value = null
  try {
    await navigator.clipboard.writeText(code.value)
    copied.value = true
    window.setTimeout(() => (copied.value = false), 1600)
  } catch {
    // Clipboard access can be refused; the textarea is selectable, which is why it
    // is a textarea and not a read-only line.
    error.value = t('复制被系统拒绝,可以手动选中上面的码复制。')
  }
}

function importCode() {
  error.value = null
  done.value = null
  const raw = paste.value.trim()
  if (!raw) {
    error.value = t('先粘贴一个分享码。')
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
      <button class="btn primary" @click="copyCode">{{ copied ? t('已复制 ✓') : t('复制分享码') }}</button>
      <span class="dim small">{{ code.length }} {{ t('字符') }}</span>
      <span class="spacer" />
      <span class="dim small">{{ t('对方粘到下面的框里即可还原。') }}</span>
    </div>

    <div class="import">
      <textarea
        v-model="paste"
        class="code-box"
        rows="2"
        spellcheck="false"
        :placeholder="t('粘贴分享码…')"
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
.spacer {
  flex: 1;
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

'use client'

/**
 * The one interactive thing on the share page: copying the code.
 *
 * Clipboard access can be refused (permissions, non-focused document); the
 * textarea below is selectable either way, so the failure mode is a hint, not a
 * dead end.
 */
import { useRef, useState } from 'react'

export default function CopyButton({ code }: { code: string }) {
  const [label, setLabel] = useState('复制分享码')
  const timer = useRef<number | null>(null)

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setLabel('已复制 ✓')
    } catch {
      setLabel('请手动选中复制')
    }
    if (timer.current != null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setLabel('复制分享码'), 1600)
  }

  return (
    <button className="btn primary" onClick={copy}>
      {label}
    </button>
  )
}

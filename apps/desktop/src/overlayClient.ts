/**
 * The passive-tree overlay window, which lives in Rust: Tauri's JS API can
 * create windows, but transparency, click-through and the global hotkey all
 * need the native side.
 */
import { invoke } from '@tauri-apps/api/core'
import { isDesktopRuntime } from './tradeClient'

export class OverlayUnsupported extends Error {
  constructor() {
    super('叠加层需要桌面版。')
    this.name = 'OverlayUnsupported'
  }
}

/**
 * The key that actually shows and hides the overlay, or null when every
 * candidate was taken by other software. Rust picks it at startup and reports
 * the winner, because the UI has to name the key that really works — promising
 * one that does not is worse than saying there is none.
 */
export async function overlayHotkey(): Promise<string | null> {
  if (!isDesktopRuntime()) return null
  try {
    return await invoke<string | null>('overlay_hotkey')
  } catch {
    return null
  }
}

/** Show the overlay, hide it again, or create it the first time. */
export async function toggleTreeOverlay(): Promise<boolean> {
  if (!isDesktopRuntime()) throw new OverlayUnsupported()
  return invoke<boolean>('toggle_tree_overlay')
}

/**
 * Lock the card out of the way, or unlock it so it can be dragged.
 *
 * Dragging needs the window to accept clicks, so the two are exclusive: the
 * card starts unlocked so it can be placed, and is locked once it is where the
 * player wants it.
 */
export async function setOverlayClickThrough(clickThrough: boolean): Promise<void> {
  if (!isDesktopRuntime()) throw new OverlayUnsupported()
  await invoke('set_overlay_click_through', { clickThrough })
}

export async function treeOverlayVisible(): Promise<boolean> {
  if (!isDesktopRuntime()) return false
  try {
    return await invoke<boolean>('tree_overlay_visible')
  } catch {
    return false
  }
}

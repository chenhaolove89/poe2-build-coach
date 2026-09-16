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

/** Key that shows and hides the overlay, registered in src-tauri/src/main.rs. */
export const OVERLAY_HOTKEY = 'F8'

/** Show the overlay, hide it again, or create it the first time. */
export async function toggleTreeOverlay(): Promise<boolean> {
  if (!isDesktopRuntime()) throw new OverlayUnsupported()
  return invoke<boolean>('toggle_tree_overlay')
}

export async function treeOverlayVisible(): Promise<boolean> {
  if (!isDesktopRuntime()) return false
  try {
    return await invoke<boolean>('tree_overlay_visible')
  } catch {
    return false
  }
}

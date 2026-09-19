/**
 * Reading the game's Client.txt, which only Rust can do.
 *
 * Everything decision-shaped about following the log — the byte offset, folding
 * lines into events, noticing a truncation — lives in `@poe2coach/core` so it is
 * testable without a game running. This module is the thin part: three commands
 * and where the path is remembered.
 */
import { invoke } from '@tauri-apps/api/core'
import type { LogChunk } from '@poe2coach/core'
import { isDesktopRuntime } from './tradeClient'
import { realmId } from './settings'

/**
 * The remembered log path, one per realm.
 *
 * The realms are different installs with different paths (国服 under WeGame's
 * tree, international under Steam's or GGG's), so a single remembered path is
 * wrong for whichever realm the player is not in at the moment. Each realm gets
 * its own key; the pre-realm key `poe2coach.clientLog` is still read as a
 * fallback so an existing player does not lose their setting on upgrade.
 */
const PATH_KEY_PREFIX = 'poe2coach.clientLog.'
const LEGACY_PATH_KEY = 'poe2coach.clientLog'

export class LogUnsupported extends Error {
  constructor() {
    super('读取游戏日志需要桌面版。')
    this.name = 'LogUnsupported'
  }
}

export function savedLogPathExact(): string {
  try {
    return localStorage.getItem(PATH_KEY_PREFIX + realmId.value) ?? ''
  } catch {
    return ''
  }
}

/** The one global path the pre-realm version wrote, if any. */
export function savedLogPathLegacy(): string {
  try {
    return localStorage.getItem(LEGACY_PATH_KEY) ?? ''
  } catch {
    return ''
  }
}

export function savedLogPath(): string {
  return savedLogPathExact() || savedLogPathLegacy()
}

export function rememberLogPath(path: string): void {
  try {
    if (path) localStorage.setItem(PATH_KEY_PREFIX + realmId.value, path)
    else localStorage.removeItem(PATH_KEY_PREFIX + realmId.value)
  } catch {
    /* storage disabled — the path just will not persist */
  }
}

/**
 * Find the log by looking at the running game, then the usual install roots.
 *
 * Returns null when the game is not running and no known location has it, which
 * is the normal case for a player who installed through a distributor we do not
 * know about — the UI asks for the path by hand then.
 */
export async function findClientLog(): Promise<string | null> {
  if (!isDesktopRuntime()) return null
  try {
    return await invoke<string | null>('find_client_log')
  } catch {
    return null
  }
}

/** New lines from a byte offset. */
export async function readLogFrom(path: string, offset: number): Promise<LogChunk> {
  if (!isDesktopRuntime()) throw new LogUnsupported()
  return invoke<LogChunk>('read_log_from', { path, offset })
}

/**
 * The last `bytes` of the log, without moving the caller's offset — used once
 * at session start to find the area the player is already in.
 */
export async function readLogTail(path: string, bytes: number): Promise<LogChunk> {
  if (!isDesktopRuntime()) throw new LogUnsupported()
  return invoke<LogChunk>('read_log_tail', { path, bytes })
}

/**
 * Read plain text from the system clipboard.
 * Uses Rust native Win32 clipboard in desktop runtime (allowing background reads without focus),
 * falling back to navigator.clipboard.readText() in browser environments.
 */
export async function readClipboardText(): Promise<string> {
  if (isDesktopRuntime()) {
    try {
      const text = await invoke<string>('read_clipboard_text')
      if (text) return text
    } catch {
      /* fallback below */
    }
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
    try {
      return await navigator.clipboard.readText()
    } catch {
      return ''
    }
  }
  return ''
}

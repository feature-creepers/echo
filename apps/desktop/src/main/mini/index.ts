import type { MiniBounds } from '@repo/client'
import { type BrowserWindow, type Rectangle, screen } from 'electron'
import type { DeviceSettingsStore } from '../device-settings.ts'
import { MINI_SIZE, miniBounds } from './bounds.ts'
import { system as darwin } from './darwin.ts'
import { system as linux } from './linux.ts'
import type { MiniSystem } from './system.ts'
import { system as win32 } from './win32.ts'

/** This system's part of Mini. */
const system: MiniSystem = process.platform === 'darwin' ? darwin : process.platform === 'win32' ? win32 : linux

/** How long the window stays where it is before Mini's bounds are written: the move or the resize has ended. */
const STILL_MS = 500

export interface MiniWindow {
  /** Whether the window is Mini now. */
  on(): boolean
  /** Make the window Mini, or the full window again. */
  set(on: boolean): void
  /** Be told each time it changes. */
  onChange(listener: (on: boolean) => void): void
}

/** The full window as it was when it became Mini, given back when it leaves. */
interface Full {
  bounds: Rectangle
  maximized: boolean
  fullScreen: boolean
}

/** What is kept of Mini's bounds on this system: where the app may not read where its window is, only its size. */
const keptOf = ({ x, y, width, height }: Rectangle): MiniBounds => (system.placed() ? { x, y, width, height } : { width, height })

const same = (one: MiniBounds, other: MiniBounds) => one.x === other.x && one.y === other.y && one.width === other.width && one.height === other.height

/**
 * Mini (docs/SPEC.md, section 13.2): the app's one window made small and kept over the other apps. While it is Mini,
 * the full window's bounds are kept in memory, and given back when it leaves. Mini's own are kept on this device once
 * a move or a resize ends. `least` is the full window's smallest size, lifted while it is Mini.
 */
export function createMini(window: BrowserWindow, device: DeviceSettingsStore, least: { width: number; height: number }): MiniWindow {
  let full: Full | undefined
  /** What was last asked: a window leaving full screen becomes Mini once it has left it, if that is still asked. */
  let wanted = false
  let leavingFullScreen = false
  /** Mini's bounds as last placed or kept: a move or a resize that ends there was not the person's. */
  let placed: MiniBounds | undefined
  let still: ReturnType<typeof setTimeout> | undefined
  const listeners = new Set<(on: boolean) => void>()
  const tell = (on: boolean) => {
    for (const listener of listeners) listener(on)
  }

  const keep = () => {
    if (!full) return
    clearTimeout(still)
    still = setTimeout(() => {
      if (!full || window.isDestroyed()) return
      const kept = keptOf(window.getBounds())
      if (placed && same(kept, placed)) return
      placed = kept
      device.change({ window: { mini: kept } })
    }, STILL_MS)
  }
  window.on('move', keep)
  window.on('resize', keep)

  const become = (fullScreen: boolean) => {
    if (window.isMinimized()) window.restore()
    const was: Full = { bounds: window.getNormalBounds(), maximized: window.isMaximized(), fullScreen }
    const areas = screen.getAllDisplays().map((display) => display.workArea)
    const bounds = miniBounds(device.read().window.mini, areas, screen.getDisplayMatching(was.bounds).workArea)
    full = was
    placed = keptOf(bounds)
    if (was.maximized) window.unmaximize()
    // The smallest size is lifted before the window is made small, and the largest set once it is, so it never jumps.
    window.setMinimumSize(MINI_SIZE.least.width, MINI_SIZE.least.height)
    if (system.placed()) system.place(window, bounds)
    else window.setSize(bounds.width, bounds.height)
    window.setMaximumSize(MINI_SIZE.most.width, MINI_SIZE.most.height)
    window.setMaximizable(false)
    window.setFullScreenable(false)
    window.setAlwaysOnTop(true, 'floating')
    system.float(window, true)
    tell(true)
  }

  const enter = () => {
    if (!window.isFullScreen()) return become(false)
    // A window in full screen leaves it first, which macOS animates, and can be made small only once it has.
    if (leavingFullScreen) return
    leavingFullScreen = true
    window.once('leave-full-screen', () => {
      leavingFullScreen = false
      if (wanted && !window.isDestroyed()) become(true)
    })
    window.setFullScreen(false)
  }

  const leave = () => {
    const was = full
    if (!was) return
    full = undefined
    clearTimeout(still)
    system.float(window, false)
    window.setAlwaysOnTop(false)
    window.setMaximizable(true)
    window.setFullScreenable(true)
    // No largest size (0), before the window is made large again; the full window's smallest once it is.
    window.setMaximumSize(0, 0)
    system.place(window, was.bounds)
    window.setMinimumSize(least.width, least.height)
    if (was.fullScreen) window.setFullScreen(true)
    else if (was.maximized) window.maximize()
    tell(false)
  }

  return {
    on: () => full !== undefined,
    set(on) {
      wanted = on
      if (window.isDestroyed() || on === (full !== undefined)) return
      if (on) enter()
      else leave()
    },
    onChange(listener) {
      listeners.add(listener)
    }
  }
}

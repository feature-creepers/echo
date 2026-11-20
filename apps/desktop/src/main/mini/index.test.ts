import { EventEmitter } from 'node:events'
import { changeDeviceSettings, DEFAULT_DEVICE_SETTINGS, type DeviceSettings, type DeviceSettingsChange } from '@repo/client'
import type { BrowserWindow, Rectangle } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceSettingsStore } from '../device-settings.ts'

/** One screen, the taskbar under it. */
const SCREEN = { x: 0, y: 0, width: 1920, height: 1040 }

vi.mock('electron', () => ({
  screen: { getAllDisplays: () => [{ workArea: SCREEN }], getDisplayMatching: () => ({ workArea: SCREEN }) },
  app: { commandLine: { getSwitchValue: () => '' } }
}))

const { createMini } = await import('./index.ts')

/** The full window's smallest size. */
const LEAST = { width: 720, height: 560 }

/** A window as the system keeps it: its bounds and states, moved and resized as Electron's calls ask. */
function fakeWindow(bounds: Rectangle) {
  const events = new EventEmitter()
  const state = { bounds, maximized: false, fullScreen: false, onTop: false, least: LEAST, most: { width: 0, height: 0 } }
  const resize = (next: Rectangle) => {
    state.bounds = next
    events.emit('move')
    events.emit('resize')
  }
  const window = {
    on: (name: string, listener: () => void) => events.on(name, listener),
    once: (name: string, listener: () => void) => events.once(name, listener),
    isDestroyed: () => false,
    isMinimized: () => false,
    isMaximized: () => state.maximized,
    isFullScreen: () => state.fullScreen,
    getBounds: () => state.bounds,
    getNormalBounds: () => state.bounds,
    setBounds: resize,
    setSize: (width: number, height: number) => resize({ ...state.bounds, width, height }),
    maximize: () => {
      state.maximized = true
    },
    unmaximize: () => {
      state.maximized = false
    },
    setFullScreen: (on: boolean) => {
      state.fullScreen = on
      // The system takes its time to leave full screen, as macOS animates it.
      if (!on) setTimeout(() => events.emit('leave-full-screen'), 300)
    },
    setMinimumSize: (width: number, height: number) => {
      state.least = { width, height }
    },
    setMaximumSize: (width: number, height: number) => {
      state.most = { width, height }
    },
    setAlwaysOnTop: (on: boolean) => {
      state.onTop = on
    },
    setMaximizable: () => undefined,
    setFullScreenable: () => undefined,
    setWindowButtonVisibility: () => undefined,
    setVisibleOnAllWorkspaces: () => undefined,
    restore: () => undefined
  }
  return { window: window as unknown as BrowserWindow, state, moveTo: (x: number, y: number) => resize({ ...state.bounds, x, y }) }
}

/** This device's settings, kept in memory. */
function memoryDevice(): DeviceSettingsStore & { writes: number } {
  let settings: DeviceSettings = DEFAULT_DEVICE_SETTINGS
  const store = {
    writes: 0,
    read: () => settings,
    change(change: DeviceSettingsChange) {
      store.writes += 1
      settings = changeDeviceSettings(settings, change)
      return settings
    },
    onChange: () => () => undefined
  }
  return store
}

const FULL = { x: 200, y: 100, width: 1320, height: 860 }
const FIRST = { x: 1616, y: 24, width: 280, height: 320 }

describe('Mini', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Under Wayland the window's place is not the app's: these cases are where it is.
    vi.stubEnv('WAYLAND_DISPLAY', '')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('makes the window small and keeps it on top, then gives the full window back as it was', () => {
    const { window, state } = fakeWindow(FULL)
    const mini = createMini(window, memoryDevice(), LEAST)
    const told: boolean[] = []
    mini.onChange((on) => told.push(on))

    mini.set(true)
    expect(state).toMatchObject({ bounds: FIRST, onTop: true, least: { width: 240, height: 260 }, most: { width: 480, height: 560 } })
    expect(mini.on()).toBe(true)

    mini.set(false)
    expect(state).toMatchObject({ bounds: FULL, onTop: false, least: LEAST, most: { width: 0, height: 0 } })
    expect(mini.on()).toBe(false)
    expect(told).toEqual([true, false])
  })

  it('gives a maximised window back maximised', () => {
    const { window, state } = fakeWindow(FULL)
    state.maximized = true
    const mini = createMini(window, memoryDevice(), LEAST)

    mini.set(true)
    expect(state).toMatchObject({ bounds: FIRST, maximized: false })
    mini.set(false)
    expect(state).toMatchObject({ bounds: FULL, maximized: true })
  })

  it('keeps where Mini is moved once the move ends, and opens there the next time', () => {
    const { window, state, moveTo } = fakeWindow(FULL)
    const device = memoryDevice()
    const mini = createMini(window, device, LEAST)

    mini.set(true)
    vi.advanceTimersByTime(1000)
    // Placed by the app, not moved by the person: nothing is kept.
    expect(device.writes).toBe(0)

    moveTo(400, 300)
    moveTo(420, 310)
    expect(device.writes).toBe(0)
    vi.advanceTimersByTime(1000)
    expect(device.read().window.mini).toEqual({ x: 420, y: 310, width: 280, height: 320 })
    expect(device.writes).toBe(1)

    mini.set(false)
    moveTo(0, 0)
    vi.advanceTimersByTime(1000)
    expect(device.writes).toBe(1)

    mini.set(true)
    expect(state.bounds).toEqual({ x: 420, y: 310, width: 280, height: 320 })
  })

  it('takes a window out of full screen first, and puts it back once Mini is left', () => {
    const { window, state } = fakeWindow(FULL)
    state.fullScreen = true
    const mini = createMini(window, memoryDevice(), LEAST)

    mini.set(true)
    expect(mini.on()).toBe(false)
    vi.advanceTimersByTime(300)
    expect(state).toMatchObject({ bounds: FIRST, fullScreen: false, onTop: true })

    mini.set(false)
    expect(state).toMatchObject({ bounds: FULL, fullScreen: true })
  })

  it('stays the full window when asked back before it has left full screen', () => {
    const { window, state } = fakeWindow(FULL)
    state.fullScreen = true
    const mini = createMini(window, memoryDevice(), LEAST)

    mini.set(true)
    mini.set(false)
    vi.advanceTimersByTime(300)
    expect(mini.on()).toBe(false)
    expect(state).toMatchObject({ bounds: FULL, onTop: false })
  })
})

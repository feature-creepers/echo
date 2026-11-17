import type { DeviceSettings, DeviceSettingsChange, UpdateState } from '@repo/client'

export type ShortcutName = keyof DeviceSettings['shortcuts']

/** A shortcut given, or refused and why, in words for the user. */
export type ShortcutChange = { ok: true; settings: DeviceSettings } | { ok: false; problem: string }

/** The app, as the settings show it. */
export interface About {
  name: string
  version: string
  /** The system, as Node names it: 'win32', 'darwin', 'linux'. */
  system: string
  electron: string
  /** The folder where the app keeps everything it writes. */
  dataFolder: string
  /** The app has a page of releases to open: an installed copy, which knows where its updates come from. */
  releases?: boolean
}

/**
 * What the interface needs from the app that hosts it to show and change the settings of this device. The
 * desktop app supplies it; the interface never knows how it keeps them.
 */
export interface DeviceHost {
  settings: {
    read(): Promise<DeviceSettings>
    change(change: DeviceSettingsChange): Promise<DeviceSettings>
    onChange(listener: (settings: DeviceSettings) => void): () => void
    /** Give an action new keys. The app asks the system first for the one it takes from every app. */
    setShortcut(name: ShortcutName, accelerator: string): Promise<ShortcutChange>
    /** Let go of the app's shortcuts while the user records a new one, so that pressing them records them. */
    suspendShortcuts(suspended: boolean): void
    /** Why the shortcut to talk from any app does not work now. Nothing when it does. */
    shortcutProblem(): Promise<string | undefined>
  }
  about(): Promise<About>
  openDataFolder(): Promise<void>
  openReleases(): Promise<void>
  updates: {
    state(): Promise<UpdateState>
    onState(listener: (state: UpdateState) => void): () => void
    check(): Promise<void>
    download(): Promise<void>
    install(): Promise<void>
  }
}

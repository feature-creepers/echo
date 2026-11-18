import type { DeviceSettings, DeviceSettingsChange, UpdateState } from '@repo/client'
import type { Accent } from '@repo/protocol'
import type { Mood } from '../presence/painter.ts'

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
  /** Show how the assistant is outside the window: the desktop app's tray. Left out, nothing does. */
  showPresence?(presence: { accent: Accent | undefined; mood: Mood }): void
  /** The files of this computer, picked by the user for the assistant. Left out, folders cannot be picked here. */
  files?: {
    /** The system's own picker, for folders or files. Nothing when the user cancels. */
    pick(kind: 'folder' | 'file'): Promise<string[]>
    /** Show a folder or a file in the system's file manager. */
    reveal(path: string): Promise<void>
    /**
     * Open a file with the app the system gives its kind, or a folder in the file manager. A file that would run a
     * program is shown in its folder instead. Left out, files are not opened from here.
     */
    open?(path: string): Promise<void>
    /** Where a file or a folder dropped on the window is on this computer. Left out, the window cannot tell. */
    pathOf?(file: File): string | undefined
  }
  updates: {
    state(): Promise<UpdateState>
    onState(listener: (state: UpdateState) => void): () => void
    check(): Promise<void>
    download(): Promise<void>
    install(): Promise<void>
  }
}

import type { DeviceSettings, DeviceSettingsChange, UpdateState } from '@repo/client'
import type { Accent } from '@repo/protocol'
import type { Mood } from '../presence/life.ts'

export type ShortcutName = keyof DeviceSettings['shortcuts']

/** A shortcut given, or refused and why, in words for the person. */
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
 * What a folder or a file is picked for, which words the system's picker: giving access to several, the one folder a
 * project works in, the proof of concept's folder to import, or a folder to hand over with what is said.
 */
export type PickPurpose = 'access' | 'project' | 'import' | 'attach'

/** Files copied in a file manager, read by the app that hosts the window. */
export interface CopiedFiles {
  files: { name: string; data: Uint8Array }[]
  folders: { name: string; path: string }[]
  /** The names of files over the most a file can be. */
  tooLarge: string[]
  /** How many more files and folders were copied than can go with one message. */
  more: number
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
    /** Let go of the app's shortcuts while the person records a new one, so that pressing them records them. */
    suspendShortcuts(suspended: boolean): void
    /** Why the shortcuts taken from any app that do not work now are refused, by action. */
    shortcutProblems(): Promise<Partial<Record<ShortcutName, string>>>
  }
  about(): Promise<About>
  openDataFolder(): Promise<void>
  openReleases(): Promise<void>
  /** Show how the assistant is outside the window: the desktop app's tray. Left out, nothing does. */
  showPresence?(presence: { accent: Accent | undefined; mood: Mood }): void
  /**
   * Be told how hard this computer works, from 0 to 1: the larger of how busy its processors are and how pressed its
   * memory is, about once a second. Returns a function that stops the telling. Left out, the load is not known, and
   * the core looks as it does on a computer at rest.
   */
  load?(listener: (load: number) => void): () => void
  /** The files of this computer, picked by the person for the assistant. Left out, folders cannot be picked here. */
  files?: {
    /**
     * The system's own picker: folders or files to give access to; for a project, the one folder it works in; to
     * import, the proof of concept's folder; to attach, one folder to hand over with what is said. Nothing when the
     * person cancels.
     */
    pick(kind: 'folder' | 'file', purpose?: PickPurpose): Promise<string[]>
    /** Show a folder or a file in the system's file manager. */
    reveal(path: string): Promise<void>
    /**
     * Open a file with the app the system gives its kind, or a folder in the file manager. A file that would run a
     * program is shown in its folder instead. Left out, files are not opened from here.
     */
    open?(path: string): Promise<void>
    /** Where a file or a folder dropped on the window is on this computer. Left out, the window cannot tell. */
    pathOf?(file: File): string | undefined
    /**
     * The files copied in a file manager that the window is not given when they are pasted, read by the app: Linux's
     * file managers put their addresses on the clipboard, not their content. Each file's name and bytes, the folders
     * by where they are, and what cannot go; nothing in them when none were copied. Left out where the window is
     * given copied files as files.
     */
    takeCopied?(): Promise<CopiedFiles>
  }
  updates: {
    state(): Promise<UpdateState>
    onState(listener: (state: UpdateState) => void): () => void
    check(): Promise<void>
    download(): Promise<void>
    install(): Promise<void>
  }
}

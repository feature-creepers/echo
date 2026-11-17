import type { CoreLink, DeviceSettings, DeviceSettingsChange, SessionLink, UpdateState } from '@repo/client'
import type { InstallProgress, SpeechStatus } from '@repo/speech'

/**
 * What the window may ask of the app, and nothing more. The preload script puts it on `window.desktop`;
 * the window has no other way to reach the system.
 */
export interface DesktopBridge {
  /** Where the app stands with its core, now. */
  coreLink(): Promise<CoreLink>
  /** Be told each time that changes. Returns a function that stops the telling. */
  onCoreLink(listener: (link: CoreLink) => void): () => void
  /**
   * The messages exchanged with the core once connected: what the window opens its session on.
   * The app passes them on unread, both ways. Sent while there is no link, a message is dropped.
   */
  core: SessionLink
  /** The speech engines of this device. */
  speech: SpeechBridge
  /** Be told when the user pressed the global shortcut to talk. Returns a function that stops the telling. */
  onTalk(listener: () => void): () => void
  /** Be told when the app asks to show the settings: from the tray's menu. */
  onOpenSettings(listener: () => void): () => void
  /** The settings of this device, which the app keeps. */
  device: DeviceBridge
  /** The app itself: its version, where it keeps its data. */
  app: AppBridge
  /** New versions of the app. */
  updates: UpdatesBridge
}

export type ShortcutName = keyof DeviceSettings['shortcuts']

/** A shortcut given, or refused and why, in words for the user. */
export type ShortcutChange = { ok: true; settings: DeviceSettings } | { ok: false; problem: string }

export interface DeviceBridge {
  read(): Promise<DeviceSettings>
  change(change: DeviceSettingsChange): Promise<DeviceSettings>
  /** Be told of every change, from this window or from the app. Returns a function that stops the telling. */
  onChange(listener: (settings: DeviceSettings) => void): () => void
  /** Give an action new keys. The app asks the system first for the one it takes from every app. */
  setShortcut(name: ShortcutName, accelerator: string): Promise<ShortcutChange>
  /** Let go of the app's shortcuts while the user records a new one, so that pressing them records them. */
  suspendShortcuts(suspended: boolean): void
  /** Why the shortcut to talk from any app does not work now, in words for the user. Nothing when it does. */
  shortcutProblem(): Promise<string | undefined>
}

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

export interface AppBridge {
  about(): Promise<About>
  /** Show the data folder in the system's file manager. */
  openDataFolder(): Promise<void>
  /** Open the page of the app's releases in the browser. */
  openReleases(): Promise<void>
}

export interface UpdatesBridge {
  state(): Promise<UpdateState>
  onState(listener: (state: UpdateState) => void): () => void
  check(): Promise<void>
  download(): Promise<void>
  /** Restart into the downloaded version. */
  install(): Promise<void>
}

/** The channels of the app's own calls: device settings, the app, updates. */
export const APP_CHANNELS = {
  deviceRead: 'device:read',
  deviceChange: 'device:change',
  deviceChanged: 'device:changed',
  shortcutSet: 'device:shortcut-set',
  shortcutsSuspend: 'device:shortcuts-suspend',
  shortcutProblem: 'device:shortcut-problem',
  about: 'app:about',
  openDataFolder: 'app:open-data-folder',
  openReleases: 'app:open-releases',
  openSettings: 'app:open-settings',
  updateState: 'updates:state',
  updateChanged: 'updates:changed',
  updateCheck: 'updates:check',
  updateDownload: 'updates:download',
  updateInstall: 'updates:install'
} as const

/** The channel the global shortcut to talk comes on. */
export const TALK_CHANNEL = 'talk'

/** Sound as it crosses to and from the window. */
export interface BridgeSound {
  sampleRate: number
  samples: Float32Array
}

export interface SpeechBridge {
  status(): Promise<SpeechStatus>
  /** Download the models that are missing, telling progress as it goes. */
  install(onProgress: (progress: InstallProgress) => void): Promise<void>
  transcribe(sound: BridgeSound): Promise<{ text: string; language?: string }>
  /** `speed` is the pace, 1 being the voice's natural one. */
  speak(text: string, how: { style: string; language: string; speed?: number }): Promise<BridgeSound>
  /** The voice's styles, to pick from. */
  styles(): Promise<{ id: string; name: string }[]>
}

/** The channels speech uses, one per call, and the one progress comes back on. */
export const SPEECH_CHANNELS = {
  status: 'speech:status',
  install: 'speech:install',
  progress: 'speech:progress',
  transcribe: 'speech:transcribe',
  speak: 'speech:speak',
  styles: 'speech:styles'
} as const

/** The channel that carries the state of the link, as a request and as a notification. */
export const CORE_LINK_CHANNEL = 'core-link'

/** The channel that carries the messages between the window and the core, both ways. */
export const CORE_MESSAGE_CHANNEL = 'core-message'

declare global {
  interface Window {
    desktop: DesktopBridge
  }
}

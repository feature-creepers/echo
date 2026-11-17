import { isShortcut, sameShortcut } from './shortcuts.ts'

/**
 * The settings of one device: what belongs to this computer rather than to the user, so they stay on it
 * (docs/SPEC.md, section 5.2). The user's own settings (personas, models, memory) are the core's.
 *
 * The app keeps them where it likes (the desktop app, in a file of its data folder) and reads them back
 * with `readDeviceSettings`, which accepts anything and gives settings that can be used.
 */
export interface DeviceSettings {
  /** Which version of these settings wrote them, so that a default changed since is not mistaken for a choice. */
  revision: number
  /** The microphone that hears the user. */
  microphone: AudioDevice
  /** Where the assistant's voice plays. */
  speaker: AudioDevice
  listening: {
    /** How long a pause ends what the user says, or never: the user presses the shortcut again to send. */
    pause: Pause
    /** A short sound when the microphone opens and when it closes. */
    sounds: boolean
  }
  voice: {
    /** The answers are spoken. Off, they are only shown, for a quiet room. */
    aloud: boolean
    /** How fast the voice speaks: 1 is its natural pace. */
    speed: number
  }
  /** Keyboard shortcuts, as Electron writes them. An empty one is off. */
  shortcuts: {
    /**
     * Talk from any app: the system hands the keys to this app, and every other app loses them. Off until the
     * user records keys, so the app never takes keys another program uses.
     */
    talk: string
    /** Talk while the window is in front. */
    talkInWindow: string
    /** Show or hide the transcript. */
    transcript: string
  }
  app: {
    /** Start when the user signs in to the computer, in the background. */
    launchAtLogin: boolean
    /** Start in the background, out of sight, ready for the shortcut. */
    startHidden: boolean
    /** Closing the window keeps the app running in the tray, ready for the shortcut. Off, closing quits. */
    closeToTray: boolean
  }
  updates: {
    /** Download new versions in the background and install them when the app quits. */
    automatic: boolean
  }
}

/** An audio device, by the identifier the system gives it and the name it shows. An empty identifier is the system's own choice. */
export interface AudioDevice {
  id: string
  /** Finds the device again when its identifier changed, as it can from one launch or one connection to the next. */
  label: string
}

export const PAUSES = ['short', 'normal', 'long', 'never'] as const
export type Pause = (typeof PAUSES)[number]

/** The pause that ends a take, in milliseconds. Nothing for never. */
export function pauseMs(pause: Pause): number | undefined {
  return { short: 800, normal: 1400, long: 2600, never: undefined }[pause]
}

/** The paces a voice can speak at, slowest first. */
export const SPEEDS = [0.85, 1, 1.15, 1.3] as const

/** The version of the settings this build writes. */
const REVISION = 2

/**
 * The shortcut to talk from any app that versions before the second took by default, taken from every other
 * program whether the user wanted it or not: an editor's parameter hints use the same keys.
 */
const FORMER_TALK = 'CommandOrControl+Shift+Space'

export const DEFAULT_DEVICE_SETTINGS: DeviceSettings = {
  revision: REVISION,
  microphone: { id: '', label: '' },
  speaker: { id: '', label: '' },
  listening: { pause: 'normal', sounds: true },
  voice: { aloud: true, speed: 1 },
  shortcuts: { talk: '', talkInWindow: 'CommandOrControl+Space', transcript: 'CommandOrControl+T' },
  app: { launchAtLogin: false, startHidden: false, closeToTray: true },
  updates: { automatic: true }
}

/** Part of the settings, to change: every field may be left out. */
export type DeviceSettingsChange = { [Group in keyof DeviceSettings]?: Partial<DeviceSettings[Group]> }

type Raw = Record<string, unknown>
/** A copy that shares nothing with the original. The settings are plain data. */
const copy = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value)) as Value
const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value)

/** `patch` laid over `base`: a field of `base` takes the patch's value when it is of the same type, and keeps its own otherwise. */
function overlay<Value>(base: Value, patch: unknown): Value {
  if (!isObject(base) || !isObject(patch)) return base
  const out: Raw = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(out, key) || value === undefined) continue
    const current = out[key]
    if (isObject(current)) out[key] = overlay(current, value)
    else if (typeof value === typeof current) out[key] = value
  }
  return out as Value
}

/**
 * Settings that can be used, from anything: a file written by an older version, edited by hand, or broken.
 * What is missing or wrong takes its default; what is unknown is dropped.
 */
export function readDeviceSettings(raw: unknown): DeviceSettings {
  const read = overlay(copy(DEFAULT_DEVICE_SETTINGS), raw)
  const fallback = DEFAULT_DEVICE_SETTINGS
  if (!PAUSES.includes(read.listening.pause)) read.listening.pause = fallback.listening.pause
  if (!Number.isFinite(read.voice.speed) || read.voice.speed < 0.5 || read.voice.speed > 2) read.voice.speed = fallback.voice.speed
  for (const name of Object.keys(read.shortcuts) as (keyof DeviceSettings['shortcuts'])[]) {
    const shortcut = read.shortcuts[name]
    if (shortcut !== '' && !isShortcut(shortcut)) read.shortcuts[name] = fallback.shortcuts[name]
  }
  // Written before the second version, the former default was never chosen: it is let go.
  const written = isObject(raw) && typeof raw.revision === 'number' ? raw.revision : 1
  if (written < 2 && read.shortcuts.talk === FORMER_TALK) read.shortcuts.talk = ''
  read.revision = REVISION
  return read
}

/** The settings with a change applied, read again so that a wrong value never gets in. */
export function changeDeviceSettings(settings: DeviceSettings, change: DeviceSettingsChange): DeviceSettings {
  return readDeviceSettings(overlay(copy(settings), change))
}

const SHORTCUT_NAMES: Record<keyof DeviceSettings['shortcuts'], string> = {
  talk: 'talking from any app',
  talkInWindow: 'talking in the window',
  transcript: 'the transcript'
}

/**
 * Why a shortcut cannot be given to one of the app's actions, in words for the user: another action of the
 * app has it. Nothing when it can. Whether another app or the system holds it is for the system to say.
 */
export function shortcutClash(
  shortcuts: DeviceSettings['shortcuts'],
  name: keyof DeviceSettings['shortcuts'],
  accelerator: string,
  mac: boolean
): string | undefined {
  if (accelerator === '') return undefined
  for (const other of Object.keys(shortcuts) as (keyof DeviceSettings['shortcuts'])[]) {
    // Talking from any app and in the window may share their keys: both do the same thing.
    const sameAction = (other === 'talk' && name === 'talkInWindow') || (other === 'talkInWindow' && name === 'talk')
    if (other !== name && !sameAction && sameShortcut(shortcuts[other], accelerator, mac)) return `These keys are already used for ${SHORTCUT_NAMES[other]}.`
  }
  return undefined
}

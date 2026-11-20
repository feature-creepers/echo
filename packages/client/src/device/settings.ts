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
    /**
     * The voice styles the user picked: by persona, then by language. A language with none picked is spoken in
     * the style that suits the persona's stance in that language.
     */
    styles: VoiceStyles
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
    /**
     * Stop everything the assistant does, from any app: the same as the tray's "Stop everything". Taken from the
     * whole system as talking is, and off until the user records keys for the same reason.
     */
    stopEverything: string
    /** Make the window Mini, or the full window again, while it is in front (docs/SPEC.md, section 13.2). */
    mini: string
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
  /** The app's one window. */
  window: {
    /** Where Mini was left, and how large. Left out until it is first moved or resized: it then opens as the first time. */
    mini?: MiniBounds
  }
  /** The side sheet of advanced views. */
  sheet: {
    /** How wide the user made it, in pixels. A window too narrow for it shows it narrower, and this width again once it is wide enough. */
    width: number
  }
}

/** An audio device, by the identifier the system gives it and the name it shows. An empty identifier is the system's own choice. */
export interface AudioDevice {
  id: string
  /** Finds the device again when its identifier changed, as it can from one launch or one connection to the next. */
  label: string
}

/**
 * Mini's size and place on the screen, in whole pixels. With no place, where the system does not let an app read it
 * (Wayland), it opens where it opens the first time.
 */
export interface MiniBounds {
  width: number
  height: number
  x?: number
  y?: number
}

/** A persona's identifier, then a language's two-letter code, to the identifier of the voice style picked for it. */
export type VoiceStyles = Record<string, Record<string, string>>

export const PAUSES = ['short', 'normal', 'long', 'never'] as const
export type Pause = (typeof PAUSES)[number]

/** The pause that ends a take, in milliseconds. Nothing for never. */
export function pauseMs(pause: Pause): number | undefined {
  return { short: 800, normal: 1400, long: 2600, never: undefined }[pause]
}

/** The paces a voice can speak at, slowest first. */
export const SPEEDS = [0.85, 1, 1.15, 1.3] as const

/**
 * The widths the side sheet may take, in pixels: never narrower than its content can be read at, never wider
 * than a large share of a big screen, and 27rem until the user drags it.
 */
export const SHEET_WIDTH = { least: 320, most: 960, initial: 432 } as const

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
  voice: { aloud: true, speed: 1, styles: {} },
  shortcuts: { talk: '', talkInWindow: 'CommandOrControl+Space', transcript: 'CommandOrControl+T', stopEverything: '', mini: 'CommandOrControl+Shift+M' },
  app: { launchAtLogin: false, startHidden: false, closeToTray: true },
  updates: { automatic: true },
  window: {},
  sheet: { width: SHEET_WIDTH.initial }
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

/** How a persona's identifier, a language's code and a style's identifier are written. */
const PERSONA_ID = /^[\w-]{1,64}$/
const LANGUAGE_CODE = /^[a-z]{2}$/
const STYLE_ID = /^[\w-]{1,40}$/

/**
 * The voice styles picked, from anything: each pick whose persona, language and style are written as they
 * should be. The rest is dropped, and a persona left with no pick with it.
 */
function readVoiceStyles(raw: unknown): VoiceStyles {
  if (!isObject(raw)) return {}
  const personas: [string, Record<string, string>][] = []
  for (const [persona, languages] of Object.entries(raw)) {
    if (!PERSONA_ID.test(persona) || !isObject(languages)) continue
    const picked = Object.entries(languages).filter(
      (pick): pick is [string, string] => LANGUAGE_CODE.test(pick[0]) && typeof pick[1] === 'string' && STYLE_ID.test(pick[1])
    )
    if (picked.length > 0) personas.push([persona, Object.fromEntries(picked)])
  }
  // Made from entries rather than assigned key by key, so that a key such as "__proto__" stays a plain key.
  return Object.fromEntries(personas)
}

/** A whole number of pixels, from anything: nothing when it is not a number. */
const pixels = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined)

/**
 * Mini's bounds, from anything: a size of whole pixels, and a place only when both its coordinates are numbers.
 * Nothing when the size is missing or not a size. How large it may be is for the window to decide.
 */
function readMiniBounds(raw: unknown): MiniBounds | undefined {
  if (!isObject(raw)) return undefined
  const width = pixels(raw.width)
  const height = pixels(raw.height)
  if (width === undefined || height === undefined || width <= 0 || height <= 0) return undefined
  const x = pixels(raw.x)
  const y = pixels(raw.y)
  return x === undefined || y === undefined ? { width, height } : { width, height, x, y }
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
  // The picks' keys are not known in advance, so they are read on their own rather than laid over the defaults.
  read.voice.styles = readVoiceStyles(isObject(raw) && isObject(raw.voice) ? raw.voice.styles : undefined)
  // Mini's bounds are not known in advance either: there are none until it is first moved or resized.
  const mini = readMiniBounds(isObject(raw) && isObject(raw.window) ? raw.window.mini : undefined)
  read.window = mini ? { mini } : {}
  if (!Number.isFinite(read.sheet.width)) read.sheet.width = fallback.sheet.width
  read.sheet.width = Math.round(Math.min(SHEET_WIDTH.most, Math.max(SHEET_WIDTH.least, read.sheet.width)))
  for (const name of Object.keys(read.shortcuts) as ShortcutName[]) {
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
  const changed = overlay(copy(settings), change)
  // The voice styles picked are given whole: laid over the ones before, a persona or a language new to them would be lost.
  if (change.voice?.styles !== undefined) changed.voice.styles = copy(change.voice.styles)
  // So are Mini's bounds, which the settings have none of at first.
  if (change.window?.mini !== undefined) changed.window.mini = copy(change.window.mini)
  return readDeviceSettings(changed)
}

export type ShortcutName = keyof DeviceSettings['shortcuts']

/**
 * The shortcuts taken from the whole system, which work from any app: the system gives each to the first app
 * that asks, so the app asks for these, and the others are keys watched inside the window.
 */
export const GLOBAL_SHORTCUTS = ['talk', 'stopEverything'] as const satisfies readonly ShortcutName[]
export type GlobalShortcutName = (typeof GLOBAL_SHORTCUTS)[number]

/** Whether a shortcut is one the app takes from the whole system. */
export const isGlobalShortcut = (name: ShortcutName): name is GlobalShortcutName => (GLOBAL_SHORTCUTS as readonly ShortcutName[]).includes(name)

const SHORTCUT_NAMES: Record<ShortcutName, string> = {
  talk: 'talking from any app',
  talkInWindow: 'talking in the window',
  transcript: 'the transcript',
  stopEverything: 'stopping everything',
  mini: 'the mini window'
}

/**
 * Why a shortcut cannot be given to one of the app's actions, in words for the user: another action of the
 * app has it. Nothing when it can. Whether another app or the system holds it is for the system to say.
 */
export function shortcutClash(shortcuts: DeviceSettings['shortcuts'], name: ShortcutName, accelerator: string, mac: boolean): string | undefined {
  if (accelerator === '') return undefined
  for (const other of Object.keys(shortcuts) as ShortcutName[]) {
    // Talking from any app and in the window may share their keys: both do the same thing.
    const sameAction = (other === 'talk' && name === 'talkInWindow') || (other === 'talkInWindow' && name === 'talk')
    if (other !== name && !sameAction && sameShortcut(shortcuts[other], accelerator, mac)) return `These keys are already used for ${SHORTCUT_NAMES[other]}.`
  }
  return undefined
}

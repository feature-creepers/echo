import { describe, expect, it } from 'vitest'
import {
  changeDeviceSettings,
  DEFAULT_DEVICE_SETTINGS,
  GLOBAL_SHORTCUTS,
  isGlobalShortcut,
  pauseMs,
  readDeviceSettings,
  SHEET_WIDTH,
  shortcutClash
} from './settings.ts'

describe('device settings read back', () => {
  it('are the defaults when there is nothing, or nothing usable', () => {
    expect(readDeviceSettings(undefined)).toEqual(DEFAULT_DEVICE_SETTINGS)
    expect(readDeviceSettings('broken')).toEqual(DEFAULT_DEVICE_SETTINGS)
    expect(readDeviceSettings([1, 2])).toEqual(DEFAULT_DEVICE_SETTINGS)
  })

  it('keep what is right, and put the default in place of what is wrong, missing or of another type', () => {
    const read = readDeviceSettings({
      microphone: { id: 'usb-1', label: 'Desk microphone' },
      listening: { pause: 'forever', sounds: false },
      voice: { aloud: 'yes', speed: 9 },
      shortcuts: { talk: 'Alt+Space', talkInWindow: 'Hyper+K', transcript: '' },
      unknown: { kept: false }
    })
    expect(read.microphone).toEqual({ id: 'usb-1', label: 'Desk microphone' })
    expect(read.listening).toEqual({ pause: 'normal', sounds: false })
    expect(read.voice).toEqual({ aloud: true, speed: 1, styles: {} })
    expect(read.shortcuts).toEqual({
      talk: 'Alt+Space',
      talkInWindow: 'CommandOrControl+Space',
      transcript: '',
      stopEverything: '',
      mini: 'CommandOrControl+Shift+M'
    })
    expect(read).not.toHaveProperty('unknown')
  })

  it.each([
    ['a pick of each persona in each language', { ally: { en: 'm3', fr: 'm5' }, critic: { de: 'f1' } }, { ally: { en: 'm3', fr: 'm5' }, critic: { de: 'f1' } }],
    ['nothing', undefined, {}],
    ['a list', ['m3'], {}],
    ['one style for every language, as earlier versions kept it', { ally: 'm3' }, {}],
    ['a language that is not a code', { ally: { English: 'm3', 'fr-FR': 'm2', en: 'm3' } }, { ally: { en: 'm3' } }],
    ['a style that is not a string or an identifier', { ally: { en: 3, fr: '', de: 'a b', it: 'm4' } }, { ally: { it: 'm4' } }],
    ['a persona whose picks are all wrong', { ally: { en: 7 }, critic: { en: 'm2' } }, { critic: { en: 'm2' } }],
    ['a persona that is not an identifier', { '': { en: 'm3' }, 'two words': { en: 'm3' } }, {}]
  ])('keep the voice styles picked from %s, and only those written as they should be', (_case, styles, kept) => {
    expect(readDeviceSettings({ voice: { styles } }).voice.styles).toEqual(kept)
  })

  it('keep a persona called "__proto__" as a plain key', () => {
    const read = readDeviceSettings(JSON.parse('{"voice":{"styles":{"__proto__":{"en":"m1"}}}}'))
    expect(Object.getPrototypeOf(read.voice.styles)).toBe(Object.prototype)
    expect(Object.keys(read.voice.styles)).toEqual(['__proto__'])
  })

  it('let go of the shortcut to talk from any app that earlier versions took by default, and keep one chosen since', () => {
    expect(readDeviceSettings({ shortcuts: { talk: 'CommandOrControl+Shift+Space' } }).shortcuts.talk).toBe('')
    expect(readDeviceSettings({ shortcuts: { talk: 'Alt+Space' } }).shortcuts.talk).toBe('Alt+Space')
    expect(readDeviceSettings({ revision: 2, shortcuts: { talk: 'CommandOrControl+Shift+Space' } }).shortcuts.talk).toBe('CommandOrControl+Shift+Space')
    expect(DEFAULT_DEVICE_SETTINGS.shortcuts.talk).toBe('')
  })

  it('take no keys from other apps until the user records them', () => {
    for (const name of GLOBAL_SHORTCUTS) expect(DEFAULT_DEVICE_SETTINGS.shortcuts[name]).toBe('')
    expect(readDeviceSettings({ shortcuts: { stopEverything: 'Control+Alt+Pause' } }).shortcuts.stopEverything).toBe('')
    expect(readDeviceSettings({ shortcuts: { stopEverything: 'Control+Alt+Shift+Escape' } }).shortcuts.stopEverything).toBe('Control+Alt+Shift+Escape')
  })

  it('keep the side sheet between its narrowest and widest, as a whole number of pixels', () => {
    expect(readDeviceSettings({ sheet: { width: 500.4 } }).sheet.width).toBe(500)
    expect(readDeviceSettings({ sheet: { width: 12 } }).sheet.width).toBe(SHEET_WIDTH.least)
    expect(readDeviceSettings({ sheet: { width: 4000 } }).sheet.width).toBe(SHEET_WIDTH.most)
    expect(readDeviceSettings({ sheet: { width: Number.NaN } }).sheet.width).toBe(SHEET_WIDTH.initial)
    expect(readDeviceSettings({ sheet: { width: '600' } }).sheet.width).toBe(SHEET_WIDTH.initial)
    expect(readDeviceSettings({}).sheet.width).toBe(SHEET_WIDTH.initial)
  })

  it.each([
    ['a place and a size', { x: -300, y: 40, width: 280, height: 320 }, { x: -300, y: 40, width: 280, height: 320 }],
    ['a size outside what Mini may be, for the window to bring within it', { x: 0, y: 0, width: 9000, height: 12 }, { x: 0, y: 0, width: 9000, height: 12 }],
    ['fractions of a pixel', { x: 10.4, y: 20.6, width: 280.5, height: 320.2 }, { x: 10, y: 21, width: 281, height: 320 }],
    ['a size with no place, where the system does not tell it', { width: 300, height: 340 }, { width: 300, height: 340 }],
    ['a place missing one of its coordinates', { x: 10, width: 300, height: 340 }, { width: 300, height: 340 }],
    ['a place written as text', { x: '10', y: '20', width: 300, height: 340 }, { width: 300, height: 340 }],
    ['no size', { x: 10, y: 20 }, undefined],
    ['a size of nothing', { x: 10, y: 20, width: 0, height: 320 }, undefined],
    ['a size that is not a number', { width: Number.NaN, height: 320 }, undefined],
    ['a list', [280, 320], undefined],
    ['nothing', undefined, undefined]
  ])("keep Mini's bounds from %s, or none", (_case, mini, kept) => {
    expect(readDeviceSettings({ window: { mini } }).window).toEqual(kept === undefined ? {} : { mini: kept })
  })

  it.each([
    ['the usual keys', undefined, 'CommandOrControl+Shift+M'],
    ['keys recorded', 'Alt+M', 'Alt+M'],
    ['none', '', ''],
    ['keys that are not a shortcut', 'Hyper+M', 'CommandOrControl+Shift+M']
  ])('keep the key of the mini window from %s', (_case, mini, kept) => {
    expect(readDeviceSettings({ shortcuts: { mini } }).shortcuts.mini).toBe(kept)
  })

  it('never share their objects with the defaults', () => {
    const read = readDeviceSettings({})
    read.voice.speed = 1.3
    expect(DEFAULT_DEVICE_SETTINGS.voice.speed).toBe(1)
  })
})

describe('a change of device settings', () => {
  it('touches only what it names', () => {
    const changed = changeDeviceSettings(DEFAULT_DEVICE_SETTINGS, { voice: { speed: 1.15 }, app: { launchAtLogin: true } })
    expect(changed.voice).toEqual({ aloud: true, speed: 1.15, styles: {} })
    expect(changed.app).toEqual({ ...DEFAULT_DEVICE_SETTINGS.app, launchAtLogin: true })
    expect(changed.shortcuts).toEqual(DEFAULT_DEVICE_SETTINGS.shortcuts)
  })

  it('cannot bring in a wrong value', () => {
    expect(changeDeviceSettings(DEFAULT_DEVICE_SETTINGS, { listening: { pause: 'eventually' as never } }).listening.pause).toBe('normal')
    expect(changeDeviceSettings(DEFAULT_DEVICE_SETTINGS, { voice: { styles: { ally: { english: 'm3' } } } }).voice.styles).toEqual({})
  })

  it('takes the voice styles picked whole, with a persona or a language new to them', () => {
    const before = changeDeviceSettings(DEFAULT_DEVICE_SETTINGS, { voice: { styles: { ally: { en: 'm3' } } } })
    const after = changeDeviceSettings(before, { voice: { styles: { ally: { en: 'm3', fr: 'm5' }, critic: { fr: 'm2' } } } })
    expect(after.voice.styles).toEqual({ ally: { en: 'm3', fr: 'm5' }, critic: { fr: 'm2' } })
    // A pick left out of the change is let go: the change is the whole of them.
    expect(changeDeviceSettings(after, { voice: { styles: { critic: { fr: 'm2' } } } }).voice.styles).toEqual({ critic: { fr: 'm2' } })
    // A change that does not name them keeps them.
    expect(changeDeviceSettings(after, { voice: { speed: 1.3 } }).voice.styles).toEqual(after.voice.styles)
  })

  it("takes Mini's bounds whole, and keeps them when it does not name them", () => {
    const placed = changeDeviceSettings(DEFAULT_DEVICE_SETTINGS, { window: { mini: { x: 900, y: 24, width: 280, height: 320 } } })
    expect(placed.window).toEqual({ mini: { x: 900, y: 24, width: 280, height: 320 } })
    // A size given with no place leaves none of the one before.
    expect(changeDeviceSettings(placed, { window: { mini: { width: 300, height: 340 } } }).window).toEqual({ mini: { width: 300, height: 340 } })
    expect(changeDeviceSettings(placed, { window: {} }).window).toEqual(placed.window)
    expect(changeDeviceSettings(placed, { window: { mini: { width: -1, height: 340 } } }).window).toEqual({})
  })
})

describe('pauses', () => {
  it('end a take after a short, a normal or a long silence, or never', () => {
    expect(pauseMs('short')).toBeLessThan(pauseMs('normal') ?? 0)
    expect(pauseMs('normal')).toBeLessThan(pauseMs('long') ?? 0)
    expect(pauseMs('never')).toBeUndefined()
  })
})

describe('a shortcut given to an action', () => {
  const shortcuts = DEFAULT_DEVICE_SETTINGS.shortcuts

  it('clashes with another action that has the same keys', () => {
    expect(shortcutClash(shortcuts, 'transcript', 'CommandOrControl+Space', false)).toBe('These keys are already used for talking in the window.')
    expect(shortcutClash(shortcuts, 'talk', 'Control+Shift+M', false)).toBe('These keys are already used for the mini window.')
    expect(shortcutClash(shortcuts, 'mini', 'CommandOrControl+T', false)).toBe('These keys are already used for the transcript.')
    expect(shortcutClash(shortcuts, 'talk', 'Control+T', false)).toBe('These keys are already used for the transcript.')
    expect(shortcutClash(shortcuts, 'stopEverything', 'CommandOrControl+Space', false)).toBe('These keys are already used for talking in the window.')
    expect(shortcutClash({ ...shortcuts, stopEverything: 'Alt+Escape' }, 'talk', 'Alt+Escape', false)).toBe(
      'These keys are already used for stopping everything.'
    )
  })

  it('may be the same for talking from any app and in the window, and may be none', () => {
    expect(shortcutClash(shortcuts, 'talk', 'CommandOrControl+Space', false)).toBeUndefined()
    expect(shortcutClash(shortcuts, 'transcript', '', false)).toBeUndefined()
    expect(shortcutClash(shortcuts, 'transcript', 'Alt+T', false)).toBeUndefined()
  })
})

describe('the shortcuts taken from the whole system', () => {
  it.each([
    ['talk', true],
    ['stopEverything', true],
    ['talkInWindow', false],
    ['transcript', false],
    ['mini', false]
  ] as const)('%s: %s', (name, global) => {
    expect(isGlobalShortcut(name)).toBe(global)
  })
})

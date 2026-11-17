import { describe, expect, it } from 'vitest'
import { changeDeviceSettings, DEFAULT_DEVICE_SETTINGS, pauseMs, readDeviceSettings, shortcutClash } from './settings.ts'

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
    expect(read.voice).toEqual({ aloud: true, speed: 1 })
    expect(read.shortcuts).toEqual({ talk: 'Alt+Space', talkInWindow: 'CommandOrControl+Space', transcript: '' })
    expect(read).not.toHaveProperty('unknown')
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
    expect(changed.voice).toEqual({ aloud: true, speed: 1.15 })
    expect(changed.app).toEqual({ ...DEFAULT_DEVICE_SETTINGS.app, launchAtLogin: true })
    expect(changed.shortcuts).toEqual(DEFAULT_DEVICE_SETTINGS.shortcuts)
  })

  it('cannot bring in a wrong value', () => {
    expect(changeDeviceSettings(DEFAULT_DEVICE_SETTINGS, { listening: { pause: 'eventually' as never } }).listening.pause).toBe('normal')
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
    expect(shortcutClash(shortcuts, 'talk', 'Control+T', false)).toBe('These keys are already used for the transcript.')
  })

  it('may be the same for talking from any app and in the window, and may be none', () => {
    expect(shortcutClash(shortcuts, 'talk', 'CommandOrControl+Space', false)).toBeUndefined()
    expect(shortcutClash(shortcuts, 'transcript', '', false)).toBeUndefined()
    expect(shortcutClash(shortcuts, 'transcript', 'Alt+T', false)).toBeUndefined()
  })
})

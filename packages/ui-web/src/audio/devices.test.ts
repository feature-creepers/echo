import { describe, expect, it } from 'vitest'
import { cleanLabel, devicesOf, resolveDevice, type SeenDevice } from './devices.ts'

const seen: SeenDevice[] = [
  { deviceId: 'default', kind: 'audioinput', label: 'Default - Desk Microphone (b58e:9e84)' },
  { deviceId: 'communications', kind: 'audioinput', label: 'Communications - Headset' },
  { deviceId: 'mic-a', kind: 'audioinput', label: 'Desk Microphone (b58e:9e84)' },
  { deviceId: 'mic-b', kind: 'audioinput', label: 'Headset' },
  { deviceId: 'out-a', kind: 'audiooutput', label: 'Speakers' }
]

describe('audio devices', () => {
  it('are named without what the system adds for itself', () => {
    expect(cleanLabel('Default - Desk Microphone (b58e:9e84)')).toBe('Desk Microphone')
    expect(cleanLabel('Headset')).toBe('Headset')
  })

  it('are listed once each, by kind, with the name of the one the system uses', () => {
    expect(devicesOf(seen, 'audioinput')).toEqual({
      system: 'Desk Microphone',
      devices: [
        { id: 'mic-a', label: 'Desk Microphone' },
        { id: 'mic-b', label: 'Headset' }
      ]
    })
    expect(devicesOf(seen, 'audiooutput')).toEqual({ system: 'Speakers', devices: [{ id: 'out-a', label: 'Speakers' }] })
    expect(devicesOf([], 'audioinput')).toEqual({ system: '', devices: [] })
  })
})

describe('the device chosen', () => {
  it('is found by its identifier', () => {
    expect(resolveDevice({ id: 'mic-b', label: 'Headset' }, seen, 'audioinput')).toBe('mic-b')
  })

  it('is found by its name when its identifier changed', () => {
    expect(resolveDevice({ id: 'old-id', label: 'Headset' }, seen, 'audioinput')).toBe('mic-b')
  })

  it('falls back to the system’s choice when it is gone, or when the system’s choice was chosen', () => {
    expect(resolveDevice({ id: 'gone', label: 'USB Microphone' }, seen, 'audioinput')).toBeUndefined()
    expect(resolveDevice({ id: '', label: '' }, seen, 'audioinput')).toBeUndefined()
    expect(resolveDevice({ id: 'default', label: '' }, seen, 'audioinput')).toBeUndefined()
  })

  it('is looked for among devices of its kind only', () => {
    expect(resolveDevice({ id: 'out-a', label: 'Speakers' }, seen, 'audioinput')).toBeUndefined()
  })
})

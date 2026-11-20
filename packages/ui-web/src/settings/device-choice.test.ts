import { describe, expect, it } from 'vitest'
import { deviceChoice } from './device-choice.ts'

const found = {
  system: 'Speakers (Realtek)',
  devices: [
    { id: 'a', label: 'Speakers (Realtek)' },
    { id: 'b', label: 'Headset' },
    { id: 'c', label: '' }
  ]
}

describe('a list of audio devices to pick from', () => {
  it.each([
    { name: 'the system default, when none is chosen', chosen: { id: '', label: '' }, value: '', missing: false },
    { name: 'the device chosen, by its identifier', chosen: { id: 'b', label: 'Headset' }, value: 'b', missing: false },
    { name: 'the device chosen, by its name when its identifier changed', chosen: { id: 'old', label: 'Headset' }, value: 'b', missing: false },
    { name: 'the device chosen, while it is not connected', chosen: { id: 'gone', label: 'Dock' }, value: 'gone', missing: true }
  ])('shows $name', ({ chosen, value, missing }) => {
    const choice = deviceChoice(found, chosen, 'Speakers')
    expect(choice.value).toBe(value)
    expect(choice.missing).toBe(missing)
  })

  it('lists the system default first, then each device, and the one missing last', () => {
    expect(deviceChoice(found, { id: 'gone', label: 'Dock' }, 'Speakers').options.map((option) => option.label)).toEqual([
      'System default · Speakers (Realtek)',
      'Speakers (Realtek)',
      'Headset',
      'Speakers',
      'Dock · not connected'
    ])
  })

  it('counts nothing as missing before the devices are known', () => {
    expect(deviceChoice(undefined, { id: 'b', label: 'Headset' }, 'Speakers')).toMatchObject({ missing: false, value: '' })
  })

  it('picks a device by its value, and the system default for any other', () => {
    const choice = deviceChoice(found, { id: '', label: '' }, 'Speakers')
    expect(choice.pick('b')).toEqual({ id: 'b', label: 'Headset' })
    expect(choice.pick('')).toEqual({ id: '', label: '' })
  })
})

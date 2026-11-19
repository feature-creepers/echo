import { describe, expect, it } from 'vitest'
import { checkDeviceRequest, type DeviceRequest } from './checks.ts'

describe('what a device checks itself before it does what its core asks', () => {
  it.each([
    { name: 'device.camera', remote: false, asks: false },
    { name: 'device.camera', remote: true, asks: true },
    { name: 'device.notify', remote: false, asks: false },
    { name: 'device.notify', remote: true, asks: false },
    { name: 'device.desktop', remote: true, asks: false }
  ] as const)('$name for a core that is remote: $remote, asks the person on the device: $asks', ({ name, remote, asks }) => {
    const check = checkDeviceRequest({ name } as DeviceRequest, { remote })
    expect(check.run).toBe(!asks)
  })

  it('asks for the camera in words of its own, and says why nothing was done when the person refuses', () => {
    const check = checkDeviceRequest({ name: 'device.camera' }, { remote: true })
    if (check.run) throw new Error('The camera should be asked.')
    expect(check.confirm.heading).toBe('Take a picture with your camera?')
    expect(check.confirm.detail).toContain('another computer')
    expect(check.confirm.refused).toContain('no picture was taken')
  })
})

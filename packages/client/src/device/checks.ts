/**
 * What a device checks itself before it does what its core asks (docs/SPEC.md, section 12.2). A core on the same
 * machine runs as the person's own account, so what it asks is done as asked. A remote core is another machine: the
 * device does not depend on it being right, and asks the person itself before it does anything that reaches into
 * their world, however the core says they answered. What only shows something, a notification or the frame around a
 * window held, needs no check.
 */

/** A request of the core to this device, by the event that carries it. */
export type DeviceRequest = { name: 'device.camera' } | { name: 'device.notify' } | { name: 'device.desktop' }

/** What the device asks the person itself, in its own words, before it goes on. */
export interface DeviceConfirmation {
  heading: string
  detail: string
  allow: string
  refuse: string
  /** Why nothing was done when the person did not allow it, for the core to say. */
  refused: string
}

export type DeviceCheck = { run: true } | { run: false; confirm: DeviceConfirmation }

/** How long the person has to answer the device's own question before it counts as a no, in milliseconds. */
export const CONFIRM_TIMEOUT_MS = 15_000

const CAMERA: DeviceConfirmation = {
  heading: 'Take a picture with your camera?',
  detail: 'The assistant runs on another computer and asked for a picture. This one asks you itself before its camera turns on.',
  allow: 'Take it',
  refuse: 'Don’t allow',
  refused: 'The person did not allow the camera on the device itself, so no picture was taken.'
}

/** Whether this device does what its core asks at once, or asks the person first. */
export function checkDeviceRequest(request: DeviceRequest, core: { remote: boolean }): DeviceCheck {
  switch (request.name) {
    case 'device.camera':
      return core.remote ? { run: false, confirm: CAMERA } : { run: true }
    case 'device.notify':
    case 'device.desktop':
      return { run: true }
  }
}

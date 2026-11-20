import type { AudioDevice } from '@repo/client'

/** The value of a list of devices that stands for the system's own choice. */
const SYSTEM = ''

/** A list of audio devices to pick from, the device chosen, and the device each value of the list stands for. */
interface DeviceChoice {
  /** The device chosen is not connected: the system default plays or listens until it is. */
  missing: boolean
  value: string
  options: { value: string; label: string }[]
  /** The device a value of the list stands for: none, for the system's own choice. */
  pick(value: string): AudioDevice
}

/**
 * The devices of a kind to pick from, the system's default first. The one chosen is found by its identifier, or by
 * its name when the identifier changed, the same rule as when it is opened; while it is not connected, it is listed
 * as such. `unnamed` names a device that gives no name of its own.
 */
export function deviceChoice(found: { system: string; devices: readonly AudioDevice[] } | undefined, chosen: AudioDevice, unnamed: string): DeviceChoice {
  const present =
    found?.devices.find((device) => device.id === chosen.id) ?? (chosen.label ? found?.devices.find((device) => device.label === chosen.label) : undefined)
  const missing = chosen.id !== '' && found !== undefined && present === undefined
  return {
    missing,
    value: present?.id ?? (missing ? chosen.id : SYSTEM),
    options: [
      { value: SYSTEM, label: found?.system ? `System default · ${found.system}` : 'System default' },
      ...(found?.devices ?? []).map((device) => ({ value: device.id, label: device.label || unnamed })),
      ...(missing ? [{ value: chosen.id, label: `${chosen.label || unnamed} · not connected` }] : [])
    ],
    pick(value) {
      const device = found?.devices.find((one) => one.id === value)
      return device ? { id: device.id, label: device.label } : { id: '', label: '' }
    }
  }
}

import { EventEmitter } from 'node:events'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { changeDeviceSettings, type DeviceSettings, type DeviceSettingsChange, readDeviceSettings } from '@repo/client'

/**
 * The settings of this device, kept in a file of the app's data folder (docs/SPEC.md, section 5.2): the
 * microphone, the shortcuts, how the app starts. They never reach the core: they belong to this computer.
 *
 * The main process owns them, since it needs some itself (shortcuts, start at login, the tray), and tells the
 * window of every change.
 */
export interface DeviceSettingsStore {
  read(): DeviceSettings
  change(change: DeviceSettingsChange): DeviceSettings
  /** Be told each time they change, with the settings before. Returns a function that stops the telling. */
  onChange(listener: (settings: DeviceSettings, before: DeviceSettings) => void): () => void
}

export function openDeviceSettings(file: string): DeviceSettingsStore {
  const events = new EventEmitter<{ change: [DeviceSettings, DeviceSettings] }>()
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    // First launch, or a file that cannot be read: the defaults, written on the first change.
  }
  let settings = readDeviceSettings(raw)

  const save = () => {
    // Written beside it, then moved over it, so that a crash never leaves half a file.
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(`${file}.tmp`, `${JSON.stringify(settings, null, 2)}\n`)
    renameSync(`${file}.tmp`, file)
  }

  return {
    read: () => settings,
    change(change) {
      const before = settings
      settings = changeDeviceSettings(settings, change)
      save()
      events.emit('change', settings, before)
      return settings
    },
    onChange(listener) {
      events.on('change', listener)
      return () => void events.off('change', listener)
    }
  }
}

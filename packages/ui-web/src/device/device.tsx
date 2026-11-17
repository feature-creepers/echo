import { changeDeviceSettings, DEFAULT_DEVICE_SETTINGS, type DeviceSettings, type DeviceSettingsChange, type KeyPress } from '@repo/client'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { DeviceHost } from './host.ts'

/** The settings of this device, as the interface reads and changes them. */
export interface Device {
  settings: DeviceSettings
  change(change: DeviceSettingsChange): void
  /** The Command key stands for Control, as on a Mac. */
  mac: boolean
  /** The app that keeps the settings. Left out, they last until the window closes. */
  host: DeviceHost | undefined
}

/** Whether the window runs on a Mac, where the Command key does what Control does elsewhere. */
export const ON_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent)

const DeviceContext = createContext<Device>({ settings: DEFAULT_DEVICE_SETTINGS, change: () => undefined, mac: ON_MAC, host: undefined })

/** The settings of this device, wherever the interface needs them. */
export function useDevice(): Device {
  return useContext(DeviceContext)
}

/** A key press as the shortcuts read it. */
export function keyPress(event: KeyboardEvent): KeyPress {
  return { code: event.code, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey }
}

/** Holds the settings of this device for everything inside: read from the app, and kept current as they change anywhere. */
export function DeviceProvider({ host, children }: { host: DeviceHost | undefined; children: ReactNode }) {
  const [settings, setSettings] = useState<DeviceSettings>(DEFAULT_DEVICE_SETTINGS)

  useEffect(() => {
    if (!host) return
    const stop = host.settings.onChange(setSettings)
    host.settings
      .read()
      .then(setSettings)
      .catch(() => undefined)
    return stop
  }, [host])

  const change = useCallback(
    (asked: DeviceSettingsChange) => {
      // Shown at once; the app's answer, which is what was kept, follows.
      setSettings((before) => changeDeviceSettings(before, asked))
      host?.settings
        .change(asked)
        .then(setSettings)
        .catch(() => undefined)
    },
    [host]
  )

  const device = useMemo(() => ({ settings, change, mac: ON_MAC, host }), [settings, change, host])
  return <DeviceContext.Provider value={device}>{children}</DeviceContext.Provider>
}

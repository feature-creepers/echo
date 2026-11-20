import { app } from 'electron'
import type { MiniSystem } from './system.ts'

/**
 * Whether the app runs as a Wayland client: Electron does in a Wayland session, unless it is told to use X11. Under
 * XWayland it is an X11 client, and Mini floats and is placed as under X11.
 */
function waylandClient(): boolean {
  const platform = app.commandLine.getSwitchValue('ozone-platform') || app.commandLine.getSwitchValue('ozone-platform-hint')
  if (platform === 'x11' || platform === 'wayland') return platform === 'wayland'
  return Boolean(process.env.WAYLAND_DISPLAY)
}

/**
 * Linux: Mini shows on every workspace. A Wayland client can neither keep its window on top nor read or set where it
 * is (Electron's `setAlwaysOnTop` and `getPosition`): there Mini is only the small size, placed where the desktop puts it.
 */
export const system: MiniSystem = {
  float(window, on) {
    window.setVisibleOnAllWorkspaces(on)
  },
  placed: () => !waylandClient()
}

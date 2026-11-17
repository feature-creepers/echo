import { app } from 'electron'
import { HIDDEN_FLAG } from './flag.ts'

/**
 * macOS keeps the list of login items itself. It passes no arguments to an app it starts at login, so the
 * app also asks whether it was (`startedAtLogin`) to start out of sight.
 */
export function setLaunchAtLogin(on: boolean): void {
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: on, args: [HIDDEN_FLAG] })
}

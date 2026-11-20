import { app } from 'electron'
import { setLaunchAtLogin as darwin } from './darwin.ts'
import { HIDDEN_FLAG } from './flag.ts'
import { setLaunchAtLogin as linux } from './linux.ts'
import { setLaunchAtLogin as win32 } from './win32.ts'

/**
 * Start the app when the user signs in to the computer, or stop doing so. It then starts in the background
 * (`--hidden`), ready for its shortcut. Only an installed app registers: a build run from the sources would
 * register the development copy of Electron.
 */
export const setLaunchAtLogin: (on: boolean) => void = process.platform === 'darwin' ? darwin : process.platform === 'win32' ? win32 : linux

/** Whether the system started the app at the user's login, when it should open out of sight. */
export function startedAtLogin(): boolean {
  if (process.argv.includes(HIDDEN_FLAG)) return true
  return process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin === true
}

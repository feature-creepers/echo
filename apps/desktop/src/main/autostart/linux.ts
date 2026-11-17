import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { HIDDEN_FLAG } from './flag.ts'

/**
 * Linux desktops start what the autostart folder lists (freedesktop.org's Desktop Application Autostart
 * specification); Electron's login items do nothing there. An AppImage is started through its own file,
 * which stays put, rather than through the folder it unpacks to, which changes at each launch.
 */
export function setLaunchAtLogin(on: boolean): void {
  if (!app.isPackaged) return
  const folder = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'autostart')
  const file = join(folder, `${app.getName().toLowerCase()}.desktop`)
  if (!on) {
    rmSync(file, { force: true })
    return
  }
  const program = process.env.APPIMAGE || process.execPath
  mkdirSync(folder, { recursive: true })
  writeFileSync(
    file,
    [
      '[Desktop Entry]',
      'Type=Application',
      `Name=${app.getName()}`,
      `Exec="${program}" ${HIDDEN_FLAG}`,
      'Terminal=false',
      'X-GNOME-Autostart-enabled=true',
      ''
    ].join('\n')
  )
}

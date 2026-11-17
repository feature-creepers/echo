import { app } from 'electron'
import { HIDDEN_FLAG } from './flag.ts'

/** Windows starts what the Run key of the user's registry names: Electron writes it. */
export function setLaunchAtLogin(on: boolean): void {
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: on, args: [HIDDEN_FLAG] })
}

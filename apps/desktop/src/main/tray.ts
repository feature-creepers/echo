import { describeShortcut } from '@repo/client'
import { type AccentName, accents, color, neutralAccent } from '@repo/tokens'
import { app, Menu, type MenuItemConstructorOptions, nativeImage, Tray } from 'electron'
import { type Rgba, rgba, trayMark } from './mark.ts'

/** What the tray's menu does. */
export interface TrayActions {
  show(): void
  talk(): void
  settings(): void
  quit(): void
  /** Restart into the downloaded version, when there is one. */
  restartToUpdate?: (() => void) | undefined
}

/** What the tray's mark shows: the accent of the persona that answers, and whether it listens or sleeps. */
export interface TrayLook {
  /** Left out before a persona is chosen: the neutral accent. */
  accent: AccentName | undefined
  state: 'awake' | 'listening' | 'asleep'
}

export interface TrayMenu {
  /** Show the menu again with what changed: the talk shortcut, an update ready. */
  refresh(talkShortcut: string, actions: TrayActions): void
  /** Show the assistant as it is now. */
  look(look: TrayLook): void
  destroy(): void
}

/**
 * The mark at the sizes this system's tray uses, in the persona's accent: its core in the accent, the ring
 * lit with it too while the assistant listens, both dimmed while it sleeps. macOS tints a black template
 * itself, which is how its menu bar icons look, except while listening, when the mark shows its colour as
 * the system's own microphone light does. Linux trays are usually 24 pixels.
 */
function icon({ accent, state }: TrayLook): Electron.NativeImage {
  const lit = accent ? accents[accent].solid : neutralAccent.solid
  const dim = state === 'asleep'
  const template = process.platform === 'darwin' && state !== 'listening'
  const ring: Rgba = template ? [0, 0, 0, dim ? 150 : 255] : state === 'listening' ? rgba(lit) : rgba(color.text, dim ? 120 : 230)
  const core: Rgba = template ? [0, 0, 0, dim ? 90 : 255] : rgba(lit, dim ? 110 : 255)
  if (process.platform === 'linux') return nativeImage.createFromBuffer(trayMark(24, ring, core))
  const image = nativeImage.createFromBuffer(trayMark(16, ring, core), { scaleFactor: 1 })
  image.addRepresentation({ scaleFactor: 2, buffer: trayMark(32, ring, core) })
  if (template) image.setTemplateImage(true)
  return image
}

/**
 * The app in the system tray (the menu bar on macOS), where it waits for its shortcut while the window is
 * closed. A click shows the window; the menu talks, opens the settings, restarts for an update, or quits.
 */
export function createTray(talkShortcut: string, actions: TrayActions): TrayMenu {
  let shown: TrayLook = { accent: undefined, state: 'awake' }
  const tray = new Tray(icon(shown))
  tray.setToolTip(app.getName())
  const mac = process.platform === 'darwin'
  let current = actions

  const menu = (shortcut: string, doing: TrayActions) => {
    const items: MenuItemConstructorOptions[] = [
      { label: `Show ${app.getName()}`, click: () => doing.show() },
      { label: shortcut ? `Talk    ${describeShortcut(shortcut, mac)}` : 'Talk', click: () => doing.talk() },
      { label: 'Settings…', click: () => doing.settings() },
      { type: 'separator' }
    ]
    if (doing.restartToUpdate) items.push({ label: 'Restart to update', click: () => doing.restartToUpdate?.() }, { type: 'separator' })
    items.push({ label: `Quit ${app.getName()}`, click: () => doing.quit() })
    return Menu.buildFromTemplate(items)
  }

  tray.setContextMenu(menu(talkShortcut, actions))
  // On Windows a click on the icon shows the window, and the menu is on the right button. On macOS and most
  // Linux desktops a click opens the menu.
  tray.on('click', () => {
    if (process.platform === 'win32') current.show()
  })

  return {
    refresh(shortcut, next) {
      current = next
      tray.setContextMenu(menu(shortcut, next))
    },
    look(next) {
      if (next.accent === shown.accent && next.state === shown.state) return
      shown = next
      tray.setImage(icon(next))
    },
    destroy: () => tray.destroy()
  }
}

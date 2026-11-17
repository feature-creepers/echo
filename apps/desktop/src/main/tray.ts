import { describeShortcut } from '@repo/client'
import { accents, color } from '@repo/tokens'
import { app, Menu, type MenuItemConstructorOptions, nativeImage, Tray } from 'electron'
import { type Rgba, trayIcon } from './tray-icon.ts'

/** What the tray's menu does. */
export interface TrayActions {
  show(): void
  talk(): void
  settings(): void
  quit(): void
  /** Restart into the downloaded version, when there is one. */
  restartToUpdate?: (() => void) | undefined
}

export interface TrayMenu {
  /** Show the menu again with what changed: the talk shortcut, an update ready. */
  refresh(talkShortcut: string, actions: TrayActions): void
  destroy(): void
}

const rgba = (hex: string, alpha = 255): Rgba => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
  alpha
]

/** The mark at the sizes this system's tray uses: macOS tints a black template itself; Linux trays are usually 24 pixels. */
function icon(): Electron.NativeImage {
  if (process.platform === 'darwin') {
    const black: Rgba = [0, 0, 0, 255]
    const image = nativeImage.createFromBuffer(trayIcon(16, black, black), { scaleFactor: 1 })
    image.addRepresentation({ scaleFactor: 2, buffer: trayIcon(32, black, black) })
    image.setTemplateImage(true)
    return image
  }
  const ring = rgba(color.text, 230)
  const core = rgba(accents.cyan.solid)
  if (process.platform === 'linux') return nativeImage.createFromBuffer(trayIcon(24, ring, core))
  const image = nativeImage.createFromBuffer(trayIcon(16, ring, core), { scaleFactor: 1 })
  image.addRepresentation({ scaleFactor: 2, buffer: trayIcon(32, ring, core) })
  return image
}

/**
 * The app in the system tray (the menu bar on macOS), where it waits for its shortcut while the window is
 * closed. A click shows the window; the menu talks, opens the settings, restarts for an update, or quits.
 */
export function createTray(talkShortcut: string, actions: TrayActions): TrayMenu {
  const tray = new Tray(icon())
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
    destroy: () => tray.destroy()
  }
}

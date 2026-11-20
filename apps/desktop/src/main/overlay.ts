import { BrowserWindow, type Rectangle } from 'electron'

/**
 * A window above every other, on every workspace, that lets every click through and never takes the focus: a marker
 * that says on the screen what the assistant is doing. Its page runs no script.
 */
export function overlayWindow(bounds: Rectangle): BrowserWindow {
  const overlay = new BrowserWindow({
    ...bounds,
    transparent: true,
    frame: false,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, javascript: false }
  })
  overlay.setIgnoreMouseEvents(true)
  overlay.setAlwaysOnTop(true, 'screen-saver')
  overlay.setVisibleOnAllWorkspaces(true)
  return overlay
}

/** The address of an overlay's page, drawn by its own style: nothing is loaded from anywhere. */
export const overlayPage = (style: string, body: string) =>
  `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body>${body}</body></html>`)}`

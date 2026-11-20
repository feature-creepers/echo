import type { BrowserWindow, Rectangle } from 'electron'
import type { MiniSystem } from './system.ts'

/**
 * Give a window bounds exactly. At a scale such as 125 %, Windows applies them a pixel or two off (`setBounds` with a
 * window's own bounds makes it 2 px taller), so each visit to Mini would grow the full window. Windows applies them at
 * once, so what it did is read back and made good, once.
 */
export function placeExactly(window: Pick<BrowserWindow, 'setBounds' | 'getBounds'>, bounds: Rectangle): void {
  window.setBounds(bounds)
  const now = window.getBounds()
  const off = { x: now.x - bounds.x, y: now.y - bounds.y, width: now.width - bounds.width, height: now.height - bounds.height }
  if (off.x || off.y || off.width || off.height) {
    window.setBounds({ x: bounds.x - off.x, y: bounds.y - off.y, width: bounds.width - off.width, height: bounds.height - off.height })
  }
}

/**
 * Windows: Mini floats as it is. The system's buttons stay over its top right, as on the full window: Electron gives no
 * way to hide them once the window exists.
 */
export const system: MiniSystem = {
  float: () => undefined,
  placed: () => true,
  place: placeExactly
}

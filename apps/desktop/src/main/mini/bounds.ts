import type { MiniBounds } from '@repo/client'
import type { Rectangle } from 'electron'

/** Mini's sizes, in pixels: the first time, and the smallest and the largest it may be made. */
export const MINI_SIZE = {
  first: { width: 280, height: 320 },
  least: { width: 240, height: 260 },
  most: { width: 480, height: 560 }
} as const

/** How far Mini opens from the edges of the screen the first time, in pixels. */
const MARGIN = 24

const within = (value: number, least: number, most: number) => Math.round(Math.min(most, Math.max(least, value)))

const holds = (area: Rectangle, x: number, y: number) => x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height

/**
 * Where Mini opens, and how large (docs/SPEC.md, section 13.2): where it was kept, at its size brought within Mini's,
 * when its middle is on the work area of one of the screens; else at the top right of `home`, the work area of the
 * screen the window is on, 24 pixels from its edges, as the first time. A place kept on a screen since unplugged, or
 * no place kept, opens there too.
 */
export function miniBounds(kept: MiniBounds | undefined, areas: readonly Rectangle[], home: Rectangle): Rectangle {
  const width = within(kept?.width ?? MINI_SIZE.first.width, MINI_SIZE.least.width, MINI_SIZE.most.width)
  const height = within(kept?.height ?? MINI_SIZE.first.height, MINI_SIZE.least.height, MINI_SIZE.most.height)
  if (kept?.x !== undefined && kept.y !== undefined) {
    const { x, y } = kept
    if (areas.some((area) => holds(area, x + width / 2, y + height / 2))) return { x, y, width, height }
  }
  return { x: home.x + home.width - width - MARGIN, y: home.y + MARGIN, width, height }
}

import type { MiniBounds } from '@repo/client'
import type { Rectangle } from 'electron'
import { describe, expect, it } from 'vitest'
import { MINI_SIZE, miniBounds } from './bounds.ts'

/** A screen's work area, the taskbar under it. */
const MAIN = { x: 0, y: 0, width: 1920, height: 1040 }
/** A second screen, to the left of the first. */
const LEFT = { x: -1280, y: 0, width: 1280, height: 984 }
/** A screen with the menu bar over its work area, as on a Mac. */
const UNDER_BAR = { x: 0, y: 25, width: 1512, height: 920 }

describe("Mini's bounds", () => {
  it.each<[string, MiniBounds | undefined, Rectangle[], Rectangle, Rectangle]>([
    ['the first time: the top right of the screen the window is on', undefined, [MAIN], MAIN, { x: 1616, y: 24, width: 280, height: 320 }],
    ['the first time, under a bar at the top of the screen', undefined, [UNDER_BAR], UNDER_BAR, { x: 1208, y: 49, width: 280, height: 320 }],
    ['the first time, the window on a second screen', undefined, [MAIN, LEFT], LEFT, { x: -304, y: 24, width: 280, height: 320 }],
    ['kept on the screen', { x: 100, y: 200, width: 300, height: 340 }, [MAIN], MAIN, { x: 100, y: 200, width: 300, height: 340 }],
    [
      'kept on another screen than the window is on',
      { x: -900, y: 300, width: 280, height: 320 },
      [MAIN, LEFT],
      MAIN,
      { x: -900, y: 300, width: 280, height: 320 }
    ],
    [
      'kept half off a screen, its middle still on it',
      { x: 1700, y: 100, width: 280, height: 320 },
      [MAIN],
      MAIN,
      { x: 1700, y: 100, width: 280, height: 320 }
    ],
    [
      'kept on a screen since unplugged: the top right, at its size',
      { x: -900, y: 300, width: 300, height: 340 },
      [MAIN],
      MAIN,
      { x: 1596, y: 24, width: 300, height: 340 }
    ],
    ['kept with its middle off every screen', { x: 1800, y: 100, width: 280, height: 320 }, [MAIN], MAIN, { x: 1616, y: 24, width: 280, height: 320 }],
    ['kept smaller than Mini may be', { x: 100, y: 100, width: 100, height: 50 }, [MAIN], MAIN, { x: 100, y: 100, ...MINI_SIZE.least }],
    ['kept larger than Mini may be', { x: 100, y: 100, width: 2000, height: 2000 }, [MAIN], MAIN, { x: 100, y: 100, ...MINI_SIZE.most }],
    ['kept as a size with no place, where the system does not tell it', { width: 300, height: 340 }, [MAIN], MAIN, { x: 1596, y: 24, width: 300, height: 340 }]
  ])('%s', (_case, kept, areas, home, bounds) => {
    expect(miniBounds(kept, areas, home)).toEqual(bounds)
  })
})

import type { Rectangle } from 'electron'
import { describe, expect, it } from 'vitest'
import { placeExactly } from './win32.ts'

/** A window that applies bounds as Windows does at some scales: off by a fixed amount. */
function drifting(off: Partial<Rectangle>) {
  let bounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 }
  return {
    setBounds(next: Rectangle) {
      bounds = { x: next.x + (off.x ?? 0), y: next.y + (off.y ?? 0), width: next.width + (off.width ?? 0), height: next.height + (off.height ?? 0) }
    },
    getBounds: () => bounds
  }
}

describe('placing a window exactly on Windows', () => {
  it.each<[string, Partial<Rectangle>]>([
    ['as asked', {}],
    ['2 px taller', { height: 2 }],
    ['a pixel off each way', { x: -1, y: 1, width: 1, height: -1 }]
  ])('gives the bounds asked when the system applies them %s', (_name, off) => {
    const window = drifting(off)
    const asked = { x: 363, y: 121, width: 1322, height: 863 }
    for (let round = 0; round < 3; round++) {
      placeExactly(window, asked)
      expect(window.getBounds()).toEqual(asked)
    }
  })
})

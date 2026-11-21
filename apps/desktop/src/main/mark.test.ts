import { accents, color } from '@repo/tokens'
import { describe, expect, it } from 'vitest'
import { appIconPixels, ICON, rgba } from './mark.ts'

/** The colour of one pixel of a picture, without its opacity. */
const at = (pixels: Buffer, size: number, x: number, y: number) => [...pixels.subarray((y * size + x) * 4, (y * size + x) * 4 + 3)]
const opacity = (pixels: Buffer, size: number, x: number, y: number) => pixels[(y * size + x) * 4 + 3]
const rgb = (hex: string) => rgba(hex).slice(0, 3)

describe("the app's icon", () => {
  it('is drawn in the design values: the side panel’s black, the ink and the red-orange accent', () => {
    expect(ICON).toMatchObject({ ground: color.panel, ink: color.text, accent: accents.red.solid })
  })

  it.each([16, 32, 48, 256])('at %i pixels shows the hand up and to the right of the centre', (size) => {
    const step = Math.max(1, Math.round(size * 0.06))
    expect(at(appIconPixels(size), size, size / 2 + step, size / 2 - step - 1)).toEqual(rgb(ICON.accent))
  })

  it.each([32, 48, 256])('at %i pixels shows the pupil where the hand does not cover it, down and to the left of the centre', (size) => {
    expect(at(appIconPixels(size), size, size / 2 - 1, size / 2)).toEqual(rgb(ICON.ink))
  })

  it('fills the picture with its tile, and keeps the margin macOS icons keep', () => {
    expect(at(appIconPixels(64), 64, 3, 3)).toEqual(rgb(ICON.ground))
    expect(opacity(appIconPixels(64), 64, 3, 3)).toBe(255)
    expect(opacity(appIconPixels(64, true), 64, 3, 3)).toBe(0)
    expect(at(appIconPixels(64, true), 64, 10, 10)).toEqual(rgb(ICON.ground))
  })
})

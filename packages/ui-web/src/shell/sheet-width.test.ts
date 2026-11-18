import { describe, expect, it } from 'vitest'
import { clampSheetWidth, SHEET_STEP, sheetBounds, sheetWidthByKey } from './sheet-width.ts'

describe('the widths the side sheet may take', () => {
  it.each([
    // window, room kept beside it, narrowest, widest
    [1900, 0, 320, 960],
    [1320, 0, 320, 792],
    [720, 0, 320, 432],
    [500, 0, 320, 320],
    [1320, 736, 320, 584],
    [1000, 736, 320, 320]
  ])('in a window %i wide keeping %i: %i to %i', (window, keep, min, max) => {
    expect(sheetBounds(window, keep)).toEqual({ min, max })
  })
})

describe('a width kept within bounds', () => {
  const bounds = { min: 320, max: 800 }
  it.each([
    [500, 500],
    [500.6, 501],
    [100, 320],
    [1200, 800]
  ])('%d becomes %d', (width, kept) => {
    expect(clampSheetWidth(width, bounds)).toBe(kept)
  })
})

describe('the keys of the sheet’s handle', () => {
  const bounds = { min: 320, max: 800 }
  it.each([
    ['ArrowLeft', 500, 500 + SHEET_STEP],
    ['ArrowRight', 500, 500 - SHEET_STEP],
    ['ArrowLeft', 795, 800],
    ['ArrowRight', 325, 320],
    ['Home', 500, 320],
    ['End', 500, 800],
    ['ArrowUp', 500, undefined],
    ['Enter', 500, undefined]
  ])('%s from %d gives %s', (key, width, wanted) => {
    expect(sheetWidthByKey(key, width, bounds)).toBe(wanted)
  })
})

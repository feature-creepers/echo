import { SHEET_WIDTH } from '@repo/client'

/** How far an arrow key moves the sheet's edge, in pixels. */
export const SHEET_STEP = 16

/** The largest share of the window the sheet may take. */
const SHARE = 0.6

/** The widths the sheet may take in a window, in pixels. */
export interface SheetBounds {
  min: number
  max: number
}

/**
 * The widths the sheet may take in a window this wide: from its narrowest to the smaller of 60 % of the window
 * and its widest. `keep` is the room the screen under it keeps for itself beside it, for a screen that makes
 * room for the sheet rather than lying under it. A window too narrow for even the narrowest sheet gets that one.
 */
export function sheetBounds(windowWidth: number, keep = 0): SheetBounds {
  const max = Math.min(SHEET_WIDTH.most, Math.floor(windowWidth * SHARE), Math.floor(windowWidth - keep))
  return { min: SHEET_WIDTH.least, max: Math.max(SHEET_WIDTH.least, max) }
}

/** A width the sheet may take, as a whole number of pixels. */
export function clampSheetWidth(width: number, bounds: SheetBounds): number {
  return Math.round(Math.min(bounds.max, Math.max(bounds.min, width)))
}

/**
 * The width a key gives the sheet from its handle, which is its left edge: Left moves the edge left and widens
 * it, Right narrows it, Home and End give the narrowest and the widest. Nothing for any other key.
 */
export function sheetWidthByKey(key: string, width: number, bounds: SheetBounds): number | undefined {
  switch (key) {
    case 'ArrowLeft':
      return clampSheetWidth(width + SHEET_STEP, bounds)
    case 'ArrowRight':
      return clampSheetWidth(width - SHEET_STEP, bounds)
    case 'Home':
      return bounds.min
    case 'End':
      return bounds.max
    default:
      return undefined
  }
}

/**
 * The width the sheet is drawn at, written for CSS from the width the user chose: it follows the window as it is
 * resized without anything else being drawn again, and comes back to the chosen width once there is room. The
 * element that uses it carries the chosen width itself, as `sheetWidthStyle` writes it.
 */
export const SHEET_CSS_WIDTH = `clamp(${SHEET_WIDTH.least}px, var(--sheet-width), min(${SHARE * 100}vw, ${SHEET_WIDTH.most}px))`

/** The chosen width, as the style of an element that reads it. */
export const sheetWidthStyle = (width: number): Record<'--sheet-width', string> => ({ '--sheet-width': `${width}px` })

/**
 * Show a width while the sheet's edge is dragged, written straight to the elements that read it inside `within`,
 * which carry a `data-sheet-width` attribute: React draws nothing again, and nothing else is restyled.
 */
export function previewSheetWidth(within: HTMLElement | null, width: number): void {
  for (const element of within?.querySelectorAll<HTMLElement>('[data-sheet-width]') ?? []) element.style.setProperty('--sheet-width', `${width}px`)
}

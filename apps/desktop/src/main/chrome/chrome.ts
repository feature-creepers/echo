import type { BrowserWindowConstructorOptions } from 'electron'

/** How the title row looks, so the buttons the system draws over it match. */
export interface TitleRow {
  /** The colour of the buttons' symbols. */
  symbols: string
  /** The height of the row, in pixels. */
  height: number
}

/**
 * The window options that give a window the system's own frame, corners, shadow and buttons, with no title
 * bar above the page: the page draws the title row, and the system draws its buttons over it. The page's ground is
 * one flat colour, so no material of the system is asked for behind it.
 */
export type Chrome = (row: TitleRow) => Partial<BrowserWindowConstructorOptions>

/** No colour at all: what the page shows through where the system draws its buttons. */
export const CLEAR = '#00000000'

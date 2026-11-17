import type { BrowserWindowConstructorOptions } from 'electron'

/** How the title row looks, so the buttons the system draws over it match. */
export interface TitleRow {
  /** The colour of the buttons' symbols. */
  symbols: string
  /** The height of the row, in pixels. */
  height: number
}

/** A window's frame, and whether the system draws a translucent material behind the page. */
export interface WindowChrome {
  options: Partial<BrowserWindowConstructorOptions>
  /**
   * The system blurs what is behind the window under the page (macOS vibrancy, Windows 11 Mica). The page then
   * leaves its ground transparent and only tints it, as native apps do.
   */
  vibrant: boolean
}

/**
 * The window options that give a window the system's own frame, corners, shadow and buttons, with no title
 * bar above the page: the page draws the title row, and the system draws its buttons over it.
 */
export type Chrome = (row: TitleRow) => WindowChrome

/** No colour at all: what the page shows through where the system draws a material, or its buttons. */
export const CLEAR = '#00000000'

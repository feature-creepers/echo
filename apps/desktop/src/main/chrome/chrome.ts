import type { BrowserWindowConstructorOptions } from 'electron'

/** How the title row looks, so the buttons the system draws over it match. */
export interface TitleRow {
  /** The colour behind the system's buttons. */
  background: string
  /** The colour of the buttons themselves. */
  symbols: string
  /** The height of the row, in pixels. */
  height: number
}

/**
 * The window options that give a window the system's own frame, corners, shadow and buttons, with no title
 * bar above the page: the page draws the title row, and the system draws its buttons over it.
 */
export type Chrome = (row: TitleRow) => Partial<BrowserWindowConstructorOptions>

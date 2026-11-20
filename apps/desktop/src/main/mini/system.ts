import type { BrowserWindow } from 'electron'

/** What Mini asks of this system beyond its size and staying on top, and what the system does not let it have. */
export interface MiniSystem {
  /** Keep the window over others in this system's own ways while it is Mini, or stop. */
  float(window: BrowserWindow, on: boolean): void
  /** Whether the app may read and set where its window is. A Wayland client may not: the desktop places it. */
  placed(): boolean
}

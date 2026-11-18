import { darwin } from './darwin.ts'
import { linux } from './linux.ts'
import type { ScreenSystem } from './system.ts'
import { win32 } from './win32.ts'

export type { Helper, Questions, RawElement, RawWindow, ScreenSystem } from './system.ts'

/** How this system's other apps are read and operated. */
export const system: ScreenSystem = process.platform === 'win32' ? win32 : process.platform === 'darwin' ? darwin : linux

/** Each system's, for tests that check them all on any machine. */
export const systems = { win32, darwin, linux }

import { THIS_SYSTEM } from '../system-name.ts'
import { darwin } from './darwin.ts'
import { linux } from './linux.ts'
import type { ScreenSystem } from './system.ts'
import { win32 } from './win32.ts'

/** Each system's, for tests that check them all on any machine. */
export const systems = { win32, darwin, linux }

/** How this system's other apps are read and operated. */
export const system: ScreenSystem = systems[THIS_SYSTEM]

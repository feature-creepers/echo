import { darwin } from './darwin.ts'
import { linux } from './linux.ts'
import type { ComputerSystem } from './system.ts'
import { win32 } from './win32.ts'

export { everywhere } from './everywhere.ts'
export type { ComputerSystem, Where } from './system.ts'

/** What differs on this system about reaching the computer: the places never reached, and how its shell writes a path. */
export const system: ComputerSystem = process.platform === 'win32' ? win32 : process.platform === 'darwin' ? darwin : linux

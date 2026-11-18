import { freeMemory as darwin } from './darwin.ts'
import { freeMemory as linux } from './linux.ts'
import { freeMemory as win32 } from './win32.ts'

/**
 * The memory still to be had on this computer, in bytes, as this system counts it; nothing where the system's count
 * does not say it.
 */
export const freeMemory: () => number | undefined = process.platform === 'darwin' ? darwin : process.platform === 'win32' ? win32 : linux

import type { Platform } from './platform.ts'
import { unix } from './unix.ts'
import { win32 } from './win32.ts'

/** How programs are found and started on this system. macOS and Linux behave the same and share a file. */
export const platform: Platform = process.platform === 'win32' ? win32 : unix

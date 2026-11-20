import type { Chrome } from './chrome.ts'
import { chrome as darwin } from './darwin.ts'
import { chrome as linux } from './linux.ts'
import { chrome as win32 } from './win32.ts'

/** The window chrome of this system. */
export const chrome: Chrome = process.platform === 'darwin' ? darwin : process.platform === 'win32' ? win32 : linux

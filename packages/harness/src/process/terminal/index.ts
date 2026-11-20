import { openTerminal as darwin } from './darwin.ts'
import { openTerminal as linux } from './linux.ts'
import type { OpenTerminal } from './terminal.ts'
import { openTerminal as win32 } from './win32.ts'

/** Opens a terminal window the way this system does. */
export const openTerminal: OpenTerminal = process.platform === 'win32' ? win32 : process.platform === 'darwin' ? darwin : linux

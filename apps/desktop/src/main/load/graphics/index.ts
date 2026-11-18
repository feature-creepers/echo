import { startGraphics as darwin } from './darwin.ts'
import type { Graphics } from './graphics.ts'
import { startGraphics as linux } from './linux.ts'
import { startGraphics as win32 } from './win32.ts'

export type { Graphics } from './graphics.ts'

/** Start reading the graphics card's use the way this system reports it. */
export const startGraphics: () => Graphics = process.platform === 'darwin' ? darwin : process.platform === 'win32' ? win32 : linux

import type { Environment } from '../../process/environment.ts'
import { installLocations as darwin } from './darwin.ts'
import { installLocations as linux } from './linux.ts'
import { installLocations as win32 } from './win32.ts'

/** Where Claude Code is usually installed on this system, when it is not on the search path. */
export const installLocations: (home: string, env: Environment) => string[] =
  process.platform === 'win32' ? win32 : process.platform === 'darwin' ? darwin : linux

import { keyringProblem as darwin } from './darwin.ts'
import { keyringProblem as linux } from './linux.ts'
import { keyringProblem as win32 } from './win32.ts'

/**
 * Why the system's store would keep sign-ins no safer than a file, though Electron can seal with it, in words for the
 * person; nothing when it keeps them safe.
 */
export const keyringProblem: () => string | undefined = process.platform === 'darwin' ? darwin : process.platform === 'win32' ? win32 : linux

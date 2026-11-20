import type { CodexSandbox } from './system.ts'
import { unix } from './unix.ts'
import { win32 } from './win32.ts'

export { PROFILE } from './system.ts'

/** How Codex's sandbox holds commands on this system. */
export const sandbox: CodexSandbox = process.platform === 'win32' ? win32 : unix

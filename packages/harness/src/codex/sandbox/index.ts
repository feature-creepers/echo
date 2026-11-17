import { SANDBOX_SETTINGS as unix } from './unix.ts'
import { SANDBOX_SETTINGS as win32 } from './win32.ts'

/** The settings Codex's sandbox needs on this system, as command-line arguments. */
export const SANDBOX_SETTINGS: string[] = process.platform === 'win32' ? win32 : unix

import { homedir } from 'node:os'
import { candidates as darwin, MISSING as darwinMissing } from './darwin.ts'
import type { Candidate } from './find.ts'
import { candidates as linux, MISSING as linuxMissing } from './linux.ts'
import { candidates as win32, MISSING as win32Missing } from './win32.ts'

/** Where the browsers are on this system, in order of preference, and what to say when none is. */
export function systemBrowsers(env: Record<string, string | undefined> = process.env): { candidates: Candidate[]; missing: string } {
  const home = homedir()
  if (process.platform === 'win32') return { candidates: win32(home, env), missing: win32Missing }
  if (process.platform === 'darwin') return { candidates: darwin(home), missing: darwinMissing }
  return { candidates: linux(), missing: linuxMissing }
}

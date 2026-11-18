import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { basename } from 'node:path'
import type { BrowserFound } from '@repo/core'

/** A browser that may be installed, and where. */
export interface Candidate {
  /** Its name, as the person knows it: "Microsoft Edge". */
  name: string
  path: string
}

/** The environment variable that names a browser to use in place of the system's, for development. */
export const BROWSER_VARIABLE = 'ASSISTANT_BROWSER'

/**
 * The environment variable that turns the browser's sandbox off when set to `off`, for development on a Linux
 * that refuses a downloaded browser the means to sandbox itself (Ubuntu 23.10 and later). Never for real use.
 */
export const SANDBOX_VARIABLE = 'ASSISTANT_BROWSER_SANDBOX'

/** A browser's name, guessed from where it is: for one named by its path rather than found. */
export function nameOf(path: string): string {
  if (/edge/i.test(path)) return 'Microsoft Edge'
  if (/chromium/i.test(path)) return 'Chromium'
  if (/chrome/i.test(path)) return 'Google Chrome'
  return basename(path)
}

/** Whether a program is at this path: a file that may be run. Windows checks only that it is there. */
async function isProgram(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export interface FindOptions {
  /** Where to look, in order of preference. */
  candidates: readonly Candidate[]
  /** A path to use instead, from `ASSISTANT_BROWSER`. It must be there. */
  override?: string | undefined
  /** Said when none is there: which browsers are needed on this system. */
  missing: string
  /** Whether a program is at a path. Left out, the disk is asked. */
  exists?: (path: string) => Promise<boolean>
}

/** The first browser of the candidates that is installed, or the one the override names. */
export async function findBrowser({ candidates, override, missing, exists = isProgram }: FindOptions): Promise<BrowserFound> {
  if (override) {
    return (await exists(override))
      ? { found: true, name: nameOf(override), path: override }
      : { found: false, problem: `There is no browser at ${override}, which ${BROWSER_VARIABLE} names.` }
  }
  for (const candidate of candidates) {
    if (await exists(candidate.path)) return { found: true, ...candidate }
  }
  return { found: false, problem: missing }
}

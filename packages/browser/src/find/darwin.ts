import { posix as path } from 'node:path'
import type { Candidate } from './find.ts'

export const MISSING = 'Google Chrome, Microsoft Edge or Chromium is needed, and none was found on this Mac.'

/** Where the browsers are on macOS: Google Chrome, then Microsoft Edge, then Chromium, in the system's Applications folder or the person's own. */
export function candidates(home: string): Candidate[] {
  const apps = [
    { name: 'Google Chrome', bundle: 'Google Chrome.app', program: 'Google Chrome' },
    { name: 'Microsoft Edge', bundle: 'Microsoft Edge.app', program: 'Microsoft Edge' },
    { name: 'Chromium', bundle: 'Chromium.app', program: 'Chromium' }
  ]
  return apps.flatMap(({ name, bundle, program }) =>
    ['/Applications', path.join(home, 'Applications')].map((folder) => ({ name, path: path.join(folder, bundle, 'Contents', 'MacOS', program) }))
  )
}

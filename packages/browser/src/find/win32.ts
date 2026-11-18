import { win32 as path } from 'node:path'
import type { Candidate } from './find.ts'

/** Said when Windows has neither. Edge comes with Windows, so it was removed or moved. */
export const MISSING = 'Neither Microsoft Edge nor Google Chrome was found on this computer.'

/**
 * Where the browsers are on Windows: Microsoft Edge, which every Windows has, then Google Chrome, each installed
 * for all users (in either program folder) or for this one.
 */
export function candidates(home: string, env: Record<string, string | undefined>): Candidate[] {
  const programs = env.ProgramFiles ?? 'C:\\Program Files'
  const programs32 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const local = env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local')
  const edge = path.join('Microsoft', 'Edge', 'Application', 'msedge.exe')
  const chrome = path.join('Google', 'Chrome', 'Application', 'chrome.exe')
  return [
    ...[programs32, programs, local].map((folder) => ({ name: 'Microsoft Edge', path: path.join(folder, edge) })),
    ...[programs, programs32, local].map((folder) => ({ name: 'Google Chrome', path: path.join(folder, chrome) }))
  ]
}

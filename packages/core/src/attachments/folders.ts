import { MAX_PLACES } from '@repo/protocol'
import type { Computer } from '../ports/computer.ts'
import type { UserSettings } from '../settings/settings.ts'

/**
 * Folders the person hands over with what they say, dropped on the window of a desktop that knows where they are.
 * Handing one over is consent to read it: it is granted read only, as if picked in the settings, unless the
 * assistant may read it already. Changing anything there still waits for the person to allow it.
 */
export async function giveFolders(
  paths: readonly string[],
  { settings, computer }: { settings: UserSettings; computer: Computer | undefined }
): Promise<string[]> {
  if (!computer) return []
  const given: string[] = []
  for (const path of paths) {
    const found = await computer.locate(path)
    if (found?.kind === 'folder' && !given.includes(found.path)) given.push(found.path)
  }
  const { places, computer: reach } = settings.read().access
  const within = (path: string, place: string) => path === place || path.startsWith(`${place}/`) || path.startsWith(`${place}\\`)
  const covered = (path: string) => reach !== 'off' || places.some((place) => within(path, place.path.replace(/[\\/]+$/, '')))
  // A folder that finds no room among the places is not given: the person is told of those that were.
  const added = given.filter((path) => !covered(path)).slice(0, Math.max(0, MAX_PLACES - places.length))
  if (added.length > 0) settings.setAccess({ places: [...places, ...added.map((path) => ({ path, kind: 'folder' as const, write: false }))] })
  return given.filter((path) => covered(path) || added.includes(path))
}

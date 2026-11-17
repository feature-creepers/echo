import type { Access } from '@repo/protocol'

/**
 * What the assistant may reach, in a few words, for the bottom bar: "Own folder · asks first",
 * "2 folders · trusted", "Whole computer · asks first".
 */
export function reachInWords(access: Access): { reach: string; approvals: string } {
  const folders = access.places.filter((place) => place.kind === 'folder').length
  const files = access.places.length - folders
  const count = (n: number, one: string) => (n === 0 ? undefined : `${n} ${one}${n === 1 ? '' : 's'}`)
  const granted = [count(folders, 'folder'), count(files, 'file')].filter(Boolean).join(', ')
  const reach =
    access.computer === 'write'
      ? 'Whole computer'
      : access.computer === 'read'
        ? 'Reads everything'
        : granted !== ''
          ? access.workspace
            ? `Own folder, ${granted}`
            : granted
          : access.workspace
            ? 'Own folder'
            : 'No files'
  return { reach, approvals: access.approvals === 'ask' ? 'asks first' : 'trusted' }
}

/** The last part of a path, whatever the system's separator. */
export function lastPart(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

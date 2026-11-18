import type { Access } from '@repo/protocol'

/** The approval levels, as the person picks them: a short name, and what it means in a line. */
export const LEVELS: Record<Access['approvals'], { label: string; short: string; detail: string }> = {
  ask: {
    label: 'Ask before each change',
    short: 'asks first',
    detail: 'Reading, and commands that only read, go ahead. A card asks you before every change to a file and every other command.'
  },
  trust: {
    label: 'Ask before commands',
    short: 'asks for commands',
    detail: 'Reading, commands that only read, and changes to files where you allowed changes go ahead. Every other command is asked.'
  },
  auto: {
    label: "Don't ask",
    short: "doesn't ask",
    detail:
      'It acts without a card within what you gave, commands included. What deletes, and what publishes to others, is still asked while the switches below say so.'
  }
}

/** How long a question may wait for the person, as they pick it: minutes, or until they answer (`null`). */
export const WAITS: readonly { minutes: number | null; label: string }[] = [
  { minutes: 10, label: '10 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: null, label: 'Wait for me' }
]

/** A wait in minutes, said for the person: "10 minutes", "an hour", "3 hours". */
export function waitInWords(minutes: number): string {
  if (minutes === 60) return 'an hour'
  if (minutes % 60 === 0) return `${minutes / 60} hours`
  return minutes === 1 ? 'a minute' : `${minutes} minutes`
}

/**
 * What the assistant may reach, in a few words, for the bottom bar: "Own folder · asks first",
 * "2 folders · asks for commands", "Whole computer · doesn't ask".
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
  return { reach, approvals: LEVELS[access.approvals].short }
}

/** The last part of a path, whatever the system's separator. */
export function lastPart(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

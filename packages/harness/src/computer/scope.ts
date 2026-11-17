import type { ComputerUse, Scope } from '@repo/core'
import { real, within } from './paths.ts'

/**
 * Whether a use of a tool falls within what the person granted. Every path is compared once real, links
 * followed, so a link inside a granted folder that leads outside it is outside.
 *
 * A command is not checked here: it can reach anything, so the core has the person approve each one, unless
 * they gave the whole computer to change.
 */
export async function outsideScope(use: ComputerUse, scope: Scope, never: readonly string[]): Promise<string | undefined> {
  if (use.action === 'run') return undefined
  const writes = use.action !== 'read'
  const places = await Promise.all(scope.places.map(async (place) => ({ ...place, real: await real(place.path) })))
  const kept = await Promise.all(never.map(real))
  for (const path of use.paths) {
    const target = await real(path)
    if (kept.some((folder) => within(target, folder))) return `${path} belongs to the assistant itself and is never read or changed by a session.`
    if (scope.computer === 'write' || (scope.computer === 'read' && !writes)) continue
    const granted = places.filter((place) => within(target, place.real))
    if (granted.length === 0) return `${path} is outside what the person granted${describe(scope)}.`
    if (writes && !granted.some((place) => place.write)) return `${path} may be read but not changed: the person granted it read only.`
  }
  return undefined
}

const describe = (scope: Scope) => {
  const places = scope.places.map((place) => `${place.path}${place.write ? '' : ' (read only)'}`)
  return places.length > 0 ? ` (${places.join(', ')})` : ' (nothing)'
}

/** Whether a scope reaches anything at all, and whether it can change anything. */
export function reachOf(scope: Scope): { reads: boolean; writes: boolean } {
  return {
    reads: scope.computer !== 'off' || scope.places.length > 0,
    writes: scope.computer === 'write' || scope.places.some((place) => place.write)
  }
}

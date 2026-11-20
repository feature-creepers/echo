import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { type ComputerUse, type NamedPlace, type ProtectedPath, readCommand, type Scope } from '@repo/core'
import { gitReads } from './git-files.ts'
import { namedPath, real, within } from './paths.ts'
import type { Where } from './system/index.ts'

/**
 * Whether a use of a tool falls within what the person granted, the same way for every tool (docs/SPEC.md,
 * section 12.2). Every path is compared once real, links followed, so a link inside a granted folder that
 * leads outside it is outside. A command is checked by the paths it names, as the core's analysis reads them:
 * a program can still work out other paths once it runs, and the person's approval stays the check for that.
 *
 * Some places are never reached, whatever was granted: those of the scope, and the adapter's own folder.
 */

const GRANT_MORE = 'The person can grant more in Settings, Access.'

/** A place never reached, once real. */
interface Kept {
  label: string
  path?: string | undefined
  ending?: string | undefined
  except: string[]
}

async function keptPlaces(scope: Scope, never: readonly string[]): Promise<Kept[]> {
  const own = never.map((path): ProtectedPath => ({ label: 'The assistant’s own working files', path }))
  return Promise.all(
    [...own, ...(scope.protected ?? [])].map(async (place) => ({
      label: place.label,
      path: place.path === undefined ? undefined : await real(place.path),
      ending: place.ending?.toLowerCase(),
      except: await Promise.all((place.except ?? []).map(real))
    }))
  )
}

/** The place never reached that a real path is in, when it is in one. */
function keptAt(target: string, kept: readonly Kept[]): Kept | undefined {
  return kept.find((place) => {
    if (place.ending !== undefined) return target.toLowerCase().endsWith(place.ending)
    return place.path !== undefined && within(target, place.path) && !place.except.some((open) => within(target, open))
  })
}

/** A place never reached inside a folder that a use goes through whole. */
const keptInside = (folder: string, kept: readonly Kept[]) =>
  kept.find(
    (place) =>
      place.path !== undefined && place.path !== folder && within(place.path, folder) && !place.except.some((open) => within(place.path as string, open))
  )

const describe = (scope: Scope) => {
  const places = scope.places.map((place) => `${place.path}${place.write ? '' : ' (read only)'}`)
  return places.length > 0 ? ` (${places.join(', ')})` : ' (nothing)'
}

/**
 * A use as the core is asked about it: refused with the reason when it reaches beyond what was granted or a
 * place never reached; for a file changed, whether git reads it; and for a command, whether every place it names
 * may be changed. `where` is where the person's own git settings are.
 */
export async function checkUse(
  use: ComputerUse,
  scope: Scope,
  never: readonly string[],
  where: Where = { home: homedir(), env: process.env }
): Promise<ComputerUse> {
  const kept = await keptPlaces(scope, never)
  const places = await Promise.all(scope.places.map(async (place) => ({ ...place, real: await real(place.path) })))
  // The core is told each path as the system names it; each is checked where it leads as written, `..` after a link too.
  const told: ComputerUse = { ...use, paths: use.paths.map((path) => resolve(path)) }
  const refuse = (why: 'outside' | 'protected', reason: string): ComputerUse => ({ ...told, refused: { why, reason } })

  /** Why a path may not be reached, reading only or changing it too. */
  const problem = (path: string, target: string, writes: boolean, below: boolean): { why: 'outside' | 'protected'; reason: string } | undefined => {
    const never = keptAt(target, kept)
    if (never) return { why: 'protected', reason: `${path} holds ${never.label.toLowerCase()}, which is never reached, whatever is granted.` }
    if (below) {
      const inside = keptInside(target, kept)
      if (inside)
        return {
          why: 'protected',
          reason: `It would go through ${inside.path} (${inside.label.toLowerCase()}), which is never reached. Name a folder that does not hold it.`
        }
    }
    if (scope.computer === 'write' || (scope.computer === 'read' && !writes)) return undefined
    const granted = places.filter((place) => within(target, place.real))
    if (granted.length === 0) return { why: 'outside', reason: `${path} is outside what the person granted${describe(scope)}. ${GRANT_MORE}` }
    if (writes && !granted.some((place) => place.write))
      return { why: 'outside', reason: `${path} may be read but not changed: the person granted it read only. ${GRANT_MORE}` }
    return undefined
  }

  if (use.action !== 'run') {
    const writes = use.action !== 'read'
    // Grep reads what is in every file of the folder it searches.
    const below = use.tool === 'Grep'
    let changesGit = false
    for (const [index, path] of use.paths.entries()) {
      const target = await real(path)
      const found = problem(told.paths[index] ?? path, target, writes, below)
      if (found) return refuse(found.why, found.reason)
      if (writes && !changesGit) changesGit = await gitReads(target, where)
    }
    return changesGit ? { ...told, changesGit: true } : told
  }

  // A command: the folder it runs in, then every path it names, read from that folder.
  const folder = use.paths[0]
  if (folder === undefined) return refuse('outside', 'The command has no folder to run in.')
  const reading = readCommand(use.command ?? '', use.shell ?? 'posix')
  let changes = true
  let runsIn: string | undefined
  // The places it names outside its folder, each once, so what it changes there is looked for too.
  const outside = new Map<string, NamedPlace>()
  for (const named of [{ path: folder, below: false, written: folder }, ...reading.paths.map((one) => ({ ...one, written: one.path }))]) {
    const target = await real(namedPath(named.path, folder))
    const found = problem(named.written, target, false, named.below)
    if (found) return refuse(found.why, found.reason)
    if (scope.computer !== 'write' && !places.some((place) => place.write && within(target, place.real))) changes = false
    if (runsIn === undefined) runsIn = target
    else if (!within(target, runsIn)) {
      const known = outside.get(target)
      outside.set(target, { path: target, below: named.below || known?.below === true })
    }
  }
  return { ...told, reach: changes ? 'write' : 'read', ...(outside.size > 0 ? { named: [...outside.values()] } : {}) }
}

/** Whether a scope reaches anything at all, and whether it can change anything. */
export function reachOf(scope: Scope): { reads: boolean; writes: boolean } {
  return {
    reads: scope.computer !== 'off' || scope.places.length > 0,
    writes: scope.computer === 'write' || scope.places.some((place) => place.write)
  }
}

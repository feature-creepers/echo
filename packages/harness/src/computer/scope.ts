import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { type ComputerUse, type NamedPath, type NamedPlace, type ProtectedPath, readCommand, type Scope } from '@repo/core'
import { gitReads } from './git-files.ts'
import { endingInside, matches } from './inside.ts'
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

/**
 * How many entries the folders a use goes through are looked through for a file never reached by its ending. Walked
 * 64 folders at a time, 20,000 entries took 0.2 to 0.3 s on Windows (a repository with its node_modules, 24,659 in all).
 */
const MAX_WALKED = 20_000

/** How many paths a wildcard matches that are checked: past that, the use is asked. */
const MAX_MATCHES = 1_000

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

/** A place never reached, known by its path, inside a folder that a use goes through or a wildcard picks from. */
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
  const endings = kept.flatMap((place) => (place.ending === undefined ? [] : [place.ending]))
  const budget = { left: MAX_WALKED }
  const walked: string[] = []
  /** A folder it goes through, or a wildcard, held more than was looked through. */
  let unwalked = false

  /** Why a folder a use goes through may not be: it holds a file never reached, known by its ending. */
  const holds = async (target: string): Promise<{ why: 'protected'; reason: string } | undefined> => {
    if (endings.length === 0 || walked.some((root) => within(target, root))) return undefined
    walked.push(target)
    const found = await endingInside(target, endings, budget)
    if (found === 'unwalked') unwalked = true
    if (found === 'unwalked' || found === undefined) return undefined
    const label = kept.find((place) => place.ending === found.ending)?.label.toLowerCase()
    return { why: 'protected', reason: `It would go through ${found.path} (${label}), which is never reached. Name a folder that does not hold it.` }
  }
  const marked = (checked: ComputerUse): ComputerUse => (unwalked ? { ...checked, unwalked: true } : checked)

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
      const found = problem(told.paths[index] ?? path, target, writes, below) ?? (below ? await holds(target) : undefined)
      if (found) return refuse(found.why, found.reason)
      if (writes && !changesGit) changesGit = await gitReads(target, where)
    }
    return marked(changesGit ? { ...told, changesGit: true } : told)
  }

  // A command: the folder it runs in, then every path it names, read from that folder.
  const folder = use.paths[0]
  if (folder === undefined) return refuse('outside', 'The command has no folder to run in.')
  const reading = readCommand(use.command ?? '', use.shell ?? 'posix')
  let changes = true
  let runsIn: string | undefined
  // The places it names outside its folder, each once, so what it changes there is looked for too.
  const outside = new Map<string, NamedPlace>()
  /** Why a place it names, or a wildcard matches, may not be reached; and whether it may change it. */
  const checked = async (written: string, target: string, below: boolean, picked: boolean) => {
    const found = problem(written, target, false, below || picked) ?? (below ? await holds(target) : undefined)
    if (scope.computer !== 'write' && !places.some((place) => place.write && within(target, place.real))) changes = false
    return found
  }
  const listed: NamedPath[] = [{ path: folder, below: false }, ...reading.paths]
  for (const named of listed) {
    const target = await real(namedPath(named.path, folder))
    const { pattern } = named
    const found = await checked(named.path, target, named.below, pattern !== undefined)
    if (found) return refuse(found.why, found.reason)
    if (runsIn === undefined) runsIn = target
    else if (!within(target, runsIn)) {
      const known = outside.get(target)
      outside.set(target, { path: target, below: named.below || pattern !== undefined || known?.below === true })
    }
    // A wildcard: each path it matches is checked as one the line names. With none, the folder it picks from was.
    if (pattern === undefined) continue
    const matched = await matches(target, pattern, MAX_MATCHES)
    if (matched.more) unwalked = true
    for (const match of matched.found) {
      const refused = await checked(match, await real(match), named.below, false)
      if (refused) return refuse(refused.why, refused.reason)
    }
  }
  return marked({ ...told, reach: changes ? 'write' : 'read', ...(outside.size > 0 ? { named: [...outside.values()] } : {}) })
}

/** Whether a scope reaches anything at all, and whether it can change anything. */
export function reachOf(scope: Scope): { reads: boolean; writes: boolean } {
  return {
    reads: scope.computer !== 'off' || scope.places.length > 0,
    writes: scope.computer === 'write' || scope.places.some((place) => place.write)
  }
}

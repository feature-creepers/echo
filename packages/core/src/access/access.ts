import { type AccessUse, type Allowance, type CommandInput, type Event, MAX_PLACES, type Place, type ProtectedPlace } from '@repo/protocol'
import { z } from 'zod'
import type { Blobs } from '../ports/blobs.ts'
import type { Timers } from '../ports/clock.ts'
import type { Computer, FolderSnapshot } from '../ports/computer.ts'
import type { ComputerUse, HarnessComputer, Reach, Scope, Verdict } from '../ports/harness.ts'
import type { Records } from '../ports/records.ts'
import { folderName, fromFolder } from '../projects/folders.ts'
import type { AccessChange, SettingsChange, UserSettings } from '../settings/settings.ts'
import type { Tool } from '../tools/tools.ts'
import type { Screen, Showing } from '../views/screen.ts'
import { type Activity, createActivity, type NewUse, type UndoResult } from './activity.ts'
import { createAllowances, folderOf, within } from './allowances.ts'
import { type Answer, type Answered, type Approvals, createApprovals, type Question } from './approvals.ts'
import { type CommandReading, readCommand } from './commands.ts'
import { isLocalNetwork, isLoopback, listedHost } from './hosts.ts'
import { MIN_PHRASE_WORDS, phraseOf } from './phrase.ts'
import { decide, networkGuard } from './policy.ts'
import { stopsEverything } from './words.ts'

/**
 * What the assistant may reach on the person's computer, and the questions it asks before acting there
 * (docs/SPEC.md, section 12.2).
 *
 * The person grants: the assistant's own folder, folders and files read only or read and write, or the
 * whole computer. Some places are never reached whatever is granted. The harness checks every use of its own
 * tools against that, commands by the paths they name, and the core refuses what falls outside; what falls
 * inside runs or is asked first, as the level the person chose says. Every use is kept in the activity, with
 * the previous version of a file changed, for 30 days.
 */
export interface AccessControl {
  /** The computer as a thread reaches it, its questions going where `showing` says. Nothing when the core has no computer. */
  reach(showing: () => Showing): Reach | undefined
  /** The tool a thread asks for a folder or a file with, when the person gives one by voice. */
  tools(showing: () => Showing): Tool[]
  /**
   * Have a place within reach: nothing to do when it already is, else the person is asked on screen, where
   * `showing` says, and it is granted once they agree. `purpose` words the card: a place to give, or a project's
   * folder to work in. A place the person `chose` themselves in the interface is granted without a card: choosing
   * it there is their consent, as in Settings, Access. What is never reached is refused all the same.
   */
  grant(asked: GrantAsked, showing: Showing): Promise<Granted>
  /**
   * What a thread is told about its access, as it stands now, for the program it runs on: the names of its tools,
   * whether the system holds its commands, and what it needs to reach files (`DIRECT_TOOLS` when left out).
   */
  standing(tools?: HarnessComputer): string | undefined
  /** The folders the person lets the assistant change, besides its own: where it may work on a project. */
  projects(): string[]
  /**
   * Whether a place is within reach now, for reading or, with `write`, for changing, and not a place never reached.
   * Read from its words: what the core reads itself, such as a project's instructions, it reads only from there.
   */
  reaches(path: string, write?: boolean): boolean
  /** What a place is that is never reached whatever is granted, named for the person ("SSH keys"). Nothing when it is not one. */
  neverReached(path: string): string | undefined
  /**
   * What a thread did on the computer, most recent last, in lines a session reads: what it changed and ran, how it
   * went, and what was refused and why. Paths inside `folder` are written from it. Nothing when it did nothing.
   */
  worked(thread: string, folder?: string): string | undefined
  /**
   * Changes when what a session is given at its start changes: the places, the reach beyond them, the assistant's
   * own folder. It is then opened again. The approval level is not part of it: a session is told of a new one with
   * its next message (`standing`), so work under way keeps its context.
   */
  version(): string
  /**
   * Something the person said, which may answer a question on screen, or stop everything. True when it did.
   * `spoken`: heard by the device's recogniser rather than typed or pressed.
   */
  hear(said: string, spoken?: boolean): boolean
  /** Ask the person something else before acting, with the same cards: one queue, so a yes said aloud answers the latest. */
  ask: Approvals['ask']
  /** Change the access, checking each new place exists. */
  set(asked: CommandInput<'access.set'>): Promise<SettingsChange>
  /** What was allowed for the session, and the places never reached on this computer. */
  standingRules(): { allowances: Allowance[]; protected: ProtectedPlace[] }
  /** Take back something allowed for the session. False when there is no such one. */
  forget(allowance: string): boolean
  /**
   * Keep a use of the computer that did not come through `reach`, such as a tool of the core's own acting in a
   * browser: it shows in the activity like any other. Gives back its identifier, to report how it went with
   * `report`.
   */
  record(use: NewUse): string
  /** How a use went. */
  report(use: string, outcome: { ok: boolean; error?: string | undefined }): void
  /** The activity, the latest first. */
  activity(limit: number, before?: string): { uses: AccessUse[]; more: boolean }
  /** Undo a use: its files' previous versions put back, or the files it created moved to the trash. */
  undo(use: string, anyway: boolean): Promise<UndoResult>
  /** What a use, or a whole turn, changed in each file, as diffs. Nothing when there is no such use. */
  diff: Activity['diff']
  /** Whether the activity's chain holds. */
  check: Activity['check']
  /** The whole activity, sealed, as a document to save. */
  exportActivity: Activity['export']
  /** What each turn given changed: its uses that changed files, and the files as it left them, counted. */
  changes: Activity['changes']
  /** The versions kept of one file: the one each change left, the latest first, and the one before the first. */
  versions: Activity['versions']
  /** Put a kept version of a file back, as the person asked; a use of its own, which can be undone in turn. */
  restore: Activity['restore']
  /**
   * Stop everything: every question waiting is withdrawn, the session's approvals are forgotten, and whoever
   * listens with `onStopEverything` stops too: the conversation's turns and threads, and what runs on its own.
   */
  stopEverything(): void
  onStopEverything(listener: () => void): () => void
  /** Be told what changed: the session's approvals, a use kept. */
  onEvent(listener: (event: Event) => void): () => void
}

export interface AccessOptions {
  settings: UserSettings
  screen: Screen
  /** The computer the core runs on. Left out, the assistant reaches no file: a core with no computer of its own. */
  computer?: Computer | undefined
  timers?: Timers | undefined
  /** Where the activity is kept. Left out, nothing is kept (a core with no computer has nothing to keep). */
  records?: Records | undefined
  /** Where previous versions of changed files are kept. */
  versions?: Blobs | undefined
  now?: (() => Date) | undefined
  newId?: (() => string) | undefined
}

const grantInput = z.object({ path: z.string().trim().min(1).max(4096), write: z.boolean().default(false) })

/** A place asked for: within reach now, as the system names it, or why not, in words the model can tell the person. */
export type Granted = { ok: true; path: string; kind: 'folder' | 'file'; already: boolean } | { ok: false; text: string }

/** A place to have within reach: what for, and whether the person chose it themselves in the interface. */
export interface GrantAsked {
  path: string
  write: boolean
  purpose?: 'grant' | 'work'
  chosen?: boolean
}

/** How many commands' folders, looked at before they ran, wait at most for their end to be told. */
const SNAPSHOTS_KEPT = 50

/** How many of a thread's uses it is reminded of when a new session carries on its work. */
const WORKED_LINES = 40

const REFUSED: Record<Exclude<Answer, 'yes' | 'session'>, string> = {
  no: 'The person said no. Do not try it again unless they ask.',
  'moved-on': 'The person moved on to something else without answering, so it was not done.',
  stopped: 'It was stopped, so it was not done.',
  unanswered: 'No answer came, so it was not done. Ask again if it still matters.'
}

const REASON_OF: Record<Exclude<Answer, 'yes' | 'session'>, NewUse['reason']> = {
  no: 'declined',
  'moved-on': 'unanswered',
  stopped: 'stopped',
  unanswered: 'unanswered'
}

/** A path as a thread working in `folder` writes it: from that folder when it is inside it. */
const relative = (path: string, folder: string | undefined) => (folder === undefined ? path : (fromFolder(folder, path) ?? path))

const DONE: Record<AccessUse['action'], string> = { read: 'read', create: 'created', change: 'changed', delete: 'deleted', run: 'ran' }
const DOING: Record<AccessUse['action'], string> = { read: 'reading', create: 'creating', change: 'changing', delete: 'deleting', run: 'running' }

/** Where a command goes on the network, for the card: the destinations it names, a device of the local network said so. */
function reachesWords(hosts: readonly string[]): string {
  const named = hosts.filter((host) => !isLoopback(host))
  if (named.length === 0) return hosts.length > 0 ? 'It reaches this computer over the network.' : 'It uses the network; where, the command does not say.'
  const shown = named.slice(0, 4).map((host) => (isLocalNetwork(host) ? `${host} (on your local network)` : host))
  return `It reaches ${shown.join(', ')}${named.length > 4 ? `, and ${named.length - 4} more` : ''}.`
}

/** What a command sends, for the card: the files by name, and where they go when it says. */
function sendsWords(sends: readonly string[], hosts: readonly string[]): string {
  const files = sends.map((file) => (file === '-' ? 'the output of the command before it' : file))
  const shown = files.slice(0, 3).join(', ') + (files.length > 3 ? `, and ${files.length - 3} more` : '')
  const named = hosts.filter((host) => !isLoopback(host)).map((host) => (isLocalNetwork(host) ? `${host} (on your local network)` : host))
  return `It sends ${shown} from this computer to ${named.length > 0 ? named.slice(0, 3).join(', ') : 'another machine'}.`
}

/** What a session is told of the network policy: only what the person set beyond what any command does. */
function networkLines({
  askNetwork,
  askLocalNetwork,
  askSending,
  allowedHosts,
  refusedHosts
}: {
  askNetwork: boolean
  askLocalNetwork: boolean
  askSending: boolean
  allowedHosts: readonly string[]
  refusedHosts: readonly string[]
}): string[] {
  const allowed = allowedHosts.length > 0 ? ` except ${allowedHosts.join(', ')}` : ''
  return [
    ...(askSending
      ? [
          `- A command that sends a file of this computer to another machine is always asked${allowed}: an upload (curl -T or -F, wget --post-file), a copy to a server (scp, rsync, aws s3 cp), or a file piped to ssh or nc. The card names the file.`
        ]
      : []),
    ...(askNetwork
      ? [
          `- A command that reaches the network is always asked, whatever they chose${allowed}: a download, an API call, a package installed, a git fetch or push. Name the address on the line when you can; a command that names none is asked too. They may allow it for the session.`
        ]
      : []),
    ...(askLocalNetwork
      ? ['- A command that reaches a device of their local network (a private address, a name such as nas or printer.local) is always asked.']
      : []),
    ...(refusedHosts.length > 0 ? [`- Commands never reach ${refusedHosts.join(', ')}: they refused these, and a command naming one is refused.`] : [])
  ]
}

/** One use, as a session carrying on a thread's work is reminded of it. */
function workedLine(use: AccessUse, path: (path: string) => string): string {
  const what =
    use.action === 'run' ? (use.paths.length === 0 ? `on the web: ${use.command ?? use.tool}` : `\`${use.command ?? ''}\``) : use.paths.map(path).join(', ')
  if (use.decision === 'refused') return `not done, ${DOING[use.action]} ${what}: ${use.detail ?? use.reason}`
  const outcome = use.outcome === undefined ? '' : use.outcome.ok ? '' : ` (it failed${use.outcome.error ? `: ${use.outcome.error}` : ''})`
  // How much a change changed, in lines: enough to tell a one-line fix from a rewrite.
  const lines = (use.changes ?? []).filter((change) => !change.binary && !change.large)
  const size =
    lines.length === 0 ? '' : ` (+${lines.reduce((sum, change) => sum + change.added, 0)} −${lines.reduce((sum, change) => sum + change.removed, 0)})`
  const undone = use.undo?.done ? ' (the person undid it since)' : ''
  return `${DONE[use.action]} ${what}${size}${outcome}${undone}`
}

/**
 * How a program works with files when it does not say: with tools of its own for reading and writing files, and a
 * command line, reaching what was granted, its commands not held by the system.
 */
export const DIRECT_TOOLS: HarnessComputer = {
  tools: 'Read, Glob, Grep, Write, Edit and Bash',
  use: 'Look with Read, Glob and Grep, change with Write and Edit, and use Bash for what these cannot do; a command that only reads runs at once, so prefer one when looking is all you need.',
  write: 'Write',
  confines: false,
  needs: 'grant'
}

/** Keeps nothing: for a core with no records, which has no computer either. */
const NO_RECORDS: Records = { append: () => [], read: () => [] }
const NO_VERSIONS: Blobs = { put: () => '', get: () => undefined }

export function createAccess({ settings, screen, computer, timers, records, versions, now = () => new Date(), newId }: AccessOptions): AccessControl {
  const access = () => settings.read().access
  const approvals = createApprovals({ screen, timers, wait: () => access().approvalWait, phrase: () => access().confirmation })
  let ids = 0
  const nextId = newId ?? (() => `use-${++ids}`)
  const allowances = createAllowances({ newId: nextId, now, destroyingAsked: () => access().askDestroying })
  const activity: Activity = createActivity({ records: records ?? NO_RECORDS, versions: versions ?? NO_VERSIONS, computer, now, newId: nextId })
  /** The folders of commands that may change files, looked at before they ran, by their use. */
  const snapshots = new Map<string, FolderSnapshot>()
  const listeners = new Set<(event: Event) => void>()
  const stopping = new Set<() => void>()
  const emit = (event: Event) => {
    for (const listener of listeners) listener(event)
  }
  allowances.onChange((list) => emit({ type: 'event', name: 'allowances.changed', allowances: list }))
  activity.onUse((use) => emit({ type: 'event', name: 'activity.used', use }))
  // What is kept is erased after 30 days; the core starts often enough for that to be on time.
  activity.expire()

  // What was allowed for the session ends when the access changes: the person chose again.
  let lastAccess = JSON.stringify(access())
  settings.onChange((changed) => {
    const next = JSON.stringify(changed.access)
    if (next === lastAccess) return
    lastAccess = next
    allowances.clear()
  })

  const scope = (): Scope => {
    const { workspace, places, computer: reach } = access()
    const home = computer && workspace ? computer.workspace : undefined
    return {
      places: [...(home ? [{ path: home, kind: 'folder' as const, write: true }] : []), ...places],
      computer: reach,
      home,
      protected: computer?.protected ?? []
    }
  }

  /**
   * The place never reached that a path is in, if any, as the adapter finds it: a file whose name ends a certain way,
   * or a place inside one, unless it is inside a folder reached all the same.
   */
  const neverReached = (path: string) =>
    computer?.protected.find((place) =>
      place.ending !== undefined
        ? path.toLowerCase().endsWith(place.ending.toLowerCase())
        : place.path !== undefined && within(path, place.path) && !(place.except ?? []).some((open) => within(path, open))
    )

  /** Whether a place is within what was granted, by its words, for reading or, with `write`, for changing. */
  const covered = (path: string, write: boolean) => {
    const current = scope()
    return (
      current.computer === 'write' ||
      (current.computer === 'read' && !write) ||
      current.places.some((place) => within(path, place.path) && (place.write || !write))
    )
  }

  /** Where a path is, said for the person: the assistant's own folder by that name. */
  const where = (path: string) => (computer && within(path, computer.workspace) ? "The assistant's folder" : path)

  const question = (use: ComputerUse, reading: CommandReading | undefined, offerSession: boolean): Question => {
    const path = use.paths[0] ?? ''
    const [name, folder] = [folderName(path), folderOf(path)]
    const session = (text: string) => (offerSession ? { session: text } : {})
    switch (use.action) {
      case 'run': {
        const keys = reading?.keys ?? []
        const note = reading ? commandNote(reading) : undefined
        return {
          heading: 'Run this command?',
          subject: 'On your computer',
          command: use.command ?? '',
          facts: [{ label: 'In', value: where(path) }],
          ...(note ? { note } : {}),
          // What puts something before others, or sends a file of this computer away, reaches beyond it.
          ...(reading?.publishes || (reading && reading.sends.length > 0) ? { outward: true } : {}),
          allow: 'Run it',
          ...session(keys.length === 1 ? `Any “${keys[0]}” until you quit` : `Any of ${keys.map((key) => `“${key}”`).join(', ')} until you quit`)
        }
      }
      case 'delete':
        return {
          heading: 'Delete this file?',
          subject: name,
          facts: [{ label: 'In', value: where(folder) }],
          note: { text: 'Its last version is kept: you can restore it from Activity.', tone: 'soft' },
          allow: 'Delete it'
        }
      case 'create':
        return {
          heading: 'Create this file?',
          subject: name,
          facts: [{ label: 'In', value: where(folder) }],
          allow: 'Create it',
          ...session(`Any change in ${namedFolder(folder)} until you quit`)
        }
      default:
        return {
          heading: use.paths.length > 1 ? `Change these ${use.paths.length} files?` : 'Change this file?',
          subject: use.paths.length > 1 ? use.paths.map(folderName).join(', ') : name,
          facts: [{ label: 'In', value: where(folder) }],
          allow: 'Change it',
          ...session(`Any change in ${namedFolder(folder)} until you quit`)
        }
    }
  }

  /** What the person should know of a command before answering, the most serious first. */
  const commandNote = (reading: CommandReading): Question['note'] => {
    const policy = access()
    const always = (asked: boolean) => (asked ? ' This is always asked.' : '')
    if (reading.destructive)
      return { text: `It deletes or overwrites something for good, or changes the system.${always(policy.askDestroying)}`, tone: 'danger' }
    if (reading.publishes) return { text: `It puts something before others, beyond this computer.${always(policy.askPublishing)}`, tone: 'soft' }
    const guarded = networkGuard(reading, policy) !== undefined
    if (reading.sends.length > 0) return { text: `${sendsWords(reading.sends, reading.hosts)}${always(guarded)}`, tone: 'soft' }
    if (reading.network) return { text: `${reachesWords(reading.hosts)}${always(guarded)}`, tone: 'soft' }
    return reading.opaque ? { text: 'Part of what it runs cannot be read in advance.', tone: 'soft' } : undefined
  }

  /** A folder named for the person: the assistant's folder by that name, any other by its last part. */
  const namedFolder = (folder: string) => (computer && within(folder, computer.workspace) ? "the assistant's folder" : folderName(folder))

  /** Who made a use, as it is kept: the thread, and the turn it was answering. */
  const madeBy = ({ thread, turn }: Showing): Pick<NewUse, 'thread' | 'turn'> => ({
    ...(thread === undefined ? {} : { thread }),
    ...(turn === undefined ? {} : { turn })
  })

  /** Keep a use that was refused. */
  const refusal = (
    use: ComputerUse,
    by: Pick<NewUse, 'thread' | 'turn'>,
    reading: CommandReading | undefined,
    decision: Pick<NewUse, 'decision' | 'reason' | 'detail'>
  ) =>
    activity.record({
      ...by,
      tool: use.tool,
      action: use.action,
      ...(use.command === undefined ? {} : { command: use.command }),
      paths: use.paths,
      ...decision,
      ...(reading?.destructive ? { destructive: true } : {}),
      ...(reading?.network ? { network: true } : {})
    })

  /** A use allowed: the versions of the files it changes are kept first, then it is recorded, and it may go. */
  const allowed = async (
    use: ComputerUse,
    by: Pick<NewUse, 'thread' | 'turn'>,
    reading: CommandReading | undefined,
    reason: NewUse['reason']
  ): Promise<Verdict> => {
    const changes = use.action === 'create' || use.action === 'change' || use.action === 'delete'
    const versions = changes ? await activity.keep(use.paths) : { kept: [], created: [] }
    // A command that may change files: its folder is looked at first, with the places it names outside it, to find
    // what it changed once it ended; the places it may change are watched while it runs, for the files a program
    // works out once it runs.
    const folder = use.action === 'run' && reason !== 'read-only' ? use.paths[0] : undefined
    const current = scope()
    const changeable = { places: current.places.filter((place) => place.write).map((place) => place.path), everywhere: current.computer === 'write' }
    const snapshot = folder === undefined ? undefined : await computer?.snapshot?.(folder, use.named ?? [], changeable).catch(() => undefined)
    const recorded = activity.record({
      ...by,
      tool: use.tool,
      action: use.action,
      ...(use.command === undefined ? {} : { command: use.command }),
      paths: use.paths,
      decision: reason === 'pressed' || reason === 'said' ? 'approved' : 'ran',
      reason,
      ...(reading?.destructive ? { destructive: true } : {}),
      ...(reading?.network ? { network: true } : {}),
      ...versions
    })
    if (snapshot) {
      snapshots.set(recorded.id, snapshot)
      // A command whose end is never told gives way to newer ones, and what it watched is let go.
      for (const [oldest, given] of snapshots) {
        if (snapshots.size <= SNAPSHOTS_KEPT) break
        snapshots.delete(oldest)
        given.release?.()
      }
    }
    return { allow: true, use: recorded.id }
  }

  /** How a use went: for a command looked at before, what it changed is found first. */
  const report = async (use: string, outcome: { ok: boolean; error?: string | undefined }) => {
    const snapshot = snapshots.get(use)
    snapshots.delete(use)
    const found = snapshot ? await snapshot.changes().catch(() => undefined) : undefined
    await activity.outcome(use, outcome, found)
  }

  const stopEverything = () => {
    approvals.withdraw()
    allowances.clear()
    for (const listener of [...stopping]) listener()
  }

  /**
   * A place within reach: found first, never one that is never reached, and asked of the person unless it already is
   * or they chose it themselves.
   */
  const grant = async ({ path, write, purpose = 'grant', chosen = false }: GrantAsked, showing: Showing): Promise<Granted> => {
    if (!computer) return { ok: false, text: 'This assistant runs where it cannot reach files.' }
    const found = await computer.locate(path)
    if (!found) return { ok: false, text: chosen ? `There is nothing at ${path}.` : `There is nothing at ${path}. Ask the person where it is.` }
    if (purpose === 'work' && found.kind !== 'folder') return { ok: false, text: `${found.path} is a file: a project is a folder.` }
    // A place never reached is not given either. A folder that holds one may be: what is inside stays refused.
    const never = neverReached(found.path)
    if (never) return { ok: false, text: `${found.path} holds ${never.label.toLowerCase()}, which is never reached, whatever is granted.` }
    if (covered(found.path, write)) return { ok: true, path: found.path, kind: found.kind, already: true }
    // The places are kept to their number, so that the settings stay readable when the app opens again.
    const places = access().places.filter((place) => place.path !== found.path)
    if (places.length >= MAX_PLACES) return { ok: false, text: `${MAX_PLACES} places are granted already: one must be taken away in Settings, Access first.` }
    if (chosen) {
      settings.setAccess({ places: [...places, { path: found.path, kind: found.kind, write }] })
      return { ok: true, path: found.path, kind: found.kind, already: false }
    }
    const working = purpose === 'work'
    const { answer } = await approvals.ask(
      {
        heading: working ? 'Work in this folder?' : found.kind === 'folder' ? 'Give access to this folder?' : 'Give access to this file?',
        subject: found.path,
        facts: [{ label: 'Access', value: write ? 'Read and change' : 'Read only' }],
        ...(working ? { note: { text: 'Changes and commands there are decided by your approval level, and kept in Activity.', tone: 'soft' as const } } : {}),
        allow: working ? 'Work here' : 'Give access'
      },
      showing
    )
    if (answer !== 'yes' && answer !== 'session') return { ok: false, text: REFUSED[answer] }
    // Read again: the places may have changed while the question waited.
    const kept = access().places.filter((place) => place.path !== found.path)
    settings.setAccess({ places: [...kept, { path: found.path, kind: found.kind, write }] })
    return { ok: true, path: found.path, kind: found.kind, already: false }
  }

  return {
    reach(showing) {
      if (!computer) return undefined
      return {
        scope,
        async approve(use, signal): Promise<Verdict> {
          const by = madeBy(showing())
          if (use.refused) {
            refusal(use, by, undefined, { decision: 'refused', reason: use.refused.why, detail: use.refused.reason })
            return { allow: false, reason: use.refused.reason }
          }
          const reading = use.action === 'run' ? readCommand(use.command ?? '', use.shell ?? 'posix') : undefined
          // A destination the person refused is refused before anyone is asked, whatever the level.
          const refusedHost = reading?.network ? reading.hosts.find((host) => listedHost(host, access().refusedHosts)) : undefined
          if (refusedHost !== undefined) {
            const reason = `It reaches ${refusedHost}, which the person refused in Settings, Access. Do not try another way there.`
            refusal(use, by, reading, { decision: 'refused', reason: 'destination', detail: reason })
            return { allow: false, reason }
          }
          const decision = decide(use, access(), reading, allowances.covers(use, reading))
          if (decision.run) return allowed(use, by, reading, decision.because)

          const answered: Answered = await approvals.ask(question(use, reading, decision.session), showing(), signal)
          const { answer } = answered
          if (answer === 'yes' || answer === 'session') {
            if (answer === 'session' && decision.session) allowances.allow(use, reading)
            return allowed(use, by, reading, answered.pressed ? 'pressed' : 'said')
          }
          refusal(use, by, reading, { decision: 'refused', reason: REASON_OF[answer], detail: REFUSED[answer] })
          return { allow: false, reason: REFUSED[answer] }
        },
        report: (use, outcome) => void report(use, outcome)
      }
    },

    tools(showing) {
      if (!computer) return []
      return [
        {
          definition: {
            name: 'computer_grant',
            description:
              'Ask for a folder or a file of the person\'s computer, when they give you one to work with ("you can look at my Documents folder"). They confirm on screen; then you can use it at once. `path` is absolute, or starts with ~ for their home folder. `write` only when they said you may change things there.',
            inputSchema: {
              type: 'object',
              properties: { path: { type: 'string' }, write: { type: 'boolean' } },
              required: ['path']
            }
          },
          async run(input) {
            const asked = grantInput.safeParse(input)
            if (!asked.success) return { ok: false, text: 'computer_grant takes a path, absolute or from ~, and whether you may change things there.' }
            const granted = await grant(asked.data, showing())
            if (!granted.ok) return { ok: false, text: granted.text }
            return {
              ok: true,
              text: granted.already
                ? `${granted.path} is already within your reach.`
                : `Granted: ${granted.path}, ${asked.data.write ? 'read and write' : 'read only'}. You can use it now.`
            }
          }
        }
      ]
    },

    grant,

    standing(tools = DIRECT_TOOLS) {
      if (!computer) return undefined
      const {
        places,
        computer: reach,
        approvals: level,
        workspace,
        askDestroying,
        askPublishing,
        askNetwork,
        askLocalNetwork,
        askSending,
        allowedHosts,
        refusedHosts,
        approvalWait
      } = access()
      if (!workspace && places.length === 0 && reach === 'off') {
        return "The computer\n\nYou have no access to the person's files. If they want you to work with some, they can grant a folder in Settings, Access, or tell you which one: then call computer_grant."
      }
      // A program that reaches files only through a command line it cannot keep from reading elsewhere is given none
      // until the whole computer may be read: what was granted is named, so the session can say what is missing.
      if (tools.needs === 'computer' && reach === 'off') {
        const granted = [...(workspace ? [computer.workspace] : []), ...places.map((place) => place.path)].join(', ')
        return [
          'The computer',
          '',
          `The person granted you places on their computer (${granted}), but the AI program you run on reaches files only through a command line that cannot be kept from reading the rest of this computer, so you have no tool for files or commands here.`,
          'If they want you to work with their files, tell them in a sentence: they can let you read the whole computer in Settings, Access, or run you on another AI program in Settings, Models. Never say you are read-only for another reason.'
        ].join('\n')
      }
      const lines = [
        ...(workspace ? [`- Your own folder, ${computer.workspace}: read and write. A file you put on the computer goes there unless they say where.`] : []),
        ...places.map((place) => `- ${place.path} (${place.kind}): ${place.write ? 'read and write' : 'read only'}.`),
        reach === 'off' ? '- Nothing else of the computer.' : `- The rest of the computer: ${reach === 'write' ? 'read and write' : 'read only'}.`
      ]
      const asking = {
        ask: 'Reading, and commands that only read (ls, cat, grep, find, git status and the like), run at once. Every change to a file, and every other command, waits for their approval on screen, shown as it will be done.',
        trust:
          'Reading, commands that only read, and changes to files where you may change them run at once. Every other command waits for their approval on screen, shown as it will run.',
        auto: 'Everything within what they granted runs at once: reading, changes to files, and commands that name only places you may change. A command that names a place you may only read is asked.'
      }[level]
      return [
        'The computer',
        '',
        `You can work with the person's files and run commands with your ${tools.tools} tools, within what they granted:`,
        ...lines,
        'Some places are never reached, whatever they granted: keys and credentials (such as ~/.ssh, ~/.aws, ~/.git-credentials), browser profiles, password stores, and the app’s own data. Do not try them.',
        '',
        'How each use is decided:',
        `- ${asking}`,
        askDestroying
          ? '- A command that deletes, formats, shuts the computer down, changes permissions, the registry or services, force-stops a process, or rewrites git history is always asked, whatever they chose, and is never covered for the session.'
          : '- They chose not to have what deletes or changes the system asked every time: a command that deletes, formats, shuts the computer down, changes permissions, the registry or services, force-stops a process, or rewrites git history follows the level above, like any other command. Take the same care as if they were watching.',
        askPublishing
          ? '- A command that puts something before others, beyond this computer, is always asked too, whatever they chose: a git push, a package published, a release, a pull request, an issue or a comment, a deployment. They may allow it for the session.'
          : '- They chose not to have what publishes asked every time: a git push, a package published, a release, a pull request, an issue or a comment, or a deployment follows the level above, like any other command.',
        ...networkLines({ askNetwork, askLocalNetwork, askSending, allowedHosts, refusedHosts }),
        `- When a card asks them, your call returns once they answered${approvalWait === null ? '' : `, or after ${approvalWait} minutes without an answer, which counts as a no`}. They can allow it once, or for the session: the same program and subcommand (git commit, npm run, python), or any change in the same folder, then runs at once until the app quits.`,
        '- Every use is checked first against what they granted. A command is checked by the paths it names, with ~, variables and .. read: one that names a place outside, or a place never reached, is refused before anyone is asked. This reads what the command names, not what a program works out once it runs, so never use a command to reach around it: name the places you work on.',
        ...(tools.confines
          ? [
              '- The system also holds each command to what they granted: it can change only the places you may change, and package caches and the temporary folder, and never read a place never reached. A command that fails for it ("Operation not permitted", "Read-only file system", "Access is denied") was held there, and is never run outside: say what it needed, and that they can grant it in Settings, Access.'
            ]
          : []),
        '- A use that is refused comes back with the reason: tell them in a sentence, and that they can grant more in Settings, Access.',
        '',
        'The web tools are for looking things up and reading pages. Commands may use the network when the task needs it: downloading what the person asked for, calling an API, installing a package, reaching a device on their network. Such a command is decided like any other command that changes something.',
        tools.use,
        `file_write keeps a document with the conversation, to show and download. When the person wants a file on their computer, in your folder or one of theirs, write it there with ${tools.write}.`,
        'The person sees every use in Settings, Activity, and can put back a file you changed or move one you created to the trash. A command cannot be undone.',
        'When they give you a folder or a file by voice, call computer_grant with its path; they confirm on screen.'
      ].join('\n')
    },

    projects() {
      if (!computer) return []
      return access()
        .places.filter((place) => place.kind === 'folder' && place.write)
        .map((place) => place.path)
    },

    neverReached: (path) => neverReached(path)?.label,

    reaches: (path, write = false) => computer !== undefined && !neverReached(path) && covered(path, write),

    worked(thread, folder) {
      // Reading is left out: it changes nothing, and is quickly done again. What changed, ran or was refused is kept.
      const uses = activity
        .read(Number.MAX_SAFE_INTEGER)
        .uses.filter((use) => use.thread === thread && (use.action !== 'read' || use.decision === 'refused'))
        .slice(0, WORKED_LINES)
        .reverse()
      if (uses.length === 0) return undefined
      return uses.map((use) => `- ${workedLine(use, (path) => relative(path, folder))}`).join('\n')
    },

    version: () => {
      const { workspace, places, computer: reach } = access()
      return JSON.stringify([workspace, places, reach, computer?.workspace ?? null])
    },

    hear(said, spoken) {
      if (stopsEverything(said)) {
        stopEverything()
        return true
      }
      return approvals.hear(said, spoken)
    },

    ask: (question, showing, signal) => approvals.ask(question, showing, signal),

    async set({ confirmationPhrase, ...given }) {
      // The phrase is kept as a fingerprint only: it is never stored, shown, or told to a session.
      const phrase = typeof confirmationPhrase === 'string' ? phraseOf(confirmationPhrase) : null
      if (phrase === undefined) return { ok: false, error: { code: 'invalid-input', message: `A confirmation phrase has ${MIN_PHRASE_WORDS} words at least.` } }
      const asked: AccessChange = confirmationPhrase === undefined ? given : { ...given, confirmation: phrase }
      if (asked.places === undefined) return { ok: true, settings: settings.setAccess(asked) }
      if (!computer) return { ok: false, error: { code: 'invalid-input', message: 'This assistant runs where it cannot reach files.' } }
      const places: Place[] = []
      for (const place of asked.places) {
        const found = await computer.locate(place.path)
        if (!found) return { ok: false, error: { code: 'invalid-input', message: `There is no folder or file at ${place.path}.` } }
        if (!places.some((known) => known.path === found.path)) places.push({ path: found.path, kind: found.kind, write: place.write })
      }
      return { ok: true, settings: settings.setAccess({ ...asked, places }) }
    },

    standingRules: () => ({
      allowances: allowances.list(),
      protected: (computer?.protected ?? []).map((place) => ({ label: place.label, path: place.path ?? `*${place.ending ?? ''}` }))
    }),

    forget: (allowance) => allowances.forget(allowance),

    record: (use) => activity.record(use).id,

    report: (use, outcome) => void report(use, outcome),

    activity: (limit, before) => activity.read(limit, before),

    undo: (use, anyway) => activity.undo(use, anyway),

    diff: (of) => activity.diff(of),

    versions: (path) => activity.versions(path),

    restore: (use, path, side) => activity.restore(use, path, side),

    check: () => activity.check(),

    exportActivity: () => activity.export(),

    changes: (turns) => activity.changes(turns),

    stopEverything,

    onStopEverything(listener) {
      stopping.add(listener)
      return () => void stopping.delete(listener)
    },

    onEvent(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
  }
}

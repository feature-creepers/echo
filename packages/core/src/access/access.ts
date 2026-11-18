import type { AccessUse, Allowance, CommandInput, Event, Place, ProtectedPlace } from '@repo/protocol'
import { z } from 'zod'
import type { Blobs } from '../ports/blobs.ts'
import type { Timers } from '../ports/clock.ts'
import type { Computer } from '../ports/computer.ts'
import type { ComputerUse, Reach, Scope, Verdict } from '../ports/harness.ts'
import type { Records } from '../ports/records.ts'
import { fromFolder } from '../projects/folders.ts'
import type { SettingsChange, UserSettings } from '../settings/settings.ts'
import type { Tool } from '../tools/tools.ts'
import type { Screen, Showing } from '../views/screen.ts'
import { type Activity, createActivity, type NewUse, type UndoResult } from './activity.ts'
import { createAllowances } from './allowances.ts'
import { type Answer, type Answered, type Approvals, createApprovals, type Question } from './approvals.ts'
import { type CommandReading, readCommand } from './commands.ts'
import { isLocalNetwork, isLoopback, listedHost } from './hosts.ts'
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
   * folder to work in.
   */
  grant(asked: { path: string; write: boolean; purpose?: 'grant' | 'work' }, showing: Showing): Promise<Granted>
  /** What a thread is told about its access, as it stands now. */
  standing(): string | undefined
  /** The folders the person lets the assistant change, besides its own: where it may work on a project. */
  projects(): string[]
  /**
   * Whether a place is within reach now, for reading or, with `write`, for changing, and not a place never reached.
   * Read from its words: what the core reads itself, such as a project's instructions, it reads only from there.
   */
  reaches(path: string, write?: boolean): boolean
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
  /** Something the person said, which may answer a question on screen, or stop everything. True when it did. */
  hear(said: string): boolean
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

/** How many of a thread's uses it is reminded of when a new session carries on its work. */
const WORKED_LINES = 40

/** The last part of a path, and the folder it is in, whatever the system's separator. */
const parts = (path: string) => {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at < 0 ? { name: path, folder: '' } : { name: path.slice(at + 1) || path, folder: path.slice(0, at) || path.slice(0, at + 1) }
}

/** Whether a path is a place or inside it, by its words. The harness checks for real, links followed. */
const inside = (path: string, place: string) => {
  const trim = (value: string) => value.replace(/[\\/]+$/, '')
  const [one, other] = [trim(path), trim(place)]
  return one === other || one.startsWith(`${other}/`) || one.startsWith(`${other}\\`)
}

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

/** Keeps nothing: for a core with no records, which has no computer either. */
const NO_RECORDS: Records = { append: () => [], read: () => [] }
const NO_VERSIONS: Blobs = { put: () => '', get: () => undefined }

export function createAccess({ settings, screen, computer, timers, records, versions, now = () => new Date(), newId }: AccessOptions): AccessControl {
  const access = () => settings.read().access
  const approvals = createApprovals({ screen, timers, wait: () => access().approvalWait })
  let ids = 0
  const nextId = newId ?? (() => `use-${++ids}`)
  const allowances = createAllowances({ newId: nextId, now, destroyingAsked: () => access().askDestroying })
  const activity: Activity = createActivity({ records: records ?? NO_RECORDS, versions: versions ?? NO_VERSIONS, computer, now, newId: nextId })
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

  /** The place never reached that a path is in, if any. A place inside one that is reached all the same is not. */
  const neverReached = (path: string) =>
    computer?.protected.find((place) => place.path !== undefined && inside(path, place.path) && !(place.except ?? []).some((open) => inside(path, open)))

  /** Where a path is, said for the person: the assistant's own folder by that name. */
  const where = (path: string) => (computer && inside(path, computer.workspace) ? "The assistant's folder" : path)

  const question = (use: ComputerUse, reading: CommandReading | undefined, offerSession: boolean): Question => {
    const path = use.paths[0] ?? ''
    const { name, folder } = parts(path)
    const session = (text: string) => (offerSession ? { session: text } : {})
    switch (use.action) {
      case 'run': {
        const keys = reading?.keys ?? []
        const { askDestroying, askPublishing } = access()
        const guard = reading ? networkGuard(reading, access()) : undefined
        const note = reading?.destructive
          ? {
              text: `It deletes or overwrites something for good, or changes the system.${askDestroying ? ' This is always asked.' : ''}`,
              tone: 'danger' as const
            }
          : reading?.publishes
            ? { text: `It puts something before others, beyond this computer.${askPublishing ? ' This is always asked.' : ''}`, tone: 'soft' as const }
            : reading && reading.sends.length > 0
              ? { text: `${sendsWords(reading.sends, reading.hosts)}${guard ? ' This is always asked.' : ''}`, tone: 'soft' as const }
              : reading?.network
                ? { text: `${reachesWords(reading.hosts)}${guard ? ' This is always asked.' : ''}`, tone: 'soft' as const }
                : reading?.opaque
                  ? { text: 'Part of what it runs cannot be read in advance.', tone: 'soft' as const }
                  : undefined
        return {
          heading: 'Run this command?',
          subject: 'On your computer',
          command: use.command ?? '',
          facts: [{ label: 'In', value: where(path) }],
          ...(note ? { note } : {}),
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
          ...session(`Any change in ${folderName(folder)} until you quit`)
        }
      default:
        return {
          heading: use.paths.length > 1 ? `Change these ${use.paths.length} files?` : 'Change this file?',
          subject: use.paths.length > 1 ? use.paths.map((one) => parts(one).name).join(', ') : name,
          facts: [{ label: 'In', value: where(folder) }],
          allow: 'Change it',
          ...session(`Any change in ${folderName(folder)} until you quit`)
        }
    }
  }

  /** A folder named for the person: the assistant's folder by that name, any other by its last part. */
  const folderName = (folder: string) => (computer && inside(folder, computer.workspace) ? "the assistant's folder" : parts(folder).name || folder)

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
    return { allow: true, use: recorded.id }
  }

  const stopEverything = () => {
    approvals.withdraw()
    allowances.clear()
    for (const listener of [...stopping]) listener()
  }

  /** A place within reach: found first, never one that is never reached, and asked of the person unless it already is. */
  const grant = async (
    { path, write, purpose = 'grant' }: { path: string; write: boolean; purpose?: 'grant' | 'work' },
    showing: Showing
  ): Promise<Granted> => {
    if (!computer) return { ok: false, text: 'This assistant runs where it cannot reach files.' }
    const found = await computer.locate(path)
    if (!found) return { ok: false, text: `There is nothing at ${path}. Ask the person where it is.` }
    if (purpose === 'work' && found.kind !== 'folder') return { ok: false, text: `${found.path} is a file: a project is a folder.` }
    // A place never reached is not given either. A folder that holds one may be: what is inside stays refused.
    const never = neverReached(found.path)
    if (never) return { ok: false, text: `${found.path} holds ${never.label.toLowerCase()}, which is never reached, whatever is granted.` }
    const current = scope()
    const covered =
      current.computer === 'write' ||
      (current.computer === 'read' && !write) ||
      current.places.some((place) => inside(found.path, place.path) && (place.write || !write))
    if (covered) return { ok: true, path: found.path, kind: found.kind, already: true }
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
    const places = access().places.filter((place) => place.path !== found.path)
    settings.setAccess({ places: [...places, { path: found.path, kind: found.kind, write }] })
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
        report: (use, outcome) => void activity.outcome(use, outcome)
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

    standing() {
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
        "You can work with the person's files and run commands with your Read, Glob, Grep, Write, Edit and Bash tools, within what they granted:",
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
        ...(computer?.confines
          ? [
              '- The system also holds each command to what they granted: it can change only the places you may change, and package caches and the temporary folder, and never read a place never reached. A command that fails for it ("Operation not permitted", "Read-only file system") was held there, and is never run outside: say what it needed, and that they can grant it in Settings, Access.'
            ]
          : []),
        '- A use that is refused comes back with the reason: tell them in a sentence, and that they can grant more in Settings, Access.',
        '',
        'The web tools are for looking things up and reading pages. Commands may use the network when the task needs it: downloading what the person asked for, calling an API, installing a package, reaching a device on their network. Such a command is decided like any other command that changes something.',
        'Look with Read, Glob and Grep, change with Write and Edit, and use Bash for what these cannot do; a command that only reads runs at once, so prefer one when looking is all you need.',
        'file_write keeps a document with the conversation, to show and download. When the person wants a file on their computer, in your folder or one of theirs, write it there with Write.',
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

    reaches(path, write = false) {
      if (!computer || neverReached(path)) return false
      const current = scope()
      return (
        current.computer === 'write' ||
        (current.computer === 'read' && !write) ||
        current.places.some((place) => inside(path, place.path) && (place.write || !write))
      )
    },

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

    hear(said) {
      if (stopsEverything(said)) {
        stopEverything()
        return true
      }
      return approvals.hear(said)
    },

    ask: (question, showing, signal) => approvals.ask(question, showing, signal),

    async set(asked) {
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

    report: (use, outcome) => void activity.outcome(use, outcome),

    activity: (limit, before) => activity.read(limit, before),

    undo: (use, anyway) => activity.undo(use, anyway),

    diff: (of) => activity.diff(of),

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

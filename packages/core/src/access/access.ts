import type { CommandInput, Place } from '@repo/protocol'
import { z } from 'zod'
import type { Timers } from '../ports/clock.ts'
import type { Computer } from '../ports/computer.ts'
import type { ComputerUse, Reach, Scope, Verdict } from '../ports/harness.ts'
import type { SettingsChange, UserSettings } from '../settings/settings.ts'
import type { Tool } from '../tools/tools.ts'
import type { Screen, Showing } from '../views/screen.ts'
import { type Answer, createApprovals, type Question } from './approvals.ts'

/**
 * What the assistant may reach on the person's computer, and the questions it asks before acting there
 * (docs/SPEC.md, section 12.2).
 *
 * The person grants: the assistant's own folder, folders and files read only or read and write, or the
 * whole computer. The harness checks every use of its own tools against that and refuses what falls outside;
 * what falls inside comes here, and a change or a command waits for the person's approval unless they chose
 * to trust the assistant within what they granted. A command can reach beyond any folder, so it is always
 * approved, unless the whole computer was given to change.
 */
export interface AccessControl {
  /** The computer as a thread reaches it, its questions going where `showing` says. Nothing when the core has no computer. */
  reach(showing: () => Showing): Reach | undefined
  /** The tool a thread asks for a folder or a file with, when the person gives one by voice. */
  tools(showing: () => Showing): Tool[]
  /** What a thread is told about its access, as it stands now. */
  standing(): string | undefined
  /** Changes when what a session is given changes: it is then opened again, with the new access. */
  version(): string
  /** Something the person said, which may answer a question on screen. True when it did. */
  hear(said: string): boolean
  /** Change the access, checking each new place exists. */
  set(asked: CommandInput<'access.set'>): Promise<SettingsChange>
}

export interface AccessOptions {
  settings: UserSettings
  screen: Screen
  /** The computer the core runs on. Left out, the assistant reaches no file: a core with no computer of its own. */
  computer?: Computer | undefined
  timers?: Timers | undefined
}

const grantInput = z.object({ path: z.string().trim().min(1).max(4096), write: z.boolean().default(false) })

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

const REFUSED: Record<Exclude<Answer, 'yes'>, string> = {
  no: 'The person said no. Do not try it again unless they ask.',
  'moved-on': 'The person moved on to something else without answering, so it was not done.',
  stopped: 'The turn was stopped, so it was not done.',
  unanswered: 'No answer came, so it was not done. Ask again if it still matters.'
}

export function createAccess({ settings, screen, computer, timers }: AccessOptions): AccessControl {
  const approvals = createApprovals({ screen, timers })
  const access = () => settings.read().access

  const scope = (): Scope => {
    const { workspace, places, computer: reach } = access()
    const home = computer && workspace ? computer.workspace : undefined
    return { places: [...(home ? [{ path: home, kind: 'folder' as const, write: true }] : []), ...places], computer: reach, home }
  }

  /** Where a path is, said for the person: the assistant's own folder by that name. */
  const where = (path: string) => (computer && inside(path, computer.workspace) ? "The assistant's folder" : path)

  const question = (use: ComputerUse): Question => {
    const path = use.paths[0] ?? ''
    const { name, folder } = parts(path)
    switch (use.action) {
      case 'run':
        return {
          heading: 'Run this command?',
          subject: 'On your computer',
          command: use.command ?? '',
          facts: [{ label: 'In', value: where(path) }],
          allow: 'Run it'
        }
      case 'delete':
        return { heading: 'Delete this file?', subject: name, facts: [{ label: 'In', value: where(folder) }], allow: 'Delete it' }
      case 'create':
        return { heading: 'Create this file?', subject: name, facts: [{ label: 'In', value: where(folder) }], allow: 'Create it' }
      default:
        return { heading: 'Change this file?', subject: name, facts: [{ label: 'In', value: where(folder) }], allow: 'Change it' }
    }
  }

  return {
    reach(showing) {
      if (!computer) return undefined
      return {
        scope,
        async approve(use, signal): Promise<Verdict> {
          const { approvals: policy, computer: reach } = access()
          if (use.action === 'read') return { allow: true }
          // Trusted within what was granted; a command still asks, as it can reach beyond, unless all of the computer was given.
          if (policy === 'trust' && (use.action !== 'run' || reach === 'write')) return { allow: true }
          const answer = await approvals.ask(question(use), showing(), signal)
          return answer === 'yes' ? { allow: true } : { allow: false, reason: REFUSED[answer] }
        }
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
            const found = await computer.locate(asked.data.path)
            if (!found) return { ok: false, text: `There is nothing at ${asked.data.path}. Ask the person where it is.` }
            const { write } = asked.data
            const current = scope()
            const covered =
              current.computer === 'write' ||
              (current.computer === 'read' && !write) ||
              current.places.some((place) => inside(found.path, place.path) && (place.write || !write))
            if (covered) return { ok: true, text: `${found.path} is already within your reach.` }
            const answer = await approvals.ask(
              {
                heading: found.kind === 'folder' ? 'Give access to this folder?' : 'Give access to this file?',
                subject: found.path,
                facts: [{ label: 'Access', value: write ? 'Read and change' : 'Read only' }],
                allow: 'Give access'
              },
              showing()
            )
            if (answer !== 'yes') return { ok: false, text: REFUSED[answer] }
            const places = access().places.filter((place) => place.path !== found.path)
            settings.setAccess({ places: [...places, { path: found.path, kind: found.kind, write }] })
            return { ok: true, text: `Granted: ${found.path}, ${write ? 'read and write' : 'read only'}. You can use it now.` }
          }
        }
      ]
    },

    standing() {
      if (!computer) return undefined
      const { places, computer: reach, approvals: policy, workspace } = access()
      const lines = [
        ...(workspace ? [`- Your own folder, ${computer.workspace}: read and write. A file you put on the computer goes there unless they say where.`] : []),
        ...places.map((place) => `- ${place.path} (${place.kind}): ${place.write ? 'read and write' : 'read only'}.`),
        reach === 'off' ? '- Nothing else of the computer.' : `- The rest of the computer: ${reach === 'write' ? 'read and write' : 'read only'}.`
      ]
      if (!workspace && places.length === 0 && reach === 'off') {
        return "The computer\n\nYou have no access to the person's files. If they want you to work with some, they can grant a folder in Settings, Access, or tell you which one: then call computer_grant."
      }
      return [
        'The computer',
        '',
        "You can work with the person's files with your Read, Glob, Grep, Write, Edit and Bash tools, within what they granted:",
        ...lines,
        policy === 'ask'
          ? 'Every change and every command waits for their approval on screen, where it is shown as it will be done: call the tool, which returns once they answered.'
          : `You may change files within what they granted without asking.${reach === 'write' ? '' : ' A command still waits for their approval on screen, shown as it will run.'}`,
        'file_write keeps a document with the conversation, to show and download. When the person wants a file on their computer, in your folder or one of theirs, write it there with Write.',
        "These tools are for the person's files and for what they ask you to do on their computer, nothing else: never use them to reach the web, to check a link or a stream, or to look something up. The web tools do that.",
        'Look with Read, Glob and Grep, change with Write and Edit, and use Bash only for what these cannot do. A use outside what they granted is refused with the reason: tell them in a sentence, and that they can grant more in Settings, Access.',
        'When they give you a folder or a file by voice, call computer_grant with its path; they confirm on screen.'
      ].join('\n')
    },

    version: () => JSON.stringify([access(), computer?.workspace ?? null]),

    hear: (said) => approvals.hear(said),

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
    }
  }
}

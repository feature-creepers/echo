import type { Exchange, Thread } from '@repo/protocol'
import { z } from 'zod'
import type { Timers } from '../ports/clock.ts'
import { cutText } from '../text.ts'
import type { ThreadRegistry } from '../threads/registry.ts'
import type { Tool } from '../tools/tools.ts'
import type { Abilities } from './abilities.ts'
import type { Runtime } from './turn.ts'

/** The names of the tools a thread shares out its work with, to sub-threads of its own (docs/SPEC.md, section 7.3). */
const OPEN_TOOL = 'subthread_open'
const SEND_TOOL = 'subthread_send'
const WAIT_TOOL = 'subthread_wait'

/** How many sub-threads a thread may have at work at once: enough to share out a piece of work, few enough to follow. */
export const SUBTHREADS_AT_ONCE = 4

/** How long a thread waits for its sub-threads at most, in minutes, before it is told which are still at work. */
const WAIT_MINUTES = 10
const WAIT_MINUTES_MAX = 30

/** How much of a sub-thread's result the thread that opened it is given, in characters. */
const RESULT_KEPT = 20_000

const openInput = z.object({
  title: z.string().trim().min(1).max(80),
  request: z.string().trim().min(1).max(20_000),
  folder: z.string().trim().min(1).max(4096).optional()
})
const sendInput = z.object({ thread: z.string().min(1), request: z.string().trim().min(1).max(20_000) })
const waitInput = z.object({
  threads: z
    .array(z.string().min(1))
    .max(SUBTHREADS_AT_ONCE * 4)
    .optional(),
  minutes: z.number().positive().max(WAIT_MINUTES_MAX).optional()
})

export interface SubthreadsOptions {
  registry: ThreadRegistry
  /** The transcript, where each sub-thread's result is kept. */
  transcript: readonly Exchange[]
  /** Time passing, for a wait to end by itself. Left out, a thread waits until its sub-threads are done. */
  timers: Timers | undefined
  /** Have a folder of the person's to work in, for a sub-thread asked to work elsewhere. */
  workIn: Abilities['workIn']
  /** Hand a sub-thread a request of its thread's, answered as soon as it is free. */
  handTo(runtime: Runtime, thread: Thread, request: string): void
  /** Resolves once a thread has nothing left to answer. */
  idle(thread: string): Promise<void>
}

/** The sub-threads a topic's thread shares out its work with: the tools it does so with, and what it has not read yet. */
export interface Subthreads {
  /** The tools a topic's thread shares out its work with. */
  tools(runtime: Runtime): Tool[]
  /** A thread's own sub-threads: all of them, or those at work or with a result it has not read. */
  of(thread: string, which?: 'all' | 'pending'): Thread[]
  /** A sub-thread finished a request: its result waits for the thread that opened it to read it. */
  finished(thread: string): void
  /** What a thread is told of its sub-threads at work, or done since it last read them, when it starts on a request. */
  note(thread: string): string
}

/**
 * A topic's thread shares out a large piece of work (docs/SPEC.md, section 7.3) to sub-threads of its own, each
 * working at the same time with the thread's tools, in its folder for a project, which it gives more to do and waits
 * for. A sub-thread answers the thread, never the person.
 */
export function createSubthreads({ registry, transcript, timers, workIn, handTo, idle }: SubthreadsOptions): Subthreads {
  /** Sub-threads whose result the thread that opened them has not read yet: it is given them when it waits for them. */
  const unread = new Set<string>()

  const of = (thread: string, which: 'all' | 'pending' = 'all') =>
    registry
      .read()
      .threads.filter(
        (other) => other.kind === 'subthread' && other.parent === thread && (which === 'all' || other.state === 'working' || unread.has(other.id))
      )

  /** What a sub-thread found: its full answer, or what it wrote, and how it ended. */
  const resultOf = (thread: Thread): string => {
    const line = transcript.findLast((one) => one.thread === thread.id && one.outcome !== 'running')
    if (!line) return `${thread.id} "${thread.title}": no result.`
    const kept = cutText((line.written ?? line.replied).trim(), RESULT_KEPT)
    const ended = line.outcome === 'failed' ? ` (it failed${line.problem ? `: ${line.problem}` : ''})` : line.outcome === 'stopped' ? ' (it was stopped)' : ''
    return `${thread.id} "${thread.title}"${ended}:\n${kept === '' ? '(It gave no result.)' : kept}`
  }

  const tools = (runtime: Runtime): Tool[] => {
    const mine = (id: string) => {
      const thread = registry.get(id)
      return thread?.kind === 'subthread' && thread.parent === runtime.thread ? thread : undefined
    }
    const listing = () => {
      const own = of(runtime.thread)
      return own.length === 0
        ? 'You have no sub-thread.'
        : `Your sub-threads: ${own.map((one) => `${one.id} "${one.title}" (${one.state === 'working' ? 'at work' : 'idle'})`).join('; ')}.`
    }
    const full = () =>
      of(runtime.thread).filter((one) => one.state === 'working').length >= SUBTHREADS_AT_ONCE
        ? `You already have ${SUBTHREADS_AT_ONCE} sub-threads at work, the most at once. Wait for them with ${WAIT_TOOL} first.`
        : undefined
    return [
      {
        definition: {
          name: OPEN_TOOL,
          description: `Hand part of your work to a sub-thread: a thread of its own, with your tools, that works on it at the same time as you, in your folder for a project. Give it a short title and a complete request, since it knows only what you tell it. It never speaks to the person: carry on with your own part, then call ${WAIT_TOOL} for what it found. ${SUBTHREADS_AT_ONCE} at work at once at most.`,
          inputSchema: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Its part of the work, in a few words.' },
              request: { type: 'string', description: 'What to do, completely: what it is for, what to find or change, and what to give back.' },
              folder: {
                type: 'string',
                description:
                  'A folder of the person to work in, other than yours: absolute, or from ~. Left out, yours. The person is asked first when it is not one they let you change.'
              }
            },
            required: ['title', 'request']
          }
        },
        async run(input) {
          const turn = runtime.answering
          const asked = openInput.safeParse(input)
          if (!turn) return { ok: false, text: 'There is no work under way to share out.' }
          if (!asked.success) return { ok: false, text: `${OPEN_TOOL} takes a title and the request, and a folder for work elsewhere.` }
          const refused = full()
          if (refused) return { ok: false, text: refused }
          let folder = registry.get(runtime.thread)?.folder
          if (asked.data.folder !== undefined) {
            if (!workIn || !runtime.showing) return { ok: false, text: 'There is no computer to work on here.' }
            const found = await workIn(asked.data.folder, runtime.showing())
            if (!found.ok) return { ok: false, text: found.text }
            folder = found.folder
          }
          if (runtime.answering !== turn || turn.stopped) return { ok: false, text: 'Your work was stopped: open nothing more.' }
          const thread = registry.open({ title: asked.data.title, kind: 'subthread', parent: runtime.thread, folder })
          handTo(runtime, thread, asked.data.request)
          return {
            ok: true,
            text: `Sub-thread ${thread.id} "${thread.title}" is at work. Carry on with your own part, then call ${WAIT_TOOL} for what it found.`
          }
        }
      },
      {
        definition: {
          name: SEND_TOOL,
          description: `Give one of your sub-threads more to do: it does it once it is done with what it is doing, remembering its earlier work. Then call ${WAIT_TOOL} for what it found.`,
          inputSchema: {
            type: 'object',
            properties: {
              thread: { type: 'string', description: `The sub-thread's id, as ${OPEN_TOOL} gave it.` },
              request: { type: 'string', description: 'What to do next, completely.' }
            },
            required: ['thread', 'request']
          }
        },
        run(input) {
          const asked = sendInput.safeParse(input)
          if (!runtime.answering) return { ok: false, text: 'There is no work under way to share out.' }
          const thread = asked.success ? mine(asked.data.thread) : undefined
          if (!asked.success || !thread) return { ok: false, text: `There is no such sub-thread of yours. ${listing()}` }
          const busy = thread.state === 'working'
          const refused = busy ? undefined : full()
          if (refused) return { ok: false, text: refused }
          handTo(runtime, thread, asked.data.request)
          return {
            ok: true,
            text: busy
              ? `Sub-thread ${thread.id} does it once it is done with what it is doing. Call ${WAIT_TOOL} for what it found.`
              : `Sub-thread ${thread.id} is at work on it. Call ${WAIT_TOOL} for what it found.`
          }
        }
      },
      {
        definition: {
          name: WAIT_TOOL,
          description: `Wait until your sub-threads are done, and read what they found: each one's result, whole. Left out, all of yours at work or with a result you have not read. Gives back after ${WAIT_MINUTES} minutes at most, or the minutes you say, saying which are still at work: call it again to go on waiting.`,
          inputSchema: {
            type: 'object',
            properties: {
              threads: { type: 'array', items: { type: 'string' }, description: 'The sub-threads to wait for, by id.' },
              minutes: { type: 'number', description: `How long to wait at most, up to ${WAIT_MINUTES_MAX}.` }
            }
          }
        },
        async run(input) {
          const turn = runtime.answering
          const asked = waitInput.safeParse(input ?? {})
          if (!turn) return { ok: false, text: 'There is no work under way.' }
          if (!asked.success) return { ok: false, text: `${WAIT_TOOL} takes the sub-threads to wait for, by id, and the minutes to wait at most.` }
          const unknown = (asked.data.threads ?? []).filter((id) => mine(id) === undefined)
          if (unknown.length > 0) return { ok: false, text: `Not sub-threads of yours: ${unknown.join(', ')}. ${listing()}` }
          const awaited = asked.data.threads ?? of(runtime.thread, 'pending').map((one) => one.id)
          if (awaited.length === 0) return { ok: true, text: `Nothing to wait for. ${listing()}` }
          let cancel: (() => void) | undefined
          await Promise.race([
            Promise.all(awaited.map(idle)),
            new Promise<void>((resolve) => {
              cancel = timers?.after((asked.data.minutes ?? WAIT_MINUTES) * 60_000, resolve)
            }),
            new Promise<void>((resolve) => turn.stopping.push(resolve))
          ])
          cancel?.()
          if (turn.stopped) return { ok: false, text: 'Your work was stopped, and your sub-threads with it.' }
          const threads = awaited.flatMap((id) => mine(id) ?? [])
          const done = threads.filter((one) => one.state !== 'working')
          const still = threads.filter((one) => one.state === 'working')
          for (const one of done) unread.delete(one.id)
          return {
            ok: true,
            text: [
              ...done.map(resultOf),
              still.length > 0 ? `Still at work: ${still.map((one) => `${one.id} "${one.title}"`).join(', ')}. Call ${WAIT_TOOL} again to go on waiting.` : ''
            ]
              .filter(Boolean)
              .join('\n\n')
          }
        }
      }
    ]
  }

  return {
    tools,
    of,
    finished: (thread) => void unread.add(thread),
    note(thread) {
      const pending = of(thread, 'pending')
      if (pending.length === 0) return ''
      const lines = pending.map((other) => `${other.id} "${other.title}" (${other.state === 'working' ? 'at work' : 'done, not read yet'})`)
      return `\n\n(Your sub-threads: ${lines.join('; ')}. Call ${WAIT_TOOL} for what they found before you rely on their part.)`
    }
  }
}

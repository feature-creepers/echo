import type { Thread, TurnId } from '@repo/protocol'
import { z } from 'zod'
import type { ToolResult } from '../ports/tools.ts'
import type { ThreadRegistry } from '../threads/registry.ts'
import type { Tool } from '../tools/tools.ts'
import type { Screen } from '../views/screen.ts'
import type { Abilities } from './abilities.ts'
import type { Turn } from './turn.ts'

const openInput = z.object({
  title: z.string().trim().min(1).max(80),
  kind: z.enum(['topic', 'aside']).default('topic'),
  request: z.string().optional(),
  folder: z.string().trim().min(1).max(4096).optional()
})
const sendInput = z.object({ thread: z.string().min(1), request: z.string().optional(), wait: z.boolean().optional() })
const focusInput = z.object({ thread: z.string().min(1) })

export interface RoutingOptions {
  registry: ThreadRegistry
  screen: Screen
  /** Have a folder of the person's for a project's thread to work in. */
  workIn: Abilities['workIn']
  /** The turn the orchestrator is deciding about. */
  deciding(): Turn | undefined
  /** The request a thread is answering now. */
  answering(thread: string): Turn | undefined
  /** What a thread is answering now, in a few words. */
  doing(thread: string): string | undefined
  /** What a thread is about, from the summary sleep wrote. */
  summaryOf(thread: string): string | undefined
  /** Pass a request on to a thread, which answers it as soon as it is free. */
  passOn(turn: Turn, thread: Thread, request: string, aside?: boolean): ToolResult
  /** Bring a topic back, with what of its answer was not heard yet. */
  bringBack(thread: Thread): { turn: TurnId; sentences: string[] } | undefined
  /** Say a sentence of a turn. */
  say(turn: Turn, sentence: string): void
}

/**
 * The tools the orchestrator passes each turn on with (docs/SPEC.md, section 7): to a new thread, to one that exists,
 * or back to an earlier topic.
 */
export function routingTools({ registry, screen, workIn, deciding, answering, doing, summaryOf, passOn, bringBack, say }: RoutingOptions): Tool[] {
  return [
    {
      definition: {
        name: 'thread_open',
        description:
          'Open a new thread and pass it what the person said. kind "topic" for something to work on, "aside" for a quick side question that needs a search, a tool or the screen: it is answered beside the topic on screen, which stays there. For work on a project, a code repository or a folder of files the person works on with you, give `folder`: the thread works there.',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'The topic in a few words.' },
            kind: { type: 'string', enum: ['topic', 'aside'] },
            request: { type: 'string', description: 'What to pass on. Left out, what the person said.' },
            folder: {
              type: 'string',
              description: 'For a project: its folder, absolute or from ~. The person is asked on screen first when it is not one they let you change.'
            }
          },
          required: ['title']
        }
      },
      async run(input) {
        const turn = deciding()
        const asked = openInput.safeParse(input)
        if (!turn) return { ok: false, text: 'There is nothing to pass on.' }
        if (!asked.success) return { ok: false, text: 'thread_open takes a title, a kind ("topic" or "aside"), a request, and for a project its folder.' }
        if (turn.next) return { ok: false, text: 'This has already been passed on. Write nothing more.' }
        let folder: string | undefined
        if (asked.data.folder !== undefined) {
          if (!workIn) return { ok: false, text: 'Projects cannot be worked on here: there is no computer to work on.' }
          const found = await workIn(asked.data.folder, { thread: undefined, turn: turn.exchange.turn, focused: true })
          if (!found.ok) return { ok: false, text: `${found.text} Tell the person in a sentence.` }
          if (deciding() !== turn || turn.stopped) return { ok: false, text: 'The person moved on. Write nothing more.' }
          folder = found.folder
        }
        // A side question is a topic of its own, answered beside the topic on the stage, which keeps the focus. With no
        // topic on the stage, there is nothing to answer it beside: it takes the stage as any topic. A project is
        // never a side question.
        const beside = registry.focused()
        const aside = folder === undefined && asked.data.kind === 'aside' && beside !== undefined && screen.current() !== undefined
        const thread = registry.open({ title: asked.data.title, kind: 'topic', beside: aside ? beside.id : undefined, folder })
        return passOn(turn, thread, asked.data.request ?? turn.exchange.said, aside)
      }
    },
    {
      definition: {
        name: 'thread_send',
        description: 'Pass what the person said to an existing thread, which answers it.',
        inputSchema: {
          type: 'object',
          properties: {
            thread: { type: 'string', description: 'The thread id, from the list.' },
            request: { type: 'string', description: 'What to pass on. Left out, what the person said.' },
            wait: { type: 'boolean', description: 'For a thread at work: let this wait until it is done, rather than run beside it.' }
          },
          required: ['thread']
        }
      },
      run(input) {
        const turn = deciding()
        const asked = sendInput.safeParse(input)
        if (!turn) return { ok: false, text: 'There is nothing to pass on.' }
        const found = asked.success ? registry.get(asked.data.thread) : undefined
        // A sub-thread answers the thread that opened it, never the person: what they say goes to that thread.
        const thread = found?.kind === 'subthread' && found.parent !== undefined ? registry.get(found.parent) : found
        if (!asked.success || !thread) return { ok: false, text: `There is no such thread. The threads are:\n${registry.index(doing, summaryOf)}` }
        // A thread at work answers one thing at a time: what is sent to it waits until it is done. Unless the request
        // follows from that work, it is better run beside it, in a thread of its own.
        const busyWith = answering(thread.id)
        if (busyWith && busyWith !== turn && asked.data.wait !== true) {
          const on = doing(thread.id)
          return {
            ok: false,
            text: `Not sent: thread ${thread.id} is working now${on ? ` on: ${on}` : ''}, and would answer this only once that is done. If it continues that work or must come after it, call thread_send again with wait: true. Otherwise call thread_open, with the same folder for a project, so it runs at the same time.`
          }
        }
        return passOn(turn, thread, asked.data.request ?? turn.exchange.said)
      }
    },
    {
      definition: {
        name: 'thread_focus',
        description:
          'Bring an earlier topic back on screen, or one marked ready when the person asks for it. Then say in a few words that it is back, unless told its answer is being said.',
        inputSchema: { type: 'object', properties: { thread: { type: 'string' } }, required: ['thread'] }
      },
      run(input) {
        const turn = deciding()
        const asked = focusInput.safeParse(input)
        const thread = asked.success ? registry.get(asked.data.thread) : undefined
        if (thread?.kind !== 'topic') return { ok: false, text: `There is no such topic. The threads are:\n${registry.index()}` }
        const missed = bringBack(thread)
        if (!turn || !missed || missed.sentences.length === 0) return { ok: true, text: `"${thread.title}" is on screen.` }
        // An answer that finished out of sight is said now, in this turn, after what was already written.
        for (const sentence of turn.cutter.flush()) say(turn, sentence)
        for (const sentence of missed.sentences) say(turn, sentence)
        return { ok: true, text: `"${thread.title}" is on screen, and the part of its answer not heard yet is being said. Write nothing more.` }
      }
    }
  ]
}

import { CLEAR_TOOL, MEDIA_TOOL, SHOW_TOOL } from '@repo/catalog'
import type { Exchange, Thread } from '@repo/protocol'
import { z } from 'zod'
import type { Records } from '../ports/records.ts'
import type { ThreadRegistry } from '../threads/registry.ts'
import type { Tool } from '../tools/tools.ts'
import { RESUME, RESUMES_WITHOUT_THE_PERSON, resumesInARow } from './resume.ts'
import type { Subthreads } from './subthreads.ts'
import type { Runtime, Turn } from './turn.ts'

/** The name of the tool a thread writes its full answer with. */
const ANSWER_TOOL = 'answer_write'

/** The name of the tool a thread reads what the other threads are doing with. */
const BESIDE_TOOL = 'threads_beside'

/** The name of the tool a thread asks to be woken with when the app opens again. */
const RESUME_TOOL = 'resume_after_restart'

/** The tools a thread calls only once it has said its short answer. */
export const SPOKEN_FIRST = new Set([SHOW_TOOL, ANSWER_TOOL])

/** The screen's tools: a view, clearing it, and the player. A sub-thread, which nobody watches, is not given these. */
const SCREEN_TOOLS = new Set([SHOW_TOOL, CLEAR_TOOL, MEDIA_TOOL])

const answerInput = z.object({ text: z.string().trim().min(1) })
const resumeInput = z.object({ request: z.string().trim().min(1).max(4000) })

export interface ThreadToolsOptions {
  registry: ThreadRegistry
  records: Records
  newId: () => string
  /** The transcript, which says how often a thread carried on by itself after a restart. */
  transcript: readonly Exchange[]
  subthreads: Subthreads
  /** The thread whose work a thread does: a sub-thread's is the thread that opened it. */
  ownerOf(thread: string): string
  /** What a thread is answering now, in a few words. */
  doing(thread: string): string | undefined
  /** Where a thread works: its project's folder, or its copy of it. */
  placeOf(thread: Thread): string | undefined
  /** The files the request a thread is answering changed so far. */
  touched(thread: string): readonly string[]
  /** The full answer of a turn, written for reading: kept on its line and told to the clients. */
  written(turn: Turn, text: string): void
}

/** A thread's own tools, beside those the core gives it: for its full answer, the other threads, and restarts. */
export interface ThreadTools {
  /** The tools a thread works with: those it is given and its own. A sub-thread's leave out the screen. */
  toolsOf(runtime: Runtime, kind: Thread['kind'], given: readonly Tool[]): Tool[]
  /** What a project's thread is told, when it starts on a request, of the other threads at work in its folder. */
  besideIn(thread: Thread): string
}

export function createThreadTools({
  registry,
  records,
  newId,
  transcript,
  subthreads,
  ownerOf,
  doing,
  placeOf,
  touched,
  written
}: ThreadToolsOptions): ThreadTools {
  /**
   * The full answer, for reading. What a thread writes as text is spoken, so it is short; what it found, whole,
   * goes through this tool once the spoken answer has started, and waits in the side sheet.
   */
  const answerTool = (runtime: Runtime): Tool => ({
    definition: {
      name: ANSWER_TOOL,
      description:
        'Keep the full answer, written for reading, beside the short one you say aloud: complete, in Markdown, with the figures, sources and details. The person reads it only if they want to. Call it after you have started speaking, and not for small talk or a one-line answer.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', description: 'The full answer, in Markdown.' } },
        required: ['text']
      }
    },
    run(input) {
      const turn = runtime.answering
      const asked = answerInput.safeParse(input)
      if (!turn) return { ok: false, text: 'There is no answer under way.' }
      if (!asked.success) return { ok: false, text: `${ANSWER_TOOL} takes the full answer as text.` }
      written(turn, asked.data.text)
      return { ok: true, text: 'Kept for the person to read. Do not mention it.' }
    }
  })

  /** The other threads at work now, wherever they work: what each answers, and the files it changed so far. */
  const besideTool = (runtime: Runtime): Tool => ({
    definition: {
      name: BESIDE_TOOL,
      description:
        "What the other threads are doing now: each one at work, the folder it works in (the project's own, or a copy of its own), what it is answering and the files it changed so far. Call it before you commit, push or build, and before anything that restarts the app you run in, so that you neither undo nor cut short their work.",
      inputSchema: { type: 'object', properties: {} }
    },
    run() {
      const others = registry.read().threads.filter((other) => other.id !== runtime.thread && other.state === 'working')
      if (others.length === 0) return { ok: true, text: 'No other thread is at work.' }
      const mine = registry.get(runtime.thread)
      const own = mine && placeOf(mine)
      const lines = others.map((other) => {
        const files = touched(other.id)
        const place = placeOf(other)
        const copied = place !== undefined && place !== other.folder
        const where =
          place === undefined
            ? ''
            : copied
              ? ` in ${place}${place === own ? ' (your folder)' : ''}, a copy of ${other.folder}${other.copy ? ` on the branch ${other.copy.branch}` : ''}`
              : ` in ${place}${place === own ? ' (your folder)' : place === mine?.folder ? " (the project's own folder, which yours is a copy of)" : ''}`
        const answering = doing(other.id)
        const yours = other.kind === 'subthread' && other.parent === runtime.thread ? ', your sub-thread' : ''
        return [
          `- "${other.title}"${yours}${where}`,
          answering ? `  answering: ${answering}` : '',
          files.length > 0 ? `  changed so far: ${files.slice(-20).join(', ')}` : '  changed no file so far'
        ]
          .filter(Boolean)
          .join('\n')
      })
      return {
        ok: true,
        text: `${lines.join('\n')}\nLeave their files alone and commit only yours. Restarting or updating the app you run in cuts their work short: while they work, do it only if the person asked, and call ${RESUME_TOOL} first.`
      }
    }
  })

  /** Ask to be woken when the app opens again, with what to carry on with: for a thread about to restart it. */
  const resumeTool = (runtime: Runtime): Tool => ({
    definition: {
      name: RESUME_TOOL,
      description:
        'Before you do something that restarts the app you run in (installing a new build of it, for instance), say what to carry on with once it opens again: you are then woken with it, without the person having to tell you. Work cut short by a restart is taken up again by itself; this is for what comes after, such as checking the new build and going on with the plan.',
      inputSchema: {
        type: 'object',
        properties: { request: { type: 'string', description: 'What to do once the app has opened again, as the person would ask it.' } },
        required: ['request']
      }
    },
    run(input) {
      const asked = resumeInput.safeParse(input)
      if (!asked.success) return { ok: false, text: `${RESUME_TOOL} takes what to carry on with, as text.` }
      if (resumesInARow(transcript, ownerOf(runtime.thread)) >= RESUMES_WITHOUT_THE_PERSON)
        return {
          ok: false,
          text: `You have already carried this work on by yourself across ${RESUMES_WITHOUT_THE_PERSON} restarts since the person last spoke to you. Do not restart the app: say where the work stands, write your report, and wait for them.`
        }
      records.append([{ type: RESUME, payload: { id: newId(), thread: runtime.thread, request: asked.data.request } }])
      return { ok: true, text: 'Kept: when the app opens again, you are woken with it.' }
    }
  })

  /**
   * The voice comes first: a call to show or to write the full answer before anything was said is sent back once,
   * asking for the short answer first. The model then speaks at once, and keeps that order for the rest of its
   * thread. A project's thread that worked and goes straight to its report has not said how the work went: that
   * is asked for once too. A second call is always taken, so nothing is ever lost.
   */
  const speakFirst = (runtime: Runtime, tool: Tool): Tool => ({
    definition: tool.definition,
    run(input) {
      const turn = runtime.answering
      if (turn && !turn.urged && turn.sentences.size === 0 && turn.exchange.replied === '') {
        turn.urged = true
        return {
          ok: false,
          text: `Nothing has been said yet. Write the short spoken answer first, as text, then call ${tool.definition.name} again with the same input.`
        }
      }
      if (turn && !turn.urged && tool.definition.name === ANSWER_TOOL && turn.working && turn.sentences.size === turn.saidBeforeWork) {
        turn.urged = true
        return {
          ok: false,
          text: `You have not said how the work went. Say it in a sentence or two, as plain text, then call ${ANSWER_TOOL} again with the same input.`
        }
      }
      return tool.run(input)
    }
  })

  return {
    // A topic shares out its work to sub-threads. A sub-thread has no screen and speaks to no one: its full answer is
    // its result, and it opens no sub-thread of its own, so work never fans out beyond what the person can follow.
    toolsOf(runtime, kind, given) {
      if (kind === 'subthread') return [...given.filter((tool) => !SCREEN_TOOLS.has(tool.definition.name)), answerTool(runtime), besideTool(runtime)]
      return [...given, answerTool(runtime), besideTool(runtime), resumeTool(runtime), ...subthreads.tools(runtime)].map((tool) =>
        SPOKEN_FIRST.has(tool.definition.name) ? speakFirst(runtime, tool) : tool
      )
    },

    besideIn(thread) {
      // A thread in a copy of its own shares its folder with no other, but for its own sub-threads.
      const place = placeOf(thread)
      if (place === undefined) return ''
      const others = registry
        .read()
        .threads.filter((other) => other.id !== thread.id && placeOf(other) === place && other.state === 'working')
        .map((other) => {
          const answering = doing(other.id)
          return `"${other.title}"${answering ? `, on: ${answering}` : ''}`
        })
      if (others.length === 0) return ''
      return `\n\n(Other threads are working in this folder at the same time: ${others.join('; ')}. Change only what your task needs, leave their files alone, and commit only your own changes, naming each file. Call ${BESIDE_TOOL} to see where they stand before you commit, and before anything that restarts the app.)`
    }
  }
}

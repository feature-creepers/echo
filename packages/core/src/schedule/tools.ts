import { JOB_REQUEST_MAX_LENGTH, JOB_SENTENCE_MAX_LENGTH, JOB_TITLE_MAX_LENGTH, type Job, LANGUAGE_CODES, languageSchema } from '@repo/protocol'
import { z } from 'zod'
import { keywordsOf } from '../memory/searchable.ts'
import type { ToolResult } from '../ports/tools.ts'
import { languageOf } from '../speech/language.ts'
import type { Tool } from '../tools/tools.ts'
import { isWaiting, type Schedule } from './schedule.ts'
import { readTiming, TIMING_INPUT_SCHEMA, timingWords } from './timing.ts'

/** The tools that set, list, change and cancel reminders and scheduled tasks (docs/SPEC.md, section 7.10). */
export const SCHEDULE_CREATE_TOOL = 'schedule_create'
export const SCHEDULE_LIST_TOOL = 'schedule_list'
export const SCHEDULE_UPDATE_TOOL = 'schedule_update'
export const SCHEDULE_CANCEL_TOOL = 'schedule_cancel'

/** What every session with the schedule's tools is told about them. */
export const SCHEDULE_INSTRUCTIONS = [
  `Reminders and scheduled tasks. Tools: ${SCHEDULE_CREATE_TOOL}, ${SCHEDULE_LIST_TOOL}, ${SCHEDULE_UPDATE_TOOL}, ${SCHEDULE_CANCEL_TOOL}.`,
  '- Set one only when the person asks for it ("remind me…", "every morning, tell me…", "in ten minutes, check…"). Never offer one.',
  '- A reminder is a sentence you will say at the time, written now, short, in the language you are speaking: "It\'s eight: time to feed the cat." A task is a request you will carry out at the time, as if the person had just asked it: "Give me the weather in Lyon."',
  '- The timing is on the person\'s clock, from the line with the moment: a local date and time for once, "inMinutes" for "in 10 minutes", or a repeat (daily, weekdays, weekly on days, monthly on a day, every few hours between two times).',
  '- When the time could mean two things (morning or evening, which day), ask in one short question before setting it. "At 8" said in the evening for tonight is clear; said at 9 in the morning, ask.',
  '- Once set, confirm it in one short sentence, with the time as a person says it: "Okay, 8:00 tomorrow: feed the cat." Nothing more.',
  `- To change, pause or cancel one, use ${SCHEDULE_UPDATE_TOOL} or ${SCHEDULE_CANCEL_TOOL}; ${SCHEDULE_LIST_TOOL} says what is set.`,
  '- A scheduled task runs while the person may be away: when it needs their approval, the question waits on screen as usual, and unanswered it counts as no.'
].join('\n')

/** What the orchestrator is told on top: it handles these itself, at once, since they need no screen and no research. */
export const SCHEDULE_ROUTING =
  'Reminders and scheduled tasks are yours to set, change and cancel with the schedule tools, in one short sentence: do not pass them to a thread.'

/** How many waiting jobs a list gives. */
const LISTED = 30

const createInput = z.object({
  kind: z.enum(['reminder', 'task']),
  title: z.string().trim().min(1).max(JOB_TITLE_MAX_LENGTH),
  sentence: z.string().trim().min(1).max(JOB_SENTENCE_MAX_LENGTH).optional(),
  request: z.string().trim().min(1).max(JOB_REQUEST_MAX_LENGTH).optional(),
  language: languageSchema.optional(),
  timing: z.unknown()
})

const updateInput = z.object({
  job: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(JOB_TITLE_MAX_LENGTH).optional(),
  sentence: z.string().trim().min(1).max(JOB_SENTENCE_MAX_LENGTH).optional(),
  request: z.string().trim().min(1).max(JOB_REQUEST_MAX_LENGTH).optional(),
  timing: z.unknown().optional(),
  paused: z.boolean().optional()
})

const cancelInput = z.object({ job: z.string().min(1).max(64).optional(), description: z.string().trim().min(1).max(200).optional() })

const refuse = (text: string): ToolResult => ({ ok: false, text })

export interface ScheduleToolsOptions {
  schedule: Schedule
  now: () => Date
  zone: () => string
}

/** The tools of the schedule, for any session: the orchestrator sets a reminder itself, and so can a thread. */
export function scheduleTools({ schedule, now, zone }: ScheduleToolsOptions): Tool[] {
  /** A job in one line, for a model: its id, what it is, and when it rings. */
  const line = (job: Job) => {
    const next = job.next === undefined ? undefined : Date.parse(job.next)
    const what = job.kind === 'reminder' ? `reminder "${job.title}"` : `task "${job.title}": ${job.request ?? ''}`
    const state = job.state === 'paused' ? ' (paused)' : ''
    return `- [${job.id}] ${what}, ${timingWords(job.timing, next, now().getTime(), zone())}${state}`
  }

  /** The waiting jobs whose words match a description best, best first. */
  const match = (description: string): Job[] => {
    const words = keywordsOf(description)
    const scored = schedule
      .read()
      .jobs.filter(isWaiting)
      .map((job) => {
        const text = keywordsOf(`${job.title} ${job.sentence ?? ''} ${job.request ?? ''}`)
        return { job, score: words.filter((word) => text.some((known) => known.startsWith(word) || word.startsWith(known))).length }
      })
      .filter((scored) => scored.score > 0)
    const best = Math.max(0, ...scored.map((one) => one.score))
    return scored.filter((one) => one.score === best).map((one) => one.job)
  }

  return [
    {
      definition: {
        name: SCHEDULE_CREATE_TOOL,
        description:
          'Set a reminder (a sentence you will say at the time) or a task (a request you will carry out at the time), once or repeating, because the person asked. Answers with when it rings, to confirm in one short sentence.',
        inputSchema: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['reminder', 'task'] },
            title: { type: 'string', description: 'A few words for the list and the notification, in the person\'s language: "Feed the cat".' },
            sentence: { type: 'string', description: 'For a reminder: what you will say at the time, in the language you are speaking.' },
            request: { type: 'string', description: 'For a task: what to carry out at the time, as the person would ask it.' },
            language: { type: 'string', description: 'The two-letter code of the language you are speaking: "en", "fr".' },
            timing: TIMING_INPUT_SCHEMA
          },
          required: ['kind', 'title', 'timing']
        }
      },
      run(input) {
        const asked = createInput.safeParse(input)
        if (!asked.success) return refuse(`Give "kind" (reminder or task), a "title" of ${JOB_TITLE_MAX_LENGTH} characters at most, and a "timing".`)
        const { kind, title, sentence, request, timing: written } = asked.data
        if (kind === 'reminder' && sentence === undefined) return refuse('A reminder needs "sentence": what you will say at the time.')
        if (kind === 'task' && request === undefined) return refuse('A task needs "request": what to carry out at the time.')
        const timing = readTiming(written, now().getTime(), zone())
        if (!timing.ok) return refuse(timing.problem)
        const language = asked.data.language ?? languageOf(sentence ?? request ?? title, LANGUAGE_CODES, undefined)
        const set = schedule.create({ kind, title, sentence, request, language, timing: timing.timing })
        if (!set.ok) return refuse(set.problem)
        return { ok: true, text: `Set [${set.job.id}]: ${line(set.job).replace(/^- \[[^\]]+\] /, '')}. Confirm it in one short sentence.` }
      }
    },
    {
      definition: {
        name: SCHEDULE_LIST_TOOL,
        description: 'List the reminders and tasks set, with their ids, the next to ring first.',
        inputSchema: { type: 'object', properties: {} }
      },
      run() {
        const waiting = schedule.read().jobs.filter(isWaiting)
        if (waiting.length === 0) return { ok: true, text: 'Nothing is set.' }
        const more = waiting.length > LISTED ? `\n…and ${waiting.length - LISTED} more.` : ''
        const held = schedule.held() ? 'Everything is paused: nothing rings until the person resumes it on the Reminders page.\n' : ''
        return { ok: true, text: `${held}${waiting.slice(0, LISTED).map(line).join('\n')}${more}` }
      }
    },
    {
      definition: {
        name: SCHEDULE_UPDATE_TOOL,
        description: 'Change a reminder or task: its words, its timing, or pause and resume it. What is left out stays as it is.',
        inputSchema: {
          type: 'object',
          properties: {
            job: { type: 'string', description: 'Its id, from the list.' },
            title: { type: 'string' },
            sentence: { type: 'string', description: 'For a reminder: what you will say at the time.' },
            request: { type: 'string', description: 'For a task: what to carry out at the time.' },
            timing: TIMING_INPUT_SCHEMA,
            paused: { type: 'boolean', description: 'True to pause it, false to resume it.' }
          },
          required: ['job']
        }
      },
      run(input) {
        const asked = updateInput.safeParse(input)
        if (!asked.success) return refuse('Give the id of the job as "job", and what changes.')
        const { job, timing: written, ...rest } = asked.data
        const timing = written === undefined ? undefined : readTiming(written, now().getTime(), zone())
        if (timing && !timing.ok) return refuse(timing.problem)
        const changed = schedule.change(job, { ...rest, ...(timing?.ok ? { timing: timing.timing } : {}) })
        if (!changed.ok) return refuse(`${changed.problem} The jobs are:\n${schedule.read().jobs.filter(isWaiting).map(line).join('\n') || 'none.'}`)
        return { ok: true, text: `Changed: ${line(changed.job).replace(/^- /, '')}. Confirm it in one short sentence.` }
      }
    },
    {
      definition: {
        name: SCHEDULE_CANCEL_TOOL,
        description: 'Cancel a reminder or task for good, because the person asked. Give its id when you know it, or describe it.',
        inputSchema: {
          type: 'object',
          properties: {
            job: { type: 'string', description: 'Its id, from the list.' },
            description: { type: 'string', description: 'What it is about, when you do not know its id: "the cat".' }
          }
        }
      },
      run(input) {
        const asked = cancelInput.safeParse(input)
        if (!asked.success || (asked.data.job === undefined && asked.data.description === undefined)) {
          return refuse('Give the id of the job as "job", or what it is about as "description".')
        }
        const found =
          asked.data.job !== undefined
            ? [schedule.get(asked.data.job)].filter((job): job is Job => job !== undefined && isWaiting(job))
            : match(asked.data.description ?? '')
        const [only, ...others] = found
        if (!only) return refuse(`Nothing set matches that. The jobs are:\n${schedule.read().jobs.filter(isWaiting).map(line).join('\n') || 'none.'}`)
        // More than one could be meant: the model chooses, and asks the person if it cannot tell.
        if (others.length > 0) return refuse(`Several could be meant. Call again with the id of the right one:\n${found.map(line).join('\n')}`)
        schedule.remove([only.id])
        return { ok: true, text: `Cancelled: ${only.title}. Say so in a few words.` }
      }
    }
  ]
}

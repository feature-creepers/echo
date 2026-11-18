import { DEFAULT_APPROVAL_WAIT } from '@repo/protocol'
import type { Timers } from '../ports/clock.ts'
import type { Signal } from '../ports/harness.ts'
import type { Screen, Showing } from '../views/screen.ts'
import { answerOf } from './words.ts'

/** What the person is asked: a short question, what it is about, and what it would do. */
export interface Question {
  /** "Create a file?" */
  heading: string
  /** What it is about, in a few words: the file's name, the folder. */
  subject: string
  /** Facts that help decide: where, how much. */
  facts?: { label: string; value: string }[]
  /** A command line, shown as it would run. */
  command?: string
  /** What the person should know before answering: it destroys, it reaches the network. */
  note?: { text: string; tone: 'warn' | 'danger' | 'soft' }
  /** The label of the button that says yes. */
  allow?: string
  /** What a yes for the session would cover, in a few words. Left out, the card offers yes and no only. */
  session?: string
}

export type Answer = 'yes' | 'session' | 'no' | 'moved-on' | 'stopped' | 'unanswered'

/** An answer, and whether it came from a button of the card rather than from words said or typed. */
export interface Answered {
  answer: Answer
  pressed: boolean
}

export interface Approvals {
  /** Show the question as a card where `showing` says, and wait for the person's answer. */
  ask(question: Question, showing: Showing, signal?: Signal): Promise<Answered>
  /**
   * The person said something. A yes or a no answers the latest question waiting, and is theirs to take;
   * anything else while a question waits means they moved on, and the question goes. True when it was an answer.
   */
  hear(said: string): boolean
  /** Withdraw every question waiting: the person stopped everything. */
  withdraw(): void
}

const MINUTE_MS = 60_000

/** What the buttons of a card say, so a press is heard as the answer it is. */
const YES = 'Allow'
const SESSION = 'Allow for the session'
const NO = "Don't allow"
const BUTTONS = new Set([YES, SESSION, NO])

/** A fence for a command written in Markdown, longer than any run of backticks inside it. */
const fenced = (command: string) => {
  const fence = '`'.repeat(Math.max(3, ...[...command.matchAll(/`+/g)].map((run) => run[0].length + 1)))
  return `${fence}\n${command}\n${fence}`
}

/**
 * Questions the person answers before the assistant acts: a change to their files, a command, a folder to
 * give. Each is a card composed from the generic blocks of the catalogue, with a button for each answer;
 * pressing one, or saying yes, yes for the session, or no, answers it. The card goes once answered.
 */
export function createApprovals({
  screen,
  timers,
  wait = () => DEFAULT_APPROVAL_WAIT
}: {
  screen: Screen
  timers?: Timers | undefined
  /** How many minutes a question waits before it is taken as a no, as the person set it; `null` until they answer. */
  wait?: () => number | null
}): Approvals {
  const waiting: { view: string | undefined; settle(answer: Answer, pressed?: boolean): void }[] = []

  return {
    ask(question, showing, signal) {
      if (signal?.aborted) return Promise.resolve({ answer: 'stopped', pressed: false })
      const options = [
        { label: question.allow ?? YES, ...(question.session ? { detail: 'Only this time' } : {}), say: YES },
        ...(question.session ? [{ label: 'Allow for this session', detail: question.session, say: SESSION }] : []),
        { label: NO, say: NO }
      ]
      const view = {
        root: 'card',
        elements: {
          card: {
            type: 'Stack',
            props: { gap: 'normal' },
            children: [
              'heading',
              'subject',
              ...(question.facts ? ['facts'] : []),
              ...(question.command ? ['command'] : []),
              ...(question.note ? ['note'] : []),
              'choice'
            ]
          },
          heading: { type: 'Heading', props: { text: question.heading, level: 2 } },
          subject: { type: 'Text', props: { text: question.subject, size: 'large', weight: 'medium' } },
          ...(question.facts ? { facts: { type: 'KeyValue', props: { items: question.facts } } } : {}),
          ...(question.command ? { command: { type: 'Prose', props: { markdown: fenced(question.command) } } } : {}),
          ...(question.note ? { note: { type: 'Text', props: { text: question.note.text, tone: question.note.tone, size: 'small' } } } : {}),
          choice: { type: 'Choice', props: { options } }
        }
      }
      // Its title says it waits; its heading asks.
      const shown = screen.show({ title: 'Waiting for you', view }, showing)
      if (!shown.ok) return Promise.resolve({ answer: 'unanswered', pressed: false })
      const id = screen.latest(showing.thread)?.id

      return new Promise<Answered>((resolve) => {
        const entry = {
          view: id,
          settle(answer: Answer, pressed = false) {
            const at = waiting.indexOf(entry)
            if (at < 0) return
            waiting.splice(at, 1)
            cancelTimer?.()
            signal?.removeEventListener('abort', onAbort)
            // The card has done its work: what the assistant shows next takes its place.
            if (id !== undefined) screen.clear(id)
            // A yes for the session to a card that does not offer one is a yes for this time.
            resolve({ answer: answer === 'session' && !question.session ? 'yes' : answer, pressed })
          }
        }
        const onAbort = () => entry.settle('stopped')
        signal?.addEventListener('abort', onAbort, { once: true })
        const minutes = wait()
        const cancelTimer = minutes === null ? undefined : timers?.after(minutes * MINUTE_MS, () => entry.settle('unanswered'))
        waiting.push(entry)
      })
    },

    hear(said) {
      const latest = waiting.at(-1)
      if (!latest) return false
      const answer = answerOf(said)
      if (answer) {
        // A button sends its own words exactly; anything else was said or typed.
        latest.settle(answer, BUTTONS.has(said))
        return true
      }
      for (const entry of [...waiting]) entry.settle('moved-on')
      return false
    },

    withdraw() {
      for (const entry of [...waiting]) entry.settle('stopped')
    }
  }
}

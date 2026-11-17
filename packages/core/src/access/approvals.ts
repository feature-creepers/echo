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
  /** The label of the button that says yes. */
  allow?: string
}

export type Answer = 'yes' | 'no' | 'moved-on' | 'stopped' | 'unanswered'

export interface Approvals {
  /** Show the question as a card where `showing` says, and wait for the person's answer. */
  ask(question: Question, showing: Showing, signal?: Signal): Promise<Answer>
  /**
   * The person said something. A yes or a no answers the latest question waiting, and is theirs to take;
   * anything else while a question waits means they moved on, and the question goes. True when it was an answer.
   */
  hear(said: string): boolean
}

/** How long a question waits for an answer before it is taken as a no. */
const WAIT_MS = 10 * 60 * 1000

/** What the buttons of a card say, so a press is heard as the answer it is. */
const YES = 'Allow'
const NO = "Don't allow"

/** A fence for a command written in Markdown, longer than any run of backticks inside it. */
const fenced = (command: string) => {
  const fence = '`'.repeat(Math.max(3, ...[...command.matchAll(/`+/g)].map((run) => run[0].length + 1)))
  return `${fence}\n${command}\n${fence}`
}

/**
 * Questions the person answers before the assistant acts: a change to their files, a command, a folder to
 * give. Each is a card composed from the generic blocks of the catalogue, with two buttons; pressing one, or
 * saying yes or no, answers it. The card goes once answered.
 */
export function createApprovals({ screen, timers }: { screen: Screen; timers?: Timers | undefined }): Approvals {
  const waiting: { view: string | undefined; settle(answer: Answer): void }[] = []

  return {
    ask(question, showing, signal) {
      if (signal?.aborted) return Promise.resolve('stopped')
      const view = {
        root: 'card',
        elements: {
          card: {
            type: 'Stack',
            props: { gap: 'normal' },
            children: ['heading', 'subject', ...(question.facts ? ['facts'] : []), ...(question.command ? ['command'] : []), 'choice']
          },
          heading: { type: 'Heading', props: { text: question.heading, level: 2 } },
          subject: { type: 'Text', props: { text: question.subject, size: 'large', weight: 'medium' } },
          ...(question.facts ? { facts: { type: 'KeyValue', props: { items: question.facts } } } : {}),
          ...(question.command ? { command: { type: 'Prose', props: { markdown: fenced(question.command) } } } : {}),
          choice: {
            type: 'Choice',
            props: {
              options: [
                { label: question.allow ?? YES, say: YES },
                { label: NO, say: NO }
              ]
            }
          }
        }
      }
      // Its title says it waits; its heading asks.
      const shown = screen.show({ title: 'Waiting for you', view }, showing)
      if (!shown.ok) return Promise.resolve('unanswered')
      const id = screen.latest(showing.thread)?.id

      return new Promise<Answer>((resolve) => {
        const entry = {
          view: id,
          settle(answer: Answer) {
            const at = waiting.indexOf(entry)
            if (at < 0) return
            waiting.splice(at, 1)
            cancelTimer?.()
            signal?.removeEventListener('abort', onAbort)
            // The card has done its work: what the assistant shows next takes its place.
            if (id !== undefined) screen.clear(id)
            resolve(answer)
          }
        }
        const onAbort = () => entry.settle('stopped')
        signal?.addEventListener('abort', onAbort, { once: true })
        const cancelTimer = timers?.after(WAIT_MS, () => entry.settle('unanswered'))
        waiting.push(entry)
      })
    },

    hear(said) {
      const latest = waiting.at(-1)
      if (!latest) return false
      const answer = answerOf(said)
      if (answer) {
        latest.settle(answer)
        return true
      }
      for (const entry of [...waiting]) entry.settle('moved-on')
      return false
    }
  }
}

import type { Access, USE_REASONS } from '@repo/protocol'
import type { AccessControl } from '../access/access.ts'
import type { Answer, Approvals, Question } from '../access/approvals.ts'
import type { ToolResult } from '../ports/tools.ts'
import type { Showing } from '../views/screen.ts'

type Reason = (typeof USE_REASONS)[number]

/** An act on the device, as the core decides it: what the activity keeps, and the card when the person is asked. */
export interface DeviceAct {
  /** The tool, as the activity names it. */
  tool: string
  /** One line for the activity and the side sheet: "Print report.pdf on Brother DCP-9020CDW". */
  line: string
  /** The files or places it touches, absolute. */
  paths: string[]
  question: Question
  /**
   * Asked every time, whatever the level, and never covered for the session: the camera. Otherwise the act follows
   * the level as a command does, asked first at `ask` and `trust`, and a yes for the session covers the same kind.
   */
  always?: boolean
}

export type Decided = { go: true; use: string | undefined } | { go: false; result: ToolResult }

const NOT_DONE: Record<Exclude<Answer, 'yes' | 'session'>, string> = {
  no: 'The person said no, so it was not done. Do not try it again unless they ask.',
  'moved-on': 'The person moved on without answering, so it was not done.',
  stopped: 'Stopped, so it was not done.',
  unanswered: 'No answer came in time, so it was not done. Ask again if it still matters.'
}

const REFUSED: Record<Exclude<Answer, 'yes' | 'session'>, Reason> = {
  no: 'declined',
  'moved-on': 'unanswered',
  stopped: 'stopped',
  unanswered: 'unanswered'
}

export interface DeviceActsOptions {
  ask: Approvals['ask']
  /** The approval level the person chose, read at each act. */
  level: () => Access['approvals']
  /** The activity, where each act is kept beside the uses of files and commands. */
  uses?: Pick<AccessControl, 'record' | 'report'> | undefined
}

export interface DeviceActs {
  /** Decide an act: carried out at once, asked first, or refused; kept in the activity whatever was decided. */
  decide(act: DeviceAct, showing: Showing): Promise<Decided>
  /** Refuse an act before anyone is asked, such as a file outside what the person granted, and keep it in the activity. */
  refuse(act: Pick<DeviceAct, 'tool' | 'line' | 'paths'>, showing: Showing, reason: 'outside' | 'protected', text: string): ToolResult
  /** Carry out what was decided, and keep in the activity how it went. A failure is a result the model reads. */
  carry(use: string | undefined, work: () => Promise<ToolResult>): Promise<ToolResult>
  /** Forget what was allowed for the session: everything was stopped. */
  forget(): void
}

/**
 * How the core decides an act on the device that changes something outside the files: printing, letting a drive go,
 * a picture taken (docs/SPEC.md, section 12.4, more of the device). One rule for all of them, the one a command
 * follows, so the person meets the same cards and the same levels everywhere.
 */
export function createDeviceActs({ ask, level, uses }: DeviceActsOptions): DeviceActs {
  /** The tools a yes for the session covers, until the app quits or everything stops. */
  const allowed = new Set<string>()

  const keep = (act: Pick<DeviceAct, 'tool' | 'line' | 'paths'>, showing: Showing, decision: 'ran' | 'approved' | 'refused', reason: Reason, detail?: string) =>
    uses?.record({
      ...(showing.thread === undefined ? {} : { thread: showing.thread }),
      ...(showing.turn === undefined ? {} : { turn: showing.turn }),
      tool: act.tool,
      action: 'run',
      command: act.line,
      paths: act.paths,
      decision,
      reason,
      ...(detail === undefined ? {} : { detail })
    })

  return {
    async decide(act, showing) {
      if (!act.always) {
        if (level() === 'auto') return { go: true, use: keep(act, showing, 'ran', 'level') }
        if (allowed.has(act.tool)) return { go: true, use: keep(act, showing, 'ran', 'session') }
      }
      const { answer, pressed } = await ask(act.always ? withoutSession(act.question) : act.question, showing)
      if (answer !== 'yes' && answer !== 'session') {
        keep(act, showing, 'refused', REFUSED[answer])
        return { go: false, result: { ok: false, text: NOT_DONE[answer] } }
      }
      if (answer === 'session' && !act.always) allowed.add(act.tool)
      return { go: true, use: keep(act, showing, 'approved', pressed ? 'pressed' : 'said') }
    },
    refuse(act, showing, reason, text) {
      keep(act, showing, 'refused', reason, text)
      return { ok: false, text }
    },
    async carry(use, work) {
      try {
        const result = await work()
        if (use !== undefined) uses?.report(use, result.ok ? { ok: true } : { ok: false, error: result.text.slice(0, 300) })
        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (use !== undefined) uses?.report(use, { ok: false, error: message.slice(0, 300) })
        return { ok: false, text: message }
      }
    },
    forget() {
      allowed.clear()
    }
  }
}

/** A question that offers yes and no only: what is always asked is never allowed for the session. */
function withoutSession({ session: _session, sessionLabel: _label, ...question }: Question): Question {
  return question
}

/** A size in bytes, as a person reads it: "12.3 GB". */
export function sizeOf(bytes: number): string {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit++
  }
  return unit === 0 ? `${value} bytes` : `${value >= 100 ? Math.round(value) : Number(value.toFixed(1))} ${units[unit]}`
}

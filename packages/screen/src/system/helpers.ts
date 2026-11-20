import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { Helper, Questions } from './system.ts'

/** How long a question may take before the helper is taken as stuck, in milliseconds: a large window's tree takes seconds. */
const ANSWER_MS = 30_000

const TOO_SLOW = `The app did not answer in ${ANSWER_MS / 1000} seconds: it may be busy. Try again, or look at another window.`

/** A reply of a helper: its answer, or why not, in words a model acts on. */
type Reply = { id?: number; ok: true; value: unknown } | { id?: number; ok: false; error: string }

const replyOf = (line: string): Reply | undefined => {
  try {
    const read = JSON.parse(line) as Reply
    return typeof read === 'object' && read !== null && typeof read.ok === 'boolean' ? read : undefined
  } catch {
    return undefined
  }
}

/** The last lines a helper wrote on its error output, to end a sentence with, or a full stop when it wrote none. */
const said = (errors: string) => (errors.trim() ? `: ${errors.trim().split('\n').slice(-3).join(' ')}` : '.')

/** Keep the end of what a helper writes on its error output: what it said last says why it stopped. */
function keepErrors(running: ChildProcessWithoutNullStreams): () => string {
  let errors = ''
  running.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    errors = (errors + chunk).slice(-2000)
  })
  return () => errors
}

/** A helper process that stays running, and the questions it was asked and has not answered yet. */
interface Running {
  child: ChildProcessWithoutNullStreams
  waiting: Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>
}

/**
 * A helper that stays running and answers JSON lines in order, each carrying its question's number: for a system
 * whose bridge takes long to start, such as PowerShell compiling its calls to the system. Started at the first
 * question; stopped, it starts again at the next.
 */
export function lastingHelper(command: string, args: () => Promise<string[]>): Helper {
  let current: Promise<Running> | undefined
  let asked = 0

  const start = async (ended: () => void): Promise<Running> => {
    const child = spawn(command, await args(), { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    const running: Running = { child, waiting: new Map() }
    const errors = keepErrors(child)
    const fail = (reason: string) => {
      ended()
      for (const one of running.waiting.values()) {
        clearTimeout(one.timer)
        one.reject(new Error(reason))
      }
      running.waiting.clear()
    }
    // Writing to a helper that has just ended fails here rather than in the core: its questions fail when it closes.
    child.stdin.on('error', () => undefined)
    createInterface({ input: child.stdout }).on('line', (line) => {
      const reply = replyOf(line)
      if (reply?.id === undefined) return
      const one = running.waiting.get(reply.id)
      if (!one) return
      running.waiting.delete(reply.id)
      clearTimeout(one.timer)
      if (reply.ok) one.resolve(reply.value)
      else one.reject(new Error(reply.error))
    })
    child.once('error', (error) => fail(`The helper that reads other apps could not start: ${error.message}`))
    child.once('close', () => fail(`The helper that reads other apps stopped${said(errors())}`))
    return running
  }

  /** The helper running, started when there is none. One that ends, or fails to start, is started again at the next question. */
  const running = (): Promise<Running> => {
    if (current) return current
    const forget = () => {
      if (current === opening) current = undefined
    }
    const opening: Promise<Running> = start(forget).catch((error: unknown) => {
      forget()
      throw error
    })
    current = opening
    return opening
  }

  return {
    async ask(name, input) {
      const { child, waiting } = await running()
      const id = ++asked
      return new Promise<Questions[typeof name]['output']>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(id)
          reject(new Error(TOO_SLOW))
        }, ANSWER_MS)
        waiting.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
        child.stdin.write(`${JSON.stringify({ id, name, input })}\n`)
      })
    },
    async close() {
      const closing = current
      current = undefined
      // A helper still starting is let go once it has started, rather than left running with nobody to ask it.
      const helper = await closing?.catch(() => undefined)
      if (!helper || helper.child.exitCode !== null || helper.child.signalCode !== null) return
      await new Promise<void>((resolve) => {
        helper.child.once('close', () => resolve())
        helper.child.stdin.end()
        setTimeout(() => {
          helper.child.kill()
          resolve()
        }, 2000).unref()
      })
    }
  }
}

/**
 * A helper started for each question, given it as JSON on its input and answering one JSON line: for a system whose
 * bridge starts at once, such as `osascript` or Python. Its keys are paths in the tree, so they outlive it.
 */
export function onceHelper(command: string, args: () => Promise<string[]>): Helper {
  return {
    async ask(name, input) {
      const running = spawn(command, await args(), { stdio: ['pipe', 'pipe', 'pipe'] })
      let output = ''
      running.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        output += chunk
      })
      const errors = keepErrors(running)
      running.stdin.on('error', () => undefined)
      running.stdin.end(JSON.stringify({ name, input }))
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          running.kill()
          reject(new Error(TOO_SLOW))
        }, ANSWER_MS)
        running.once('error', (error) => {
          clearTimeout(timer)
          reject(new Error(`The helper that reads other apps could not start: ${error.message}`))
        })
        running.once('close', () => {
          clearTimeout(timer)
          const reply = replyOf(output.trim().split('\n').at(-1) ?? '')
          if (!reply) reject(new Error(`The helper that reads other apps failed${said(errors())}`))
          else if (reply.ok) resolve(reply.value as Questions[typeof name]['output'])
          else reject(new Error(reply.error))
        })
      })
    },
    close: async () => undefined
  }
}

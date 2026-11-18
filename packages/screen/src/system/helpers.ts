import { type ChildProcess, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { Helper, Questions } from './system.ts'

/** How long a question may take before the helper is taken as stuck, in milliseconds: a large window's tree takes seconds. */
const ANSWER_MS = 30_000

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

/**
 * A helper that stays running and answers JSON lines in order, each carrying its question's number: for a system
 * whose bridge takes long to start, such as PowerShell compiling its calls to the system. Started at the first
 * question; stopped, it starts again at the next.
 */
export function lastingHelper(command: string, args: () => Promise<string[]>): Helper {
  let child: ChildProcess | undefined
  let starting: Promise<ChildProcess> | undefined
  let asked = 0
  const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>()

  const fail = (reason: string) => {
    for (const [, one] of waiting) {
      clearTimeout(one.timer)
      one.reject(new Error(reason))
    }
    waiting.clear()
  }

  const start = async (): Promise<ChildProcess> => {
    const running = spawn(command, await args(), { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    let errors = ''
    running.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      errors = (errors + chunk).slice(-2000)
    })
    createInterface({ input: running.stdout as NodeJS.ReadableStream }).on('line', (line) => {
      const reply = replyOf(line)
      if (!reply || reply.id === undefined) return
      const one = waiting.get(reply.id)
      if (!one) return
      waiting.delete(reply.id)
      clearTimeout(one.timer)
      if (reply.ok) one.resolve(reply.value)
      else one.reject(new Error(reply.error))
    })
    running.once('error', (error) => fail(`The helper that reads other apps could not start: ${error.message}`))
    running.once('close', () => {
      if (child === running) child = undefined
      starting = undefined
      fail(`The helper that reads other apps stopped${errors.trim() ? `: ${errors.trim().split('\n').slice(-3).join(' ')}` : '.'}`)
    })
    child = running
    return running
  }

  return {
    async ask(name, input) {
      starting ??= start()
      const running = child ?? (await starting)
      const id = ++asked
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(id)
          reject(new Error(`The app did not answer in ${ANSWER_MS / 1000} seconds: it may be busy. Try again, or look at another window.`))
        }, ANSWER_MS)
        waiting.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
        running.stdin?.write(`${JSON.stringify({ id, name, input })}\n`)
      }) as Promise<Questions[typeof name]['output']>
    },
    async close() {
      const running = child
      child = undefined
      starting = undefined
      if (!running || running.exitCode !== null) return
      await new Promise<void>((resolve) => {
        running.once('close', () => resolve())
        running.stdin?.end()
        setTimeout(() => {
          running.kill()
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
      let errors = ''
      running.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        output += chunk
      })
      running.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        errors = (errors + chunk).slice(-2000)
      })
      running.stdin.end(JSON.stringify({ name, input }))
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          running.kill()
          reject(new Error(`The app did not answer in ${ANSWER_MS / 1000} seconds: it may be busy. Try again, or look at another window.`))
        }, ANSWER_MS)
        running.once('error', (error) => {
          clearTimeout(timer)
          reject(new Error(`The helper that reads other apps could not start: ${error.message}`))
        })
        running.once('close', () => {
          clearTimeout(timer)
          const reply = replyOf(output.trim().split('\n').at(-1) ?? '')
          if (!reply) reject(new Error(`The helper that reads other apps failed${errors.trim() ? `: ${errors.trim().split('\n').slice(-3).join(' ')}` : '.'}`))
          else if (reply.ok) resolve(reply.value as Questions[typeof name]['output'])
          else reject(new Error(reply.error))
        })
      })
    },
    close: async () => undefined
  }
}

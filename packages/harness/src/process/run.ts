import { type ChildProcess, spawn } from 'node:child_process'
import type { Environment } from './environment.ts'
import { platform } from './platform/index.ts'

/** A program, and the arguments that always come before the ones of a given call. */
export interface Command {
  program: string
  leading: string[]
}

interface StartOptions {
  cwd?: string
  env: Environment
}

/** How long a program talked to over its input has to stop by itself once that input is closed, before it is stopped. */
const CLOSE_GRACE_MS = 1500

/** Start a program that is talked to over its standard input and output for as long as it lives. */
export function start(command: Command, args: string[], options: StartOptions): ChildProcess {
  const invocation = platform.invocation(command.program, [...command.leading, ...args])
  const child = spawn(invocation.file, invocation.args, {
    cwd: options.cwd,
    env: options.env,
    shell: invocation.shell,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
  // A program that stopped no longer reads: writing to it is not an error of ours, and its exit is reported on its own.
  child.stdin?.on('error', () => undefined)
  return child
}

/** Close the input of a program started with `start`, which ends a CLI by itself, and stop it if it does not end. */
export function stopGently(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.stdin?.end()
  const timer = setTimeout(() => platform.terminate(child), CLOSE_GRACE_MS)
  timer.unref()
  child.once('exit', () => clearTimeout(timer))
}

interface RunOptions extends StartOptions {
  /** Written to the program's standard input, which is then closed. */
  input?: string
  /** Stop the program and give up after this long. */
  timeoutMs: number
}

interface RunResult {
  /** The exit code. Missing when the program was stopped by a signal. */
  code: number | null
  stdout: string
  stderr: string
}

/** The program was stopped because it took too long. */
export class TimedOut extends Error {}

/** Run a program to its end. A program that ends with an error code is a result, not a rejection: read `code`. */
export function run(command: Command, args: string[], options: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = start(command, args, options)
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      platform.terminate(child)
      reject(new TimedOut(`${command.program} did not finish within ${Math.round(options.timeoutMs / 1000)} seconds.`))
    }, options.timeoutMs)
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
    child.stdin?.end(options.input ?? '', 'utf8')
  })
}

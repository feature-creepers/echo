import { spawn } from 'node:child_process'
import { win32 } from 'node:path'

/** A program of the system to run, as the adapters of the device name it, so each is tested anywhere by its table. */
export interface Program {
  command: string
  args: string[]
  /** Variables the program needs on top of those it inherits. */
  env?: Record<string, string>
}

interface Ran {
  /** Its exit code; nothing when it was ended by a signal. */
  code: number | null
  out: string
  errors: string
}

/**
 * Windows PowerShell, from the system's own folder: a bare name would be looked for in the current folder first,
 * then on the search path, where any program could stand in for it.
 */
export const WINDOWS_POWERSHELL = win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

/**
 * Windows PowerShell running a script of ours: no profile, no prompt, and no policy that stops a script given on
 * the command line. The script is encoded, so no quoting of the command line can change it. An encoded script
 * would report its errors as serialized objects; it reports its first error's message, plainly, instead.
 */
export function powershell(script: string): Program {
  const guarded = `$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'
try {
${script}
} catch { [Console]::Error.Write($_.Exception.Message); exit 1 }`
  return {
    command: WINDOWS_POWERSHELL,
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(guarded, 'utf16le').toString('base64')]
  }
}

/** What a script prints, as Base64 of UTF-8 so every character survives Windows' console, and what a script reads the same way. */
export const POWERSHELL_UTF8 = {
  /** The script's input, read from its standard input. */
  input: '[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()))',
  /** Print `$value` as JSON, with arrays kept arrays. */
  output: (value: string) =>
    `[Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject ${value} -Compress -Depth 4))))`
}

interface RunOptions {
  /** What the program reads on its standard input. */
  input?: string | undefined
  /** How long it may take, in milliseconds, before it is stopped. */
  timeout: number
  /** Said when the program is not installed: what to install. */
  missing?: string | undefined
  /** Said when it took too long. */
  slow?: string | undefined
}

/**
 * Run a program and give back what it printed. Rejects, with a message the model acts on, when it cannot be
 * started or takes too long.
 */
export function runProgram(program: Program, options: RunOptions): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const running = spawn(program.command, program.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, ...program.env }
    })
    const out: Buffer[] = []
    const errors: Buffer[] = []
    const timer = setTimeout(() => {
      running.kill()
      reject(new Error(options.slow ?? `${program.command} did not answer in time.`))
    }, options.timeout)
    running.stdout.on('data', (chunk: Buffer) => out.push(chunk))
    running.stderr.on('data', (chunk: Buffer) => errors.push(chunk))
    running.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      reject(new Error(error.code === 'ENOENT' ? (options.missing ?? `${program.command} was not found.`) : error.message))
    })
    running.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, out: Buffer.concat(out).toString('utf8'), errors: Buffer.concat(errors).toString('utf8') })
    })
    // A program that ends without reading its input is no failure.
    running.stdin.on('error', () => undefined)
    running.stdin.end(options.input ?? '')
  })
}

/** What a program printed when it ran well; nothing when it is not installed, failed or took longer than `timeout` milliseconds. */
export function printedBy(program: Program, timeout: number): Promise<string | undefined> {
  return runProgram(program, { timeout }).then(
    (ran) => (ran.code === 0 ? ran.out : undefined),
    () => undefined
  )
}

/** What a PowerShell script printed as Base64 of UTF-8 JSON, read back. */
export function readPowershellJson(out: string): unknown {
  return JSON.parse(Buffer.from(out.trim(), 'base64').toString('utf8'))
}

/** The first line of what a program said went wrong, short enough for a sentence. */
export function firstError(ran: Ran): string {
  // PowerShell reports a thrown error over several lines, the message first; the rest is where it was thrown.
  const line = ran.errors
    .split(/\r?\n/)
    .map((text) => text.trim())
    .find((text) => text.length > 0)
  return (line ?? `exit ${ran.code}`).slice(0, 300)
}

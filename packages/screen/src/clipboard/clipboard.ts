import { spawn } from 'node:child_process'
import type { Clipboard } from '@repo/core'
import { type ClipboardProgram, type ClipboardSystem, clipboardCommands } from './commands.ts'

/** How long the clipboard's program may take, in milliseconds: it answers at once, or something is wrong. */
const TIMEOUT_MS = 10_000

/** What a missing program means for the person, on Linux, where it must be installed. */
const MISSING: Record<string, string> = {
  'wl-paste': 'This computer has no wl-clipboard: install it (wl-paste, wl-copy) to use the clipboard.',
  'wl-copy': 'This computer has no wl-clipboard: install it (wl-paste, wl-copy) to use the clipboard.',
  xclip: 'This computer has no xclip: install it to use the clipboard.'
}

/** Run a program with `input` on its standard input, and give back what it wrote, or nothing when it says empty. */
function run(program: ClipboardProgram, input: string | undefined): Promise<string> {
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
      reject(new Error('The clipboard did not answer in time.'))
    }, TIMEOUT_MS)
    running.stdout.on('data', (chunk: Buffer) => out.push(chunk))
    running.stderr.on('data', (chunk: Buffer) => errors.push(chunk))
    running.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      reject(new Error(error.code === 'ENOENT' ? (MISSING[program.command] ?? `${program.command} was not found.`) : error.message))
    })
    running.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'))
      else if (code !== null && program.empty?.includes(code)) resolve('')
      else reject(new Error(`The clipboard could not be reached: ${Buffer.concat(errors).toString('utf8').trim().slice(0, 200) || `exit ${code}`}.`))
    })
    running.stdin.end(input ?? '')
  })
}

/** The clipboard of this computer (docs/SPEC.md, section 12.4, more of the device), through its system's own programs. */
export function createClipboard(
  system: ClipboardSystem = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux'
): Clipboard {
  const commands = () => clipboardCommands(system, process.env)
  return {
    async read() {
      const { read } = commands()
      const out = await run(read, undefined)
      return read.encoding === 'base64' ? Buffer.from(out.trim(), 'base64').toString('utf8') : out
    },
    async write(text) {
      const { write } = commands()
      await run(write, write.encoding === 'base64' ? Buffer.from(text, 'utf8').toString('base64') : text)
    }
  }
}

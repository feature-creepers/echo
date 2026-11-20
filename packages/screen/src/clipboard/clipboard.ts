import type { Clipboard } from '@repo/core'
import { firstError, runProgram } from '../program.ts'
import { type SystemName, THIS_SYSTEM } from '../system-name.ts'
import { type ClipboardProgram, clipboardCommands } from './commands.ts'

/** How long the clipboard's program may take, in milliseconds: it answers at once, or something is wrong. */
const TIMEOUT_MS = 10_000

/** Run one of the clipboard's programs, and give back what it wrote, or nothing when it says the clipboard is empty. */
async function run(program: ClipboardProgram, input?: string): Promise<string> {
  const ran = await runProgram(program, { input, timeout: TIMEOUT_MS, missing: program.missing, slow: 'The clipboard did not answer in time.' })
  if (ran.code === 0) return ran.out
  if (ran.code !== null && program.empty?.includes(ran.code)) return ''
  throw new Error(`The clipboard could not be reached: ${firstError(ran)}.`)
}

/** The clipboard of this computer (docs/SPEC.md, section 12.4, more of the device), through its system's own programs. */
export function createClipboard(system: SystemName = THIS_SYSTEM): Clipboard {
  // The session is read at each use: on Linux, whether it is Wayland's decides the programs.
  const commands = () => clipboardCommands(system, process.env)
  return {
    async read() {
      const { read } = commands()
      const out = await run(read)
      return read.encoding === 'base64' ? Buffer.from(out.trim(), 'base64').toString('utf8') : out
    },
    async write(text) {
      const { write } = commands()
      await run(write, write.encoding === 'base64' ? Buffer.from(text, 'utf8').toString('base64') : text)
    }
  }
}

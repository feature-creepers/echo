import { access, mkdir } from 'node:fs/promises'
import { join, parse } from 'node:path'
import type { Printers } from '@repo/core'
import { firstError, readPowershellJson, runProgram } from '../program.ts'
import { type SystemName, THIS_SYSTEM } from '../system-name.ts'
import * as unix from './unix.ts'
import * as win32 from './win32.ts'

/** How long the list of printers may take, in milliseconds. */
const LIST_TIMEOUT_MS = 20_000
/** How long a job may take to reach the system's queue, in milliseconds: a long PDF is drawn page by page first. */
const PRINT_TIMEOUT_MS = 5 * 60_000

export interface PrintersOptions {
  /** Where a printer that makes files (Microsoft Print to PDF) writes them: a folder of the assistant's own. */
  files: string
  system?: SystemName
}

/** A free name for a file in a folder, like the file printed: "report.pdf", then "report (2).pdf". */
async function freeName(folder: string, wanted: string): Promise<string> {
  const { name, ext } = parse(wanted)
  for (let count = 1; ; count++) {
    const candidate = join(folder, count === 1 ? `${name}${ext}` : `${name} (${count})${ext}`)
    try {
      await access(candidate)
    } catch {
      return candidate
    }
  }
}

/**
 * The printers of this computer (docs/SPEC.md, section 12.4, more of the device), through each system's own means:
 * .NET's printing from Windows PowerShell on Windows, CUPS's `lpstat` and `lp` on macOS and Linux.
 */
export function createPrinters({ files, system = THIS_SYSTEM }: PrintersOptions): Printers {
  if (system === 'win32') {
    const list = async () => {
      const ran = await runProgram(win32.LIST, { timeout: LIST_TIMEOUT_MS, slow: 'Windows did not list its printers in time.' })
      if (ran.code !== 0) throw new Error(`Windows could not list its printers: ${firstError(ran)}`)
      return win32.readPrinters(readPowershellJson(ran.out) as win32.WindowsPrinter[])
    }
    return {
      list,
      async print(job) {
        const printer = (await list()).find((one) => one.name === job.printer)
        let file: string | undefined
        if (printer?.output === 'file') {
          await mkdir(files, { recursive: true })
          file = await freeName(files, `${parse(job.path).name}${win32.fileEnding(job.printer)}`)
        }
        const input = Buffer.from(JSON.stringify({ ...job, ...(file === undefined ? {} : { file }) }), 'utf8').toString('base64')
        const ran = await runProgram(win32.PRINT, { input, timeout: PRINT_TIMEOUT_MS, slow: 'The printing took too long and was stopped.' })
        if (ran.code !== 0) throw new Error(`It was not printed: ${firstError(ran)}`)
        const { pages } = readPowershellJson(ran.out) as { pages?: number }
        return { ...(typeof pages === 'number' ? { pages } : {}), ...(file === undefined ? {} : { file }) }
      }
    }
  }
  return {
    async list() {
      const ran = await runProgram(unix.LIST, { timeout: LIST_TIMEOUT_MS, missing: unix.MISSING, slow: 'CUPS did not list its printers in time.' })
      if (ran.code !== 0) {
        if (unix.noPrinters(ran.errors)) return []
        throw new Error(`The printers could not be listed: ${firstError(ran)}`)
      }
      return unix.readPrinters(ran.out)
    },
    async print(job) {
      const ran = await runProgram(unix.printProgram(job), { timeout: PRINT_TIMEOUT_MS, missing: unix.MISSING })
      if (ran.code !== 0) throw new Error(`It was not printed: ${firstError(ran)}`)
      return {}
    }
  }
}

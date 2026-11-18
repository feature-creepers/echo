import type { Printer, PrintJob } from '@repo/core'
import type { Program } from '../program.ts'

/** What lpstat and lp say is read in English, whatever the person's language. */
const ENGLISH = { LANG: 'C', LC_ALL: 'C' }

/** Said when CUPS is missing, on a Linux that has no printing system. */
export const MISSING = 'This computer has no printing system: install CUPS to print.'

/** The printers CUPS knows and how each stands, then the default one: on macOS and Linux alike. */
export const LIST: Program = { command: 'lpstat', args: ['-p', '-d'], env: ENGLISH }

/**
 * The printers, as the core sees them, from what lpstat printed: a line per printer ("printer Office is idle.",
 * "printer Office now printing Office-12.", "printer Old disabled since…") and one for the default destination.
 * A printer of CUPS puts paper out; one that makes files (CUPS-PDF) writes them where its own settings say.
 */
export function readPrinters(out: string): Printer[] {
  const chosen = /^system default destination: (\S+)/m.exec(out)?.[1]
  const printers: Printer[] = []
  for (const line of out.split(/\r?\n/)) {
    const found = /^printer (\S+) (.*)$/.exec(line)
    if (!found?.[1] || printers.some((printer) => printer.name === found[1])) continue
    const said = found[2] ?? ''
    printers.push({
      name: found[1],
      default: found[1] === chosen,
      output: 'paper',
      state: /\bdisabled\b/.test(said) ? 'offline' : /\bnow printing\b/.test(said) ? 'printing' : 'ready'
    })
  }
  return printers
}

/** Whether lpstat's failure means only that there is no printer, which is no failure. */
export function noPrinters(errors: string): boolean {
  return /no destinations added/i.test(errors)
}

/**
 * The command that prints one file. CUPS prints PDFs, pictures and text itself; text is named as such, since a file
 * ending in .md or .csv would otherwise not be recognised as text.
 */
export function printProgram(job: PrintJob): Program {
  const title = job.path.slice(job.path.lastIndexOf('/') + 1)
  return {
    command: 'lp',
    args: ['-d', job.printer, '-n', String(job.copies), '-t', title, ...(job.kind === 'text' ? ['-o', 'document-format=text/plain'] : []), '--', job.path],
    env: ENGLISH
  }
}

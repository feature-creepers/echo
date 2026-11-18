import { z } from 'zod'
import type { Computer } from '../ports/computer.ts'
import type { Printable, Printer, Printers } from '../ports/printers.ts'
import type { Tool } from '../tools/tools.ts'
import type { Showing } from '../views/screen.ts'
import type { DeviceActs } from './acts.ts'

/** The most copies of one file a call prints. */
export const MAX_COPIES = 20

/** What a file holds, by its ending: what the adapter can print, on every system. */
const KINDS: Record<string, Printable> = {
  pdf: 'pdf',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  bmp: 'image',
  tif: 'image',
  tiff: 'image',
  txt: 'text',
  text: 'text',
  md: 'text',
  markdown: 'text',
  csv: 'text',
  tsv: 'text',
  log: 'text',
  json: 'text',
  xml: 'text',
  yaml: 'text',
  yml: 'text',
  ini: 'text'
}

/** What a file holds, by its ending, when it can be printed. */
export function printableKind(path: string): Printable | undefined {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? undefined : KINDS[name.slice(dot + 1).toLowerCase()]
}

/**
 * The printer a call names: the same name whatever its case, else the only one whose name holds the words given;
 * with none named, the system's default. Nothing, with the reason, when it is not one of them.
 */
export function choosePrinter(printers: readonly Printer[], asked: string | undefined): Printer | string {
  const names = printers.map((printer) => `"${printer.name}"`).join(', ')
  if (printers.length === 0) return 'This computer has no printer.'
  if (asked === undefined) {
    const chosen = printers.find((printer) => printer.default) ?? (printers.length === 1 ? printers[0] : undefined)
    return chosen ?? `This computer has no default printer: name one of ${names}.`
  }
  const wanted = asked.trim().toLowerCase()
  const same = printers.find((printer) => printer.name.toLowerCase() === wanted)
  if (same) return same
  const near = printers.filter((printer) => printer.name.toLowerCase().includes(wanted))
  if (near.length === 1 && near[0]) return near[0]
  return near.length > 1
    ? `Several printers are called like "${asked}": ${near.map((printer) => `"${printer.name}"`).join(', ')}. Name one of them.`
    : `There is no printer called "${asked}". The printers are ${names}.`
}

const STATE: Record<Printer['state'], string> = {
  ready: 'ready',
  printing: 'printing',
  offline: 'offline',
  error: 'needs attention'
}

const printInput = z.object({
  path: z.string().trim().min(1).max(4096),
  printer: z.string().trim().min(1).max(300).optional(),
  copies: z.number().int().min(1).max(MAX_COPIES).optional()
})

export interface PrinterToolsOptions {
  printers: Printers
  computer: Computer
  /** Whether a place may be read now, by the person's grants. */
  reaches: (path: string) => boolean
  acts: DeviceActs
}

/**
 * The printers as tools (docs/SPEC.md, section 12.4, more of the device). Listing them goes ahead. Printing reads a
 * file within what the person granted, and follows the approval level as a command does: asked first at `ask` and
 * `trust`, and covered for the session by a yes for the session. A printer that makes a file writes it in the
 * assistant's own folder.
 */
export function printerTools({ printers, computer, reaches, acts }: PrinterToolsOptions, showing: () => Showing): Tool[] {
  return [
    {
      definition: {
        name: 'printers_list',
        description: "The printers of the person's computer, the default one first, and whether each is ready.",
        inputSchema: { type: 'object', properties: {} }
      },
      async run() {
        try {
          const found = await printers.list()
          if (found.length === 0) return { ok: true, text: 'This computer has no printer.' }
          const ordered = [...found].sort((one, other) => Number(other.default) - Number(one.default))
          const lines = ordered.map(
            (printer) =>
              `- ${printer.name}${printer.default ? ' (default)' : ''}: ${STATE[printer.state]}${printer.output === 'file' ? ', makes a file in your folder rather than paper' : ''}`
          )
          return { ok: true, text: lines.join('\n') }
        } catch (error) {
          return { ok: false, text: error instanceof Error ? error.message : String(error) }
        }
      }
    },
    {
      definition: {
        name: 'print',
        description: `Print a file on one of the person's printers: a PDF, a picture (PNG, JPEG, GIF, BMP, TIFF) or plain text (.txt, .md, .csv and the like). The file is in your folder or a place the person granted. Without "printer", the default one; "copies" ${MAX_COPIES} at most. For a document of another kind, write it as a PDF first.`,
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'The file, absolute or from your folder.' },
            printer: { type: 'string', description: 'The printer, by its name from printers_list. Left out, the default one.' },
            copies: { type: 'number', description: 'How many copies: 1 by default.' }
          },
          required: ['path']
        }
      },
      async run(input) {
        const asked = printInput.safeParse(input)
        if (!asked.success) return { ok: false, text: `print takes the "path" of a file, with "printer" and "copies" (1 to ${MAX_COPIES}) if needed.` }
        const found = await computer.locate(asked.data.path)
        if (found?.kind !== 'file') return { ok: false, text: `There is no file at ${asked.data.path}.` }
        const name = found.path.slice(Math.max(found.path.lastIndexOf('/'), found.path.lastIndexOf('\\')) + 1)
        const kind = printableKind(found.path)
        if (!kind) return { ok: false, text: `${name} cannot be printed as it is: only PDFs, pictures and plain text are. Write it as a PDF first.` }
        let all: Printer[]
        try {
          all = await printers.list()
        } catch (error) {
          return { ok: false, text: error instanceof Error ? error.message : String(error) }
        }
        const printer = choosePrinter(all, asked.data.printer)
        if (typeof printer === 'string') return { ok: false, text: printer }
        const copies = printer.output === 'file' ? 1 : (asked.data.copies ?? 1)
        const line = `Print ${name} on ${printer.name}${copies > 1 ? ` (${copies} copies)` : ''}`
        const act = { tool: 'print', line, paths: [found.path] }
        if (!reaches(found.path)) {
          return acts.refuse(
            act,
            showing(),
            'outside',
            `${found.path} is outside what the person granted. You can print files from your own folder or from places they gave you; they can grant more in Settings, Access.`
          )
        }
        const decided = await acts.decide(
          {
            ...act,
            question: {
              heading: `Print “${name}”?`,
              subject: printer.name,
              facts: [
                { label: 'Printer', value: printer.name },
                ...(printer.output === 'file' ? [{ label: 'Makes', value: 'A file in your folder' }] : [{ label: 'Copies', value: String(copies) }])
              ],
              ...(printer.state === 'offline' || printer.state === 'error'
                ? { note: { text: `The printer is ${STATE[printer.state]}: the job will wait for it.`, tone: 'warn' as const } }
                : {}),
              allow: 'Print',
              session: 'Printing'
            }
          },
          showing()
        )
        if (!decided.go) return decided.result
        return acts.carry(decided.use, async () => {
          const printed = await printers.print({ path: found.path, printer: printer.name, copies, kind })
          if (printed.file !== undefined)
            return { ok: true, text: `Printed with ${printer.name}: the file is at ${printed.file}. Show it with FileList if the person wants to see it.` }
          const pages = printed.pages === undefined ? '' : `, ${printed.pages} ${printed.pages === 1 ? 'page' : 'pages'}`
          return { ok: true, text: `Sent to ${printer.name}${pages}${copies > 1 ? `, ${copies} copies` : ''}. It prints as soon as the printer takes it.` }
        })
      }
    }
  ]
}

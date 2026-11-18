/**
 * The printers of the computer the core runs on (docs/SPEC.md, section 12.4, more of the device). The adapter only
 * carries out; whether a file may be printed, and whether the person is asked first, is the core's to decide.
 *
 * A method rejects with an `Error` whose message is written for a model to act on.
 */
export interface Printers {
  /** The printers the system knows, its default one marked. Empty when it has none, or no printing system. */
  list(): Promise<Printer[]>
  /** Send a file to a printer. Resolves once the system has taken the job, not once the paper is out. */
  print(job: PrintJob): Promise<Printed>
}

export interface Printer {
  /** Its name, as the system and the person know it: "Brother DCP-9020CDW Printer". */
  name: string
  /** The one the system prints to when none is named. */
  default: boolean
  /**
   * What comes out: paper, or a file, as Microsoft Print to PDF makes; the adapter writes that file in a folder of
   * the assistant's own, so no dialog waits on a computer nobody may be watching.
   */
  output: 'paper' | 'file'
  /** How it stands now, as far as the system knows. */
  state: 'ready' | 'printing' | 'offline' | 'error'
}

/** What the adapter can print: a PDF, a picture, or plain text. */
export const PRINTABLE = ['pdf', 'image', 'text'] as const
export type Printable = (typeof PRINTABLE)[number]

export interface PrintJob {
  /** The file, as the system names it. It exists, and the core has checked it is within reach. */
  path: string
  /** The printer, by its name as `list` gives it. */
  printer: string
  /** How many copies, one at least. */
  copies: number
  /** What the file holds, which says how it is printed. */
  kind: Printable
}

export interface Printed {
  /** How many pages were sent, when the system says. */
  pages?: number
  /** Where the file is, for a printer that makes one. */
  file?: string
}

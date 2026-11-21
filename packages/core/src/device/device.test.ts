import type { Access } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import type { Answer, Question } from '../access/approvals.ts'
import type { Computer } from '../ports/computer.ts'
import type { Drive, Drives } from '../ports/drives.ts'
import type { Printer, Printers, PrintJob } from '../ports/printers.ts'
import { sizeOf } from './acts.ts'
import { createDeviceControl } from './device.ts'
import { chooseDrive } from './drives.ts'
import { choosePrinter, printableKind } from './printers.ts'

const showing = () => ({ thread: 't', turn: 'turn' })

const PRINTERS: Printer[] = [
  { name: 'Brother DCP-9020CDW Printer', default: true, output: 'paper', state: 'ready' },
  { name: 'Brother DCP-9020CDW Printer (Copy 1)', default: false, output: 'paper', state: 'ready' },
  { name: 'Microsoft Print to PDF', default: false, output: 'file', state: 'ready' },
  { name: 'Office', default: false, output: 'paper', state: 'offline' }
]

const KEY: Drive = { path: 'E:\\', name: 'KINGSTON', size: 32_000_000_000, free: 12_300_000_000, readOnly: false }

function setup({
  level = 'ask',
  answers = [],
  granted = ['C:\\Users\\Ada\\Echo', 'E:\\']
}: {
  level?: Access['approvals']
  answers?: Answer[]
  granted?: string[]
} = {}) {
  const asked: Question[] = []
  const recorded: { tool: string; command?: string | undefined; decision: string; reason: string }[] = []
  const reported: { ok: boolean; error?: string | undefined }[] = []
  const printed: PrintJob[] = []
  const ejected: string[] = []
  const files = new Set(['C:\\Users\\Ada\\Echo\\report.pdf', 'C:\\Users\\Ada\\Echo\\notes.md', 'C:\\Users\\Ada\\Echo\\slides.pptx', 'D:\\Private\\tax.pdf'])
  const computer = {
    workspace: 'C:\\Users\\Ada\\Echo',
    locate: async (path: string) => (files.has(path) ? { path, kind: 'file' as const } : undefined)
  } as unknown as Computer
  const printers: Printers = {
    list: async () => PRINTERS,
    print: async (job) => {
      printed.push(job)
      return PRINTERS.find((printer) => printer.name === job.printer)?.output === 'file'
        ? { pages: 2, file: 'C:\\Users\\Ada\\Echo\\printed\\report.pdf' }
        : { pages: 2 }
    }
  }
  let plugged = [KEY]
  const drives: Drives = {
    list: async () => plugged,
    eject: async (path) => {
      ejected.push(path)
      plugged = plugged.filter((drive) => drive.path !== path)
    }
  }
  const control = createDeviceControl({
    access: {
      ask: async (question) => {
        asked.push(question)
        return { answer: answers.shift() ?? 'no', pressed: true }
      },
      record: (use) => {
        recorded.push({ tool: use.tool, command: use.command, decision: use.decision, reason: use.reason })
        return `use${recorded.length}`
      },
      report: (_use, outcome) => void reported.push(outcome),
      reaches: (path, write) => granted.some((place) => path.startsWith(place)) && (!write || !path.startsWith('E:'))
    },
    level: () => level,
    computer,
    printers,
    drives
  })
  const call = async (name: string, input: unknown = {}) => {
    const tool = control.tools(showing).find((one) => one.definition.name === name)
    if (!tool) throw new Error(`No tool ${name}`)
    return tool.run(input)
  }
  return { control, call, asked, recorded, reported, printed, ejected }
}

describe('what can be printed', () => {
  it.each([
    ['C:\\Users\\Ada\\report.PDF', 'pdf'],
    ['/home/ada/photo.jpeg', 'image'],
    ['scan.tiff', 'image'],
    ['notes.md', 'text'],
    ['table.csv', 'text'],
    ['slides.pptx', undefined],
    ['page.html', undefined],
    ['.pdf', undefined],
    ['README', undefined]
  ])('%s is printed as %s', (path, kind) => {
    expect(printableKind(path)).toBe(kind)
  })
})

describe('the printer a call names', () => {
  it.each([
    [undefined, 'Brother DCP-9020CDW Printer'],
    ['microsoft print to pdf', 'Microsoft Print to PDF'],
    ['office', 'Office'],
    ['PDF', 'Microsoft Print to PDF'],
    ['Brother DCP-9020CDW Printer', 'Brother DCP-9020CDW Printer']
  ])('%s is %s', (asked, name) => {
    expect(choosePrinter(PRINTERS, asked)).toMatchObject({ name })
  })

  it.each([
    [PRINTERS, 'Brother', 'Several printers'],
    [PRINTERS, 'Epson', 'There is no printer called "Epson"'],
    [[], undefined, 'This computer has no printer.'],
    [PRINTERS.map((printer) => ({ ...printer, default: false })), undefined, 'no default printer']
  ])('refuses what it cannot settle: %#', (printers, asked, said) => {
    expect(choosePrinter(printers, asked)).toContain(said)
  })

  it('takes the only printer when none is the default', () => {
    expect(choosePrinter([{ ...PRINTERS[3], default: false } as Printer], undefined)).toMatchObject({ name: 'Office' })
  })
})

describe('printing', () => {
  it('asks first at the level that asks, and prints once the person says yes', async () => {
    const { call, asked, printed, recorded, reported } = setup({ answers: ['yes'] })
    const result = await call('print', { path: 'C:\\Users\\Ada\\Echo\\report.pdf', copies: 2 })
    expect(result).toMatchObject({ ok: true })
    expect(result.text).toContain('Sent to Brother DCP-9020CDW Printer, 2 pages, 2 copies')
    expect(asked.map((question) => [question.heading, question.subject, question.session])).toEqual([
      ['Print “report.pdf”?', 'Brother DCP-9020CDW Printer', 'Printing']
    ])
    expect(printed).toEqual([{ path: 'C:\\Users\\Ada\\Echo\\report.pdf', printer: 'Brother DCP-9020CDW Printer', copies: 2, kind: 'pdf' }])
    expect(recorded).toEqual([
      { tool: 'print', command: 'Print report.pdf on Brother DCP-9020CDW Printer (2 copies)', decision: 'approved', reason: 'pressed' }
    ])
    expect(reported).toEqual([{ ok: true }])
  })

  it('prints at once when the person lets the assistant act without asking, and after a yes for the session', async () => {
    const auto = setup({ level: 'auto' })
    expect(await auto.call('print', { path: 'C:\\Users\\Ada\\Echo\\notes.md' })).toMatchObject({ ok: true })
    expect(auto.asked).toEqual([])
    expect(auto.recorded[0]).toMatchObject({ decision: 'ran', reason: 'level' })

    const session = setup({ level: 'trust', answers: ['session'] })
    await session.call('print', { path: 'C:\\Users\\Ada\\Echo\\notes.md' })
    await session.call('print', { path: 'C:\\Users\\Ada\\Echo\\report.pdf' })
    expect(session.asked).toHaveLength(1)
    expect(session.recorded.map((use) => use.reason)).toEqual(['pressed', 'session'])
    // Stopping everything forgets the yes for the session.
    session.control.forget()
    await session.call('print', { path: 'C:\\Users\\Ada\\Echo\\report.pdf' })
    expect(session.asked).toHaveLength(2)
  })

  it('writes what a printer of files makes in the assistant’s folder, one copy, and says where', async () => {
    const { call, asked, printed } = setup({ answers: ['yes'] })
    const result = await call('print', { path: 'C:\\Users\\Ada\\Echo\\report.pdf', printer: 'pdf', copies: 3 })
    expect(result.text).toContain('C:\\Users\\Ada\\Echo\\printed\\report.pdf')
    expect(printed[0]?.copies).toBe(1)
    expect(asked[0]?.facts).toContainEqual({ label: 'Makes', value: 'A file in your folder' })
  })

  it('says when the printer is offline that the job will wait', async () => {
    const { call, asked } = setup({ answers: ['yes'] })
    await call('print', { path: 'C:\\Users\\Ada\\Echo\\report.pdf', printer: 'Office' })
    expect(asked[0]?.note).toMatchObject({ tone: 'warn', text: 'The printer is offline: the job will wait for it.' })
  })

  it.each([
    [{ path: 'D:\\Private\\tax.pdf' }, 'outside what the person granted', true],
    [{ path: 'C:\\Users\\Ada\\Echo\\slides.pptx' }, 'only PDFs, pictures and plain text', false],
    [{ path: 'C:\\Users\\Ada\\Echo\\gone.pdf' }, 'There is no file', false],
    [{ path: 'C:\\Users\\Ada\\Echo\\report.pdf', printer: 'Epson' }, 'no printer called', false],
    [{ path: 'C:\\Users\\Ada\\Echo\\report.pdf', copies: 50 }, 'print takes', false]
  ])('refuses before anyone is asked: %j', async (input, said, kept) => {
    const { call, asked, printed, recorded } = setup({ answers: ['yes'] })
    const result = await call('print', input)
    expect(result.ok).toBe(false)
    expect(result.text).toContain(said)
    expect(asked).toEqual([])
    expect(printed).toEqual([])
    expect(recorded.map((use) => use.reason)).toEqual(kept ? ['outside'] : [])
  })

  it('prints nothing when the person says no, and keeps the refusal', async () => {
    const { call, printed, recorded } = setup({ answers: ['no'] })
    expect(await call('print', { path: 'C:\\Users\\Ada\\Echo\\report.pdf' })).toMatchObject({ ok: false })
    expect(printed).toEqual([])
    expect(recorded[0]).toMatchObject({ decision: 'refused', reason: 'declined' })
  })

  it('lists the printers, the default first, with what a printer of files does', async () => {
    const { call } = setup()
    const { text } = await call('printers_list')
    expect(text.split('\n')[0]).toBe('- Brother DCP-9020CDW Printer (default): ready')
    expect(text).toContain('- Microsoft Print to PDF: ready, makes a file in your folder rather than paper')
    expect(text).toContain('- Office: offline')
  })
})

describe('the removable drives', () => {
  it('lists each with its space and what the assistant may do there', async () => {
    const { call } = setup()
    expect((await call('drives_list')).text).toBe('- KINGSTON, at E:\\, 12.3 GB free of 32 GB: you may read it, not change it.')
    const ungranted = setup({ granted: [] })
    expect((await ungranted.call('drives_list')).text).toContain('not given to you: ask for it with computer_grant')
  })

  it.each([
    ['e:', 'KINGSTON'],
    ['E:\\', 'KINGSTON'],
    ['kingston', 'KINGSTON']
  ])('finds the drive %s', (asked, name) => {
    expect(chooseDrive([KEY, { ...KEY, path: 'F:\\', name: 'SD' }], asked)).toMatchObject({ name })
  })

  it('names the drives plugged in when the one asked for is not', () => {
    expect(chooseDrive([KEY], 'G:')).toBe('No drive "G:" is plugged in. The drives are KINGSTON (E:\\).')
    expect(chooseDrive([], 'E:')).toBe('No removable drive is plugged in.')
    expect(chooseDrive([KEY, { ...KEY, path: 'F:\\' }], 'kingston')).toContain('Several drives')
  })

  it('ejects a drive as a command is decided: asked at the level that asks, at once at the level that does not', async () => {
    const asking = setup({ answers: ['yes'] })
    expect(await asking.call('drive_eject', { drive: 'E:' })).toMatchObject({ ok: true, text: 'KINGSTON was ejected: the person can unplug it.' })
    expect(asking.asked[0]).toMatchObject({ heading: 'Eject “KINGSTON”?', allow: 'Eject' })
    expect(asking.ejected).toEqual(['E:\\'])
    const auto = setup({ level: 'auto' })
    await auto.call('drive_eject', { drive: 'KINGSTON' })
    expect(auto.asked).toEqual([])
    expect(auto.recorded[0]).toMatchObject({ tool: 'drive_eject', command: 'Eject KINGSTON (E:\\)', decision: 'ran', reason: 'level' })
  })
})

describe('a size in bytes', () => {
  it.each([
    [512, '512 bytes'],
    [1_500, '1.5 KB'],
    [32_000_000_000, '32 GB'],
    [123_456_789_012, '123 GB'],
    [4_000_000_000_000, '4 TB']
  ])('%d is %s', (bytes, said) => {
    expect(sizeOf(bytes)).toBe(said)
  })
})

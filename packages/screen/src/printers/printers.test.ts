import { win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import { noPrinters, printProgram, readPrinters as readUnix, LIST as UNIX_LIST } from './unix.ts'
import { fileEnding, PRINT, readPrinters as readWindows, LIST as WINDOWS_LIST, type WindowsPrinter } from './win32.ts'

/** Each system's file is checked on every system: only one of them is used for real where the tests run. */
describe('the printers of Windows', () => {
  const printer = (name: string, more: Partial<WindowsPrinter> = {}): WindowsPrinter => ({
    name,
    default: false,
    port: 'WSD-52373494',
    driver: 'Brother Color Type3 Class Driver',
    offline: false,
    status: 3,
    error: 0,
    ...more
  })

  it('reads each one, leaves the fax out, and tells a printer of files by its port that prompts', () => {
    expect(
      readWindows([
        printer('Brother DCP-9020CDW Printer', { default: true }),
        printer('Microsoft Print to PDF', { port: 'PORTPROMPT:', driver: 'Microsoft Print To PDF' }),
        printer('Fax', { port: 'SHRFAX:', driver: 'Microsoft Shared Fax Driver' }),
        printer('OneNote (Desktop)', { port: 'nul:' })
      ])
    ).toEqual([
      { name: 'Brother DCP-9020CDW Printer', default: true, output: 'paper', state: 'ready' },
      { name: 'Microsoft Print to PDF', default: false, output: 'file', state: 'ready' },
      { name: 'OneNote (Desktop)', default: false, output: 'paper', state: 'ready' }
    ])
  })

  it.each([
    [{ status: 3 }, 'ready'],
    [{ status: 4 }, 'printing'],
    [{ status: 5 }, 'printing'],
    [{ status: 7 }, 'offline'],
    [{ offline: true }, 'offline'],
    [{ status: 6 }, 'error'],
    [{ error: 4 }, 'error'],
    [{ status: 0 }, 'ready']
  ])('reads %j as %s', (more, state) => {
    expect(readWindows([printer('P', more)])[0]?.state).toBe(state)
  })

  it.each([
    ['Microsoft Print to PDF', '.pdf'],
    ['Microsoft XPS Document Writer', '.xps'],
    ['Something else', '.prn']
  ])('a file printed with %s ends in %s', (name, ending) => {
    expect(fileEnding(name)).toBe(ending)
  })

  it('runs its scripts encoded, with the PowerShell of the system folder, so no quoting or search path can change them', () => {
    for (const program of [WINDOWS_LIST, PRINT]) {
      expect(win32.dirname(program.command)).toMatch(/System32\\WindowsPowerShell\\v1\.0$/)
      expect(win32.basename(program.command)).toBe('powershell.exe')
      expect(program.args.slice(0, -1)).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand'])
      const script = Buffer.from(program.args.at(-1) ?? '', 'base64').toString('utf16le')
      expect(script).toContain("$ErrorActionPreference = 'Stop'")
    }
    const print = Buffer.from(PRINT.args.at(-1) ?? '', 'base64').toString('utf16le')
    // The default printer is put back when Windows made the one just used the default.
    expect(print).toContain('SetDefaultPrinter')
    expect(print).toContain('IAsyncOperation`1')
  })
})

describe('the printers of CUPS, on macOS and Linux', () => {
  it('reads lpstat in English, the default marked and each one’s state', () => {
    expect(UNIX_LIST).toEqual({ command: 'lpstat', args: ['-p', '-d'], env: { LANG: 'C', LC_ALL: 'C' } })
    const out = [
      'printer HP_LaserJet is idle.  enabled since Mon 18 Nov 2026 09:12:00',
      'printer Office now printing Office-12.  enabled since Mon 18 Nov 2026 09:12:00',
      'printer Old disabled since Mon 18 Nov 2026 09:12:00 -',
      '\treason unknown',
      'system default destination: Office'
    ].join('\n')
    expect(readUnix(out)).toEqual([
      { name: 'HP_LaserJet', default: false, output: 'paper', state: 'ready' },
      { name: 'Office', default: true, output: 'paper', state: 'printing' },
      { name: 'Old', default: false, output: 'paper', state: 'offline' }
    ])
    expect(readUnix('no system default destination\n')).toEqual([])
  })

  it('takes "no destinations" as no printer rather than a failure', () => {
    expect(noPrinters('lpstat: No destinations added.')).toBe(true)
    expect(noPrinters('lpstat: Bad file descriptor')).toBe(false)
  })

  it.each([
    [{ kind: 'pdf' as const, copies: 2 }, ['-d', 'Office', '-n', '2', '-t', 'report.pdf', '--', '/home/ada/report.pdf']],
    [{ kind: 'text' as const, copies: 1 }, ['-d', 'Office', '-n', '1', '-t', 'report.pdf', '-o', 'document-format=text/plain', '--', '/home/ada/report.pdf']]
  ])('prints with lp: %j', (job, args) => {
    expect(printProgram({ path: '/home/ada/report.pdf', printer: 'Office', ...job }).args).toEqual(args)
  })
})

import { type ChildProcess, spawn } from 'node:child_process'
import type { Graphics } from './graphics.ts'

/**
 * Windows has no counter for the whole graphics card, only one for each process's use of each engine. The 3D
 * engines' are summed. The counter is named in English, which the system accepts whatever its language. A reading
 * every five seconds keeps the reader's own cost near a hundredth of one processor.
 */
const COUNTER = String.raw`\GPU Engine(*engtype_3D)\Utilization Percentage`
const EVERY_SECONDS = 5

/** The counter's instances are fixed when the reader starts; it starts again this often, to see new programs. */
const RENEW_MS = 120_000

/**
 * How many readings a reader is asked for: those of one life and one more, so a reader the app could not stop,
 * because the app itself was ended, stops by itself a little later.
 */
const READINGS = RENEW_MS / 1000 / EVERY_SECONDS + 1

/**
 * The graphics card's use from one line of typeperf's output, from 0 to 1: the sum of the 3D engines' percentages,
 * which can pass a hundred on a machine with more than one card, so it is capped. The header, blank lines and
 * messages give nothing. Each value is in quotes, and is read whole, with a point or a comma before its decimals:
 * typeperf writes a point whatever the system's format, as seen on a French Windows 11, and a comma is taken too in
 * case another version follows the format.
 */
export function parseTypeperf(line: string): number | undefined {
  const fields =
    line
      .trim()
      .match(/"[^"]*"/g)
      ?.map((field) => field.slice(1, -1)) ?? []
  if (fields.length < 2 || !/^\d{1,2}\/\d{1,2}\/\d{4}/.test(fields[0] ?? '')) return undefined
  let sum = 0
  for (const field of fields.slice(1)) {
    const value = field.trim() === '' ? Number.NaN : Number(field.replace(',', '.'))
    if (Number.isFinite(value) && value > 0) sum += value
  }
  return Math.min(1, sum / 100)
}

export function startGraphics(): Graphics {
  let latest: number | undefined
  let reader: ChildProcess | undefined
  let stopped = false
  let renew: ReturnType<typeof setTimeout> | undefined

  const open = () => {
    if (stopped) return
    const opened = spawn('typeperf', [COUNTER, '-si', String(EVERY_SECONDS), '-sc', String(READINGS)], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    reader = opened
    let pending = ''
    opened.stdout?.setEncoding('utf8')
    opened.stdout?.on('data', (chunk: string) => {
      pending += chunk
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      for (const line of lines) {
        const read = parseTypeperf(line)
        if (read !== undefined) latest = read
      }
    })
    // A reader that cannot start, or stops, leaves the graphics card unknown rather than stuck at its last value.
    opened.on('error', () => {
      latest = undefined
    })
    opened.on('exit', () => {
      // One that was replaced by the next leaves the next one's readings alone.
      if (reader !== opened) return
      reader = undefined
      latest = undefined
    })
    renew = setTimeout(() => {
      open()
      opened.kill()
    }, RENEW_MS)
  }
  open()

  return {
    latest: () => latest,
    stop() {
      stopped = true
      clearTimeout(renew)
      reader?.kill()
      reader = undefined
    }
  }
}

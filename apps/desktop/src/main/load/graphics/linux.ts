import { readdir, readFile } from 'node:fs/promises'
import { posix } from 'node:path'
import type { Graphics } from './graphics.ts'

/**
 * Linux's kernel says how busy a graphics card is in a file of its own, for the cards whose driver keeps it (AMD's,
 * Intel's newer ones). Reading it costs nothing. Other cards say nothing, and the load leaves them out.
 */
const CARDS = '/sys/class/drm'
const EVERY_MS = 2000

/** The card's use from its `gpu_busy_percent` file, from 0 to 1; nothing when the file says no number. */
export function parseBusyPercent(text: string): number | undefined {
  const value = Number.parseInt(text.trim(), 10)
  return Number.isFinite(value) && value >= 0 ? Math.min(1, value / 100) : undefined
}

/** The files to read: one per card, `card0` and the like, not their outputs (`card0-HDMI-A-1`). */
export function busyFiles(entries: readonly string[]): string[] {
  return entries.filter((entry) => /^card\d+$/.test(entry)).map((card) => posix.join(CARDS, card, 'device', 'gpu_busy_percent'))
}

export function startGraphics(): Graphics {
  let latest: number | undefined
  let stopped = false
  let files: Promise<string[]> | undefined
  const read = async () => {
    files ??= readdir(CARDS).then(busyFiles, () => [])
    const readings = await Promise.all((await files).map((file) => readFile(file, 'utf8').then(parseBusyPercent, () => undefined)))
    if (stopped) return
    const known = readings.filter((reading): reading is number => reading !== undefined)
    latest = known.length > 0 ? Math.max(...known) : undefined
  }
  void read()
  const timer = setInterval(() => void read(), EVERY_MS)
  return {
    latest: () => latest,
    stop() {
      stopped = true
      clearInterval(timer)
    }
  }
}

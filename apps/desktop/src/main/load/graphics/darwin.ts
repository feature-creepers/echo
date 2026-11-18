import { execFile } from 'node:child_process'
import type { Graphics } from './graphics.ts'

/** macOS reports each graphics card's use in its registry, which `ioreg` prints; reading it is quick. */
const EVERY_MS = 3000

/**
 * The graphics card's use from `ioreg`'s description of the accelerators, from 0 to 1: the busiest card's "Device
 * Utilization %". Nothing when no card says.
 */
export function parseIoreg(text: string): number | undefined {
  let busiest: number | undefined
  for (const match of text.matchAll(/"Device Utilization %"\s*=\s*(\d+(?:\.\d+)?)/g)) {
    const value = Number(match[1])
    if (Number.isFinite(value)) busiest = Math.max(busiest ?? 0, value)
  }
  return busiest === undefined ? undefined : Math.min(1, busiest / 100)
}

export function startGraphics(): Graphics {
  let latest: number | undefined
  let stopped = false
  const read = () => {
    execFile('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'], { timeout: 2000 }, (error, stdout) => {
      if (stopped) return
      latest = error ? undefined : parseIoreg(stdout)
    })
  }
  read()
  const timer = setInterval(read, EVERY_MS)
  return {
    latest: () => latest,
    stop() {
      stopped = true
      clearInterval(timer)
    }
  }
}

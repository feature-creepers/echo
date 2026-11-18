import { cpus, freemem, totalmem } from 'node:os'
import { type Graphics, startGraphics } from './graphics/index.ts'
import { loadOf, memoryPressure, type ProcessorTimes, processorBusy } from './measure.ts'

/** How often the load is told, in milliseconds: about as often as it can change in a way that shows. */
const EVERY_MS = 1000

export interface LoadFollower {
  /** Start telling the load, about once a second, while `active` says the window is seen. */
  start(listener: (load: number) => void): void
  /** Stop telling it, and let go of whatever reads the graphics card. */
  stop(): void
}

const timesNow = (): ProcessorTimes[] => cpus().map((cpu) => cpu.times)

/**
 * How hard this computer works, for the window's core to follow: the processor and memory as Node reports them,
 * and the graphics card the way each system does. Nothing is read while the window is not seen, and nothing at all
 * once no one follows it.
 */
export function followLoad(active: () => boolean): LoadFollower {
  let timer: ReturnType<typeof setInterval> | undefined
  let graphics: Graphics | undefined
  let before = timesNow()

  const stop = () => {
    clearInterval(timer)
    timer = undefined
    graphics?.stop()
    graphics = undefined
  }

  return {
    start(listener) {
      stop()
      before = timesNow()
      timer = setInterval(() => {
        if (!active()) {
          // Out of sight, nothing is read; the graphics card's reader stops until the window is seen again.
          graphics?.stop()
          graphics = undefined
          before = timesNow()
          return
        }
        graphics ??= startGraphics()
        const after = timesNow()
        const processor = processorBusy(before, after)
        before = after
        listener(loadOf({ processor, memory: memoryPressure(freemem(), totalmem()), graphics: graphics.latest() }))
      }, EVERY_MS)
    },
    stop
  }
}

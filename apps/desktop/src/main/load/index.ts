import { cpus, totalmem } from 'node:os'
import { loadOf, memoryPressure, type ProcessorTimes, processorBusy } from './measure.ts'
import { freeMemory } from './memory/index.ts'

/** How often the load is told, in milliseconds: about as often as it can change in a way that shows. */
const EVERY_MS = 1000

export interface LoadFollower {
  /** Start telling the load, about once a second, while `active` says the window is seen. */
  start(listener: (load: number) => void): void
  /** Stop telling it. */
  stop(): void
}

const timesNow = (): ProcessorTimes[] => cpus().map((cpu) => cpu.times)

/**
 * How hard this computer works, for the window's core to follow: the processors as Node reports them, and memory
 * the way each system counts it, both read without starting a program. Nothing is read while the window is not
 * seen, and nothing at all once no one follows it.
 */
export function followLoad(active: () => boolean): LoadFollower {
  let timer: ReturnType<typeof setInterval> | undefined
  let before = timesNow()

  const stop = () => {
    clearInterval(timer)
    timer = undefined
  }

  return {
    start(listener) {
      stop()
      before = timesNow()
      timer = setInterval(() => {
        if (!active()) {
          before = timesNow()
          return
        }
        const after = timesNow()
        const processor = processorBusy(before, after)
        before = after
        const free = freeMemory()
        listener(loadOf({ processor, memory: free === undefined ? 0 : memoryPressure(free, totalmem()) }))
      }, EVERY_MS)
    },
    stop
  }
}

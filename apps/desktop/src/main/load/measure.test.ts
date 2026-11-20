import { describe, expect, it } from 'vitest'
import { loadOf, memoryPressure, type ProcessorTimes, processorBusy } from './measure.ts'

const times = (user: number, sys: number, idle: number): ProcessorTimes => ({ user, nice: 0, sys, idle, irq: 0 })

describe('how busy the processors were', () => {
  it.each([
    { case: 'idle throughout', before: [times(100, 50, 1000)], after: [times(100, 50, 2000)], busy: 0 },
    { case: 'busy throughout', before: [times(100, 50, 1000)], after: [times(900, 250, 1000)], busy: 1 },
    { case: 'half and half', before: [times(0, 0, 0)], after: [times(300, 200, 500)], busy: 0.5 },
    { case: 'one busy, one idle', before: [times(0, 0, 0), times(0, 0, 0)], after: [times(1000, 0, 0), times(0, 0, 1000)], busy: 0.5 },
    { case: 'a clock that went backwards counts for nothing', before: [times(500, 0, 500)], after: [times(100, 0, 600)], busy: 0 },
    { case: 'no time passed', before: [times(10, 10, 10)], after: [times(10, 10, 10)], busy: 0 },
    { case: 'a processor missing from one reading', before: [times(0, 0, 0)], after: [times(500, 0, 500), times(1000, 0, 0)], busy: 0.5 }
  ])('$case', ({ before, after, busy }) => {
    expect(processorBusy(before, after)).toBeCloseTo(busy, 6)
  })
})

describe('how pressed for memory the computer is', () => {
  it.each([
    { free: 8, total: 16, pressure: 0 },
    { free: 4, total: 16, pressure: 0 },
    { free: 2.4, total: 16, pressure: 0.5 },
    { free: 0.8, total: 16, pressure: 1 },
    { free: 0, total: 16, pressure: 1 },
    { free: 4, total: 0, pressure: 0 }
  ])('$free free of $total', ({ free, total, pressure }) => {
    expect(memoryPressure(free, total)).toBeCloseTo(pressure, 2)
  })
})

describe('the load', () => {
  it.each([
    { case: 'the processors are the busier', parts: { processor: 0.6, memory: 0.1 }, load: 0.6 },
    { case: 'memory runs short', parts: { processor: 0.2, memory: 0.7 }, load: 0.7 },
    { case: 'memory is not known', parts: { processor: 0.3, memory: 0 }, load: 0.3 },
    { case: 'a computer at rest', parts: { processor: 0, memory: 0 }, load: 0 },
    { case: 'what is out of range is held to it', parts: { processor: 1.4, memory: -1 }, load: 1 },
    { case: 'what is not a number counts for nothing', parts: { processor: Number.NaN, memory: 0.4 }, load: 0.4 }
  ])('$case', ({ parts, load }) => {
    expect(loadOf(parts)).toBeCloseTo(load, 6)
  })
})

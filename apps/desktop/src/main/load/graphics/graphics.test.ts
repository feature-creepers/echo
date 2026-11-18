import { posix } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseIoreg } from './darwin.ts'
import { busyFiles, parseBusyPercent } from './linux.ts'
import { parseTypeperf } from './win32.ts'

// Every system's reader is tested here on every system: each only reads text.

describe("Windows' graphics counters", () => {
  it.each([
    { case: 'a reading, the engines summed', line: '"11/18/2026 19:10:15.296","0.000000","12.500000","30.000000"', use: 0.425 },
    { case: 'engines that did nothing', line: '"11/18/2026 19:10:16.325","0.000000","0.000000"', use: 0 },
    { case: 'more than one card, capped', line: '"1/2/2026 09:00:00.000","80","70"', use: 1 },
    { case: 'an engine that gave no number', line: '"11/18/2026 19:10:15.296","-1","","25"', use: 0.25 },
    { case: 'a comma before the decimals', line: '"11/18/2026 19:10:15.296","0,000000","12,500000","30,000000"', use: 0.425 },
    { case: 'a line without quotes', line: '11/18/2026 19:10:15.296,12.5', use: undefined },
    { case: 'the header', line: '"(PDH-CSV 4.0)","\\\\HOST\\GPU Engine(pid_1_engtype_3D)\\Utilization Percentage"', use: undefined },
    { case: 'a blank line', line: '', use: undefined },
    { case: 'a message', line: 'Exiting, please wait...', use: undefined }
  ])('$case', ({ line, use }) => {
    const read = parseTypeperf(line)
    if (use === undefined) expect(read).toBeUndefined()
    else expect(read).toBeCloseTo(use, 6)
  })
})

describe("macOS's accelerators", () => {
  it.each([
    { case: 'one card', text: '"PerformanceStatistics" = {"Device Utilization %"=37,"Renderer Utilization %"=30}', use: 0.37 },
    { case: 'the busiest of two', text: '"Device Utilization %"=12\n"Device Utilization %"=64', use: 0.64 },
    { case: 'with spaces round the sign', text: '"Device Utilization %" = 5', use: 0.05 },
    { case: 'no card says', text: '+-o AGXAcceleratorG13X  <class AGXAcceleratorG13X>', use: undefined }
  ])('$case', ({ text, use }) => {
    const read = parseIoreg(text)
    if (use === undefined) expect(read).toBeUndefined()
    else expect(read).toBeCloseTo(use, 6)
  })
})

describe("Linux's busy files", () => {
  it.each([
    { text: '42\n', use: 0.42 },
    { text: '0', use: 0 },
    { text: '100', use: 1 },
    { text: '', use: undefined },
    { text: 'unknown', use: undefined }
  ])('"$text"', ({ text, use }) => {
    const read = parseBusyPercent(text)
    if (use === undefined) expect(read).toBeUndefined()
    else expect(read).toBeCloseTo(use, 6)
  })

  it('reads one file per card, not per output', () => {
    expect(busyFiles(['card0', 'card0-HDMI-A-1', 'card1', 'renderD128', 'version'])).toEqual([
      posix.join('/sys/class/drm', 'card0', 'device', 'gpu_busy_percent'),
      posix.join('/sys/class/drm', 'card1', 'device', 'gpu_busy_percent')
    ])
  })
})

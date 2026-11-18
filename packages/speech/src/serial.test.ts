import { describe, expect, it } from 'vitest'
import { createSerial } from './serial.ts'

const later = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

describe('work done one piece at a time', () => {
  it('runs in the order given, each piece after the one before has finished', async () => {
    const serial = createSerial()
    const log: string[] = []
    const piece = (name: string, takes: number) => async () => {
      log.push(`${name} starts`)
      await later(takes)
      log.push(`${name} ends`)
      return name
    }

    const outcomes = await Promise.all([serial.run(piece('slow', 30)), serial.run(piece('fast', 1)), serial.run(() => 'plain')])

    expect(outcomes).toEqual(['slow', 'fast', 'plain'])
    expect(log).toEqual(['slow starts', 'slow ends', 'fast starts', 'fast ends'])
  })

  it('goes on after a piece that fails, and tells whoever gave it', async () => {
    const serial = createSerial()

    const failed = serial.run(async () => {
      throw new Error('broken')
    })
    const thrown = serial.run(() => {
      throw new Error('thrown')
    })
    const after = serial.run(() => 'still running')

    await expect(failed).rejects.toThrow('broken')
    await expect(thrown).rejects.toThrow('thrown')
    expect(await after).toBe('still running')
  })
})

import { describe, expect, it } from 'vitest'
import { createDesktop } from './desktop.ts'
import { systems } from './system/index.ts'
import type { Helper, Questions, ScreenSystem } from './system/system.ts'

/** A system whose helper answers from a table and remembers what it was asked. */
function standIn(systemKeys: ScreenSystem['systemKeys'] = systems.win32.systemKeys) {
  const asked: { name: string; input: unknown }[] = []
  const helper: Helper = {
    ask: async (name, input) => {
      asked.push({ name, input })
      if (name === 'tree') return [{ key: 'k7', role: 'ControlType.Button', name: 'Play', depth: 0 }] as Questions[typeof name]['output']
      return null as Questions[typeof name]['output']
    },
    close: async () => undefined
  }
  const system: ScreenSystem = { find: async () => ({ available: true }), helper: () => helper, keys: () => ({}), systemKeys }
  return { desktop: createDesktop({ folder: 'helper', system }), asked }
}

describe("a widget's button, on the computer", () => {
  it('presses a key of the whole system as the system names it, and opens a link', async () => {
    const { desktop, asked } = standIn({ ...systems.win32.systemKeys, MediaNext: 'next' })
    await desktop.systemKey('MediaNext', 2)
    await desktop.systemKey('VolumeUp', 1)
    await desktop.open('spotify:playlist:37i9dQZF1DX4kZR8vL5oVX')
    expect(asked).toEqual([
      { name: 'systemKey', input: { key: 'next', times: 2 } },
      { name: 'systemKey', input: { key: 0xaf, times: 1 } },
      { name: 'open', input: { link: 'spotify:playlist:37i9dQZF1DX4kZR8vL5oVX' } }
    ])
  })

  it('gives a reference to an element sought by name, which a click then reaches', async () => {
    const { desktop, asked } = standIn()
    const ref = await desktop.seek('w1', 'play', 'button')
    expect(ref).toMatch(/^e\d+$/)
    await desktop.click(ref as string)
    expect(asked.at(-1)).toEqual({ name: 'click', input: { key: 'k7' } })
    expect(await desktop.seek('w1', 'Pause')).toBeUndefined()
  })

  it('says plainly when the computer has no such key, and asks its helper nothing', async () => {
    const { desktop, asked } = standIn(systems.darwin.systemKeys)
    await expect(desktop.systemKey('MediaStop', 1)).rejects.toThrow('This computer has no stop key.')
    expect(asked).toEqual([])
  })
})

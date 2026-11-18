import { describe, expect, it } from 'vitest'
import { createDesktop } from './desktop.ts'
import { systems } from './system/index.ts'
import type { Helper, Questions, ScreenSystem } from './system/system.ts'

/** A system whose helper answers from a table and remembers what it was asked. */
function standIn(acts: ScreenSystem['acts']) {
  const asked: { name: string; input: unknown }[] = []
  const helper: Helper = {
    ask: async (name, input) => {
      asked.push({ name, input })
      if (name === 'tree') return [{ key: 'k7', role: 'ControlType.Button', name: 'Play', depth: 0 }] as Questions[typeof name]['output']
      return null as Questions[typeof name]['output']
    },
    close: async () => undefined
  }
  const system: ScreenSystem = { find: async () => ({ available: true }), helper: () => helper, keys: () => ({}), acts }
  return { desktop: createDesktop({ folder: 'helper', system }), asked }
}

describe("a widget's button, on the computer", () => {
  it('presses a key of the whole system as the system names it, and opens a link', async () => {
    const { desktop, asked } = standIn({ systemKeys: { ...systems.win32.acts?.systemKeys, MediaNext: 'next' } as never })
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
    const { desktop, asked } = standIn(undefined)
    const ref = await desktop.seek('w1', 'play', 'button')
    expect(ref).toMatch(/^e\d+$/)
    await desktop.click(ref as string)
    expect(asked.at(-1)).toEqual({ name: 'click', input: { key: 'k7' } })
    expect(await desktop.seek('w1', 'Pause')).toBeUndefined()
  })

  it('says plainly where the system cannot act for a button yet', async () => {
    const { desktop, asked } = standIn(undefined)
    await expect(desktop.systemKey('MediaPlayPause', 1)).rejects.toThrow('Buttons that act on the computer work on Windows only, for now.')
    await expect(desktop.open('spotify:playlist:1')).rejects.toThrow('Windows only')
    expect(asked).toEqual([])
  })

  it.each([
    ['win32', true],
    ['darwin', false],
    ['linux', false]
  ] as const)('on %s, acts for a button: %s', (name, acts) => {
    expect(systems[name].acts !== undefined).toBe(acts)
  })
})

import { describe, expect, it } from 'vitest'
import { createDesktop } from './desktop.ts'
import { systems } from './system/index.ts'
import type { Helper, Questions, RawWindow, ScreenSystem } from './system/system.ts'

type Answers = { [Name in keyof Questions]?: Questions[Name]['output'] }

const NOTES: RawWindow = {
  id: 'w1',
  program: 'notes',
  app: 'Notes',
  title: 'Notes',
  bounds: { x: 0, y: 0, width: 800, height: 600 },
  focused: true,
  minimized: false
}

/** A system whose helper answers from a table and remembers what it was asked. */
function standIn({ systemKeys = systems.win32.systemKeys, answers = {} }: { systemKeys?: ScreenSystem['systemKeys']; answers?: Answers } = {}) {
  const asked: { name: string; input: unknown }[] = []
  const table: Answers = { windows: [NOTES], tree: [{ key: 'k7', role: 'ControlType.Button', name: 'Play', depth: 0 }], ...answers }
  const helper: Helper = {
    ask: async (name, input) => {
      asked.push({ name, input })
      return (table[name] ?? null) as Questions[typeof name]['output']
    },
    close: async () => undefined
  }
  const system: ScreenSystem = { find: async () => ({ available: true }), helper: () => helper, keys: () => ({}), systemKeys }
  return { desktop: createDesktop({ folder: 'helper', system }), asked }
}

describe("a widget's button, on the computer", () => {
  it('presses a key of the whole system as the system names it, and opens a link', async () => {
    const { desktop, asked } = standIn({ systemKeys: { ...systems.win32.systemKeys, MediaNext: 'next' } })
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
    const { desktop, asked } = standIn({ systemKeys: systems.darwin.systemKeys })
    await expect(desktop.systemKey('MediaStop', 1)).rejects.toThrow('This computer has no stop key.')
    expect(asked).toEqual([])
  })
})

describe('an element of another app, as the core weighs it', () => {
  it.each([
    ['AXTextField', 'text field'],
    ['ControlType.ComboBox', 'combo box'],
    ['AXSecureTextField', 'password field'],
    ['password text', 'password field']
  ])('reads the role %s as the outline shows it: %s', async (role, read) => {
    const element = { role, name: 'Card number', password: false, enabled: true, hints: [], window: 'w1' }
    const { desktop } = standIn({ answers: { tree: [{ key: 'k1', role, name: 'Card number', depth: 0 }], inspect: element } })

    const { outline } = await desktop.look('w1', 1_000)

    expect(outline).toBe(`- ${read} "Card number" [e1]`)
    expect(await desktop.inspect('e1')).toMatchObject({ ref: 'e1', role: read, window: NOTES })
  })

  it('says the window is gone when it closed as it was brought forward', async () => {
    const { desktop } = standIn({ answers: { focus: null } })
    await expect(desktop.focus('w1')).rejects.toThrow('There is no window w1 open now.')
  })
})

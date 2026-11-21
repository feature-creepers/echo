import { describe, expect, it } from 'vitest'
import { createDesktop } from './desktop.ts'
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

/** A system whose helper answers from a table. */
function standIn({ answers = {} }: { answers?: Answers } = {}) {
  const table: Answers = { windows: [NOTES], tree: [{ key: 'k7', role: 'ControlType.Button', name: 'Play', depth: 0 }], ...answers }
  const helper: Helper = {
    ask: async (name) => (table[name] ?? null) as Questions[typeof name]['output'],
    close: async () => undefined
  }
  const system: ScreenSystem = { find: async () => ({ available: true }), helper: () => helper, keys: () => ({}) }
  return { desktop: createDesktop({ folder: 'helper', system }) }
}

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

import { describe, expect, it } from 'vitest'
import type { DesktopElement, WindowFacts } from '../ports/desktop.ts'
import { type DesktopAct, decideDesktopAct } from './policy.ts'

const window: WindowFacts = {
  id: 'w1',
  program: 'notepad',
  app: 'Notepad',
  title: 'notes.txt - Notepad',
  bounds: { x: 0, y: 0, width: 800, height: 600 },
  focused: true,
  minimized: false
}
const element = (role: string, name: string, more: Partial<DesktopElement> = {}): DesktopElement => ({
  ref: 'e1',
  role,
  name,
  password: false,
  enabled: true,
  hints: [],
  window,
  ...more
})

const click = (name: string): DesktopAct => ({ kind: 'click', element: element('button', name) })
const type = (field: DesktopElement, submit = false): DesktopAct => ({ kind: 'type', element: field, text: 'hello', submit })
const press = (key: string, on?: DesktopElement): DesktopAct => ({ kind: 'press', key, element: on, window })

describe('what the assistant may do in another app', () => {
  it.each([
    { name: 'a plain click, trusted', act: click('Bold'), level: 'trust', verdict: { verdict: 'go' } },
    { name: 'a plain click, asking', act: click('Bold'), level: 'ask', verdict: { verdict: 'ask', always: false } },
    { name: 'a button that sends', act: click('Send'), level: 'auto', verdict: { verdict: 'ask', always: true, because: 'sends' } },
    { name: 'a button that deletes', act: click('Supprimer'), level: 'auto', verdict: { verdict: 'ask', always: true, because: 'deletes' } },
    { name: 'a button that pays', act: click('Place order'), level: 'trust', verdict: { verdict: 'ask', always: true, because: 'pays' } },
    { name: 'typing in a field', act: type(element('edit', 'File name')), level: 'trust', verdict: { verdict: 'go' } },
    {
      name: 'typing in a box the system marks as a password',
      act: type(element('edit', 'Code', { password: true })),
      level: 'auto',
      verdict: { verdict: 'refuse', secret: 'password' }
    },
    {
      name: 'typing in a field named for a password',
      act: type(element('edit', 'Mot de passe')),
      level: 'auto',
      verdict: { verdict: 'refuse', secret: 'password' }
    },
    { name: 'typing in a card number', act: type(element('text', 'Card number')), level: 'auto', verdict: { verdict: 'refuse', secret: 'card' } },
    {
      name: 'a message typed and sent',
      act: type(element('edit', 'Type a message'), true),
      level: 'auto',
      verdict: { verdict: 'ask', always: true, because: 'sends' }
    },
    { name: 'a search typed and entered', act: type(element('edit', 'Search'), true), level: 'trust', verdict: { verdict: 'go' } },
    { name: 'a key that moves', act: press('ArrowDown'), level: 'ask', verdict: { verdict: 'go' } },
    { name: 'Tab out of a password box', act: press('Tab', element('edit', 'Password', { password: true })), level: 'ask', verdict: { verdict: 'go' } },
    {
      name: 'Enter in a password box',
      act: press('Enter', element('edit', 'Password', { password: true })),
      level: 'auto',
      verdict: { verdict: 'refuse', secret: 'password' }
    },
    { name: 'Delete', act: press('Delete'), level: 'auto', verdict: { verdict: 'ask', always: true, because: 'deletes' } },
    { name: 'Ctrl+Enter', act: press('Ctrl + Enter'), level: 'auto', verdict: { verdict: 'ask', always: true, because: 'sends' } },
    { name: 'Control+S', act: press('Control+S'), level: 'trust', verdict: { verdict: 'go' } },
    { name: 'a button that mentions a password', act: click('Forgot your password?'), level: 'trust', verdict: { verdict: 'go' } }
  ] as const)('$name: $verdict.verdict', ({ act, level, verdict }) => {
    expect(decideDesktopAct(act, level)).toEqual(verdict)
  })
})

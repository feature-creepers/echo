import { describe, expect, it } from 'vitest'
import { describeShortcut, isShortcut, type KeyPress, keyOf, matchesShortcut, recordShortcut, sameShortcut, shortcutKeys } from './shortcuts.ts'

const press = (code: string, held: Partial<Omit<KeyPress, 'code'>> = {}): KeyPress => ({ code, ctrl: false, meta: false, alt: false, shift: false, ...held })

describe('a shortcut, recorded from the keys pressed', () => {
  it('is written the way Electron reads it, with Control standing for Command on a Mac', () => {
    expect(recordShortcut(press('Space', { ctrl: true, shift: true }), false)).toEqual({ is: 'shortcut', accelerator: 'CommandOrControl+Shift+Space' })
    expect(recordShortcut(press('Space', { meta: true, shift: true }), true)).toEqual({ is: 'shortcut', accelerator: 'CommandOrControl+Shift+Space' })
    expect(recordShortcut(press('KeyK', { ctrl: true }), true)).toEqual({ is: 'shortcut', accelerator: 'Control+K' })
    expect(recordShortcut(press('Digit5', { meta: true, alt: true }), false)).toEqual({ is: 'shortcut', accelerator: 'Super+Alt+5' })
  })

  it('waits while only modifiers are held', () => {
    expect(recordShortcut(press('ShiftLeft', { shift: true }), false)).toEqual({ is: 'waiting' })
    expect(recordShortcut(press('ControlLeft', { ctrl: true }), false)).toEqual({ is: 'waiting' })
  })

  it('refuses keys that would fire while the user types, and those kept for editing', () => {
    expect(recordShortcut(press('KeyA'), false)).toMatchObject({ is: 'refused', problem: expect.stringContaining('while you type') })
    expect(recordShortcut(press('KeyA', { shift: true }), false)).toMatchObject({ is: 'refused' })
    expect(recordShortcut(press('KeyV', { ctrl: true }), false)).toMatchObject({
      is: 'refused',
      problem: 'Ctrl+V is kept for editing text and for the window.'
    })
    expect(recordShortcut(press('KeyC', { meta: true }), true)).toMatchObject({ is: 'refused' })
    // With more held, the same letter is free.
    expect(recordShortcut(press('KeyV', { ctrl: true, shift: true }), false)).toEqual({ is: 'shortcut', accelerator: 'CommandOrControl+Shift+V' })
  })

  it('takes an F-key alone', () => {
    expect(recordShortcut(press('F9'), false)).toEqual({ is: 'shortcut', accelerator: 'F9' })
  })
})

describe('a key pressed in the window', () => {
  it('matches a shortcut with the same key and exactly the same modifiers', () => {
    expect(matchesShortcut(press('Space', { ctrl: true }), 'CommandOrControl+Space', false)).toBe(true)
    expect(matchesShortcut(press('Space', { meta: true }), 'CommandOrControl+Space', true)).toBe(true)
    expect(matchesShortcut(press('Space', { ctrl: true }), 'CommandOrControl+Space', true)).toBe(false)
    expect(matchesShortcut(press('Space', { ctrl: true, shift: true }), 'CommandOrControl+Space', false)).toBe(false)
    expect(matchesShortcut(press('KeyT', { ctrl: true }), 'Ctrl+T', false)).toBe(true)
    expect(matchesShortcut(press('KeyT', { ctrl: true }), '', false)).toBe(false)
  })
})

describe('shortcuts written down', () => {
  it('are checked: modifiers Electron knows, then one key', () => {
    expect(isShortcut('CommandOrControl+Shift+Space')).toBe(true)
    expect(isShortcut('Alt+F4')).toBe(true)
    expect(isShortcut('Ctrl+Ctrl+A')).toBe(false)
    expect(isShortcut('Hyper+A')).toBe(false)
    expect(isShortcut('Ctrl+')).toBe(false)
    expect(isShortcut('Ctrl+Shift')).toBe(false)
  })

  it('are the same when the same keys press them, however they are written', () => {
    expect(sameShortcut('CommandOrControl+T', 'Control+T', false)).toBe(true)
    expect(sameShortcut('CommandOrControl+T', 'Control+T', true)).toBe(false)
    expect(sameShortcut('Shift+Alt+K', 'Alt+Shift+K', true)).toBe(true)
  })

  it('are shown as each system labels its keys', () => {
    expect(shortcutKeys('CommandOrControl+Shift+Space', false)).toEqual(['Ctrl', 'Shift', 'Space'])
    expect(shortcutKeys('CommandOrControl+Shift+Space', true)).toEqual(['⇧', '⌘', 'Space'])
    expect(shortcutKeys('Alt+Up', false)).toEqual(['Alt', '↑'])
    expect(describeShortcut('CommandOrControl+Shift+Space', false)).toBe('Ctrl+Shift+Space')
    expect(describeShortcut('CommandOrControl+Shift+Space', true)).toBe('⇧⌘Space')
    expect(shortcutKeys('nonsense', false)).toEqual([])
  })

  it('name the keys of a browser by Electron’s names', () => {
    expect(keyOf('KeyQ')).toBe('Q')
    expect(keyOf('ArrowLeft')).toBe('Left')
    expect(keyOf('F24')).toBe('F24')
    expect(keyOf('F25')).toBeUndefined()
    expect(keyOf('MetaLeft')).toBeUndefined()
  })
})

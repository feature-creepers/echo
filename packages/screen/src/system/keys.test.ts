import { describe, expect, it } from 'vitest'
import { readKey } from '../keys.ts'
import { systems } from './index.ts'

const read = (written: string) => {
  const combination = readKey(written)
  if ('problem' in combination) throw new Error(combination.problem)
  return combination
}

describe('a key as each system presses it', () => {
  it.each([
    { written: 'Enter', win32: { modifiers: [], key: 0x0d, character: '' }, darwin: { code: 36, character: '', using: [] }, linux: 'Return' },
    {
      written: 'Control+S',
      win32: { modifiers: [0x11], key: 0x53, character: '' },
      darwin: { code: null, character: 's', using: ['control down'] },
      linux: 'ctrl+s'
    },
    {
      written: 'Meta+Shift+ArrowLeft',
      win32: { modifiers: [0x5b, 0x10], key: 0x25, character: '' },
      darwin: { code: 123, character: '', using: ['command down', 'shift down'] },
      linux: 'super+shift+Left'
    },
    {
      written: 'Alt+F4',
      win32: { modifiers: [0x12], key: 0x73, character: '' },
      darwin: { code: 118, character: '', using: ['option down'] },
      linux: 'alt+F4'
    },
    { written: 'é', win32: { modifiers: [], key: 0, character: 'é' }, darwin: { code: null, character: 'é', using: [] }, linux: 'U00E9' }
  ])('presses "$written"', ({ written, win32, darwin, linux }) => {
    expect(systems.win32.keys(read(written))).toEqual(win32)
    expect(systems.darwin.keys(read(written))).toEqual(darwin)
    expect(systems.linux.keys(read(written))).toEqual(linux)
  })
})

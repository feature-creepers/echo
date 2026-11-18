import { describe, expect, it } from 'vitest'
import { asksToGoBack, type BackPress } from './going-back.ts'

const press = (key: string, held: Partial<BackPress> = {}): BackPress => ({
  key,
  code: key === '[' ? 'BracketLeft' : key,
  ctrl: false,
  meta: false,
  alt: false,
  shift: false,
  ...held
})

describe('a key press that asks to go back', () => {
  it.each([
    // press, on a Mac, goes back
    [press('ArrowLeft', { alt: true }), false, true],
    [press('ArrowLeft', { alt: true }), true, false],
    [press('ArrowLeft'), false, false],
    [press('ArrowLeft', { alt: true, shift: true }), false, false],
    [press('ArrowLeft', { alt: true, ctrl: true }), false, false],
    [press('[', { meta: true }), true, true],
    [press('[', { meta: true }), false, false],
    [press('[', { ctrl: true }), true, false],
    [press('[', { meta: true, shift: true }), true, false],
    // A layout where the key at the place of [ types something else still goes back, as the system's own shortcut does.
    [{ ...press('ù', { meta: true }), code: 'BracketLeft' }, true, true],
    [press('Escape'), false, false],
    [press('Backspace'), false, false]
  ])('%j on a Mac: %s gives %s', (given, mac, wanted) => {
    expect(asksToGoBack(given, mac)).toBe(wanted)
  })
})

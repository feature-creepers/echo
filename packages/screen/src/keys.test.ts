import { describe, expect, it } from 'vitest'
import { readKey } from './keys.ts'

describe('a key as the assistant names it', () => {
  it.each([
    { written: 'Enter', read: { modifiers: [], key: 'enter' } },
    { written: 'Control+S', read: { modifiers: ['control'], key: 's' } },
    { written: 'Ctrl + Shift + ArrowDown', read: { modifiers: ['control', 'shift'], key: 'arrowdown' } },
    { written: 'cmd+q', read: { modifiers: ['meta'], key: 'q' } },
    { written: 'Esc', read: { modifiers: [], key: 'escape' } },
    { written: 'Alt+F4', read: { modifiers: ['alt'], key: 'f4' } },
    { written: 'Control++', read: { modifiers: ['control'], key: '+' } },
    { written: 'é', read: { modifiers: [], key: 'é' } }
  ])('reads "$written"', ({ written, read }) => {
    expect(readKey(written)).toEqual(read)
  })

  it.each(['Hyper+S', 'Control+Banana', '', 'constructor+A', 'toString'])('says why "%s" cannot be pressed', (written) => {
    expect(readKey(written)).toHaveProperty('problem')
  })
})

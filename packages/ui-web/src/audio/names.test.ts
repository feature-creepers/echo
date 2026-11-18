import { describe, expect, it } from 'vitest'
import { namesAsWords } from './names.ts'

describe('namesAsWords', () => {
  it('gives the voice each name as a word', () => {
    expect(namesAsWords('ADA here. Ask UNIT-7 instead.', ['ADA', 'UNIT-7'])).toBe('Ada here. Ask Unit 7 instead.')
  })

  it('changes a name only where it stands alone', () => {
    expect(namesAsWords('ADAM met ADA, not NADA.', ['ADA'])).toBe('ADAM met Ada, not NADA.')
  })

  it('leaves a sentence with no name as it is', () => {
    expect(namesAsWords('It is sunny in Lyon.', ['ADA'])).toBe('It is sunny in Lyon.')
  })
})

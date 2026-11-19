import { describe, expect, it } from 'vitest'
import { cleanVocabulary, MAX_WORD_LENGTH, MAX_WORDS } from './vocabulary.ts'

describe('the person’s own words, as they are kept', () => {
  it.each([
    [['Barbanneau'], ['Barbanneau']],
    [['  Maëlys   Kerjean  '], ['Maëlys Kerjean']],
    [['json-render', 'JSON-render', 'Json-Render'], ['json-render']],
    [['', '   ', '\t'], []],
    [
      ['Grafana', '', 'Kerjean'],
      ['Grafana', 'Kerjean']
    ]
  ])('keeps %j as %j', (given, kept) => {
    expect(cleanVocabulary(given)).toEqual(kept)
  })

  it('cuts the longest, and keeps the most', () => {
    expect(cleanVocabulary(['a'.repeat(MAX_WORD_LENGTH + 10)])[0]).toHaveLength(MAX_WORD_LENGTH)
    expect(cleanVocabulary(Array.from({ length: MAX_WORDS + 5 }, (_, index) => `word ${index}`))).toHaveLength(MAX_WORDS)
  })
})

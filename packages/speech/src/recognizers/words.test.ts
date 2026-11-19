import { describe, expect, it } from 'vitest'
import { hotwords, piecesVocabulary, WORD_BOOST, writtenCharacters } from './words.ts'

const TOKENS = ['<unk> 0', '<|endoftext|> 1', '▁Bar 2', 'ban 3', 'ne 4', 'au 5', '▁Ma 6', 'ë 7', '▁js 8', 'on 9', '- 10', 'r 11', ''].join('\n')

describe('the pieces the library cuts words with', () => {
  it('scores each piece of the model, the earlier learned the higher', () => {
    expect(piecesVocabulary(TOKENS).split('\n').slice(0, 3)).toEqual(['<unk>\t0', '<|endoftext|>\t-1', '▁Bar\t-2'])
  })

  it('reads a list written with Windows line endings the same', () => {
    expect(piecesVocabulary(TOKENS.replace(/\n/g, '\r\n'))).toBe(piecesVocabulary(TOKENS))
  })

  it('knows the characters they write, not the marks', () => {
    const characters = writtenCharacters(TOKENS)
    expect(characters.has('ë')).toBe(true)
    expect(characters.has('▁')).toBe(false)
    expect(characters.has('<')).toBe(false)
  })
})

describe('the words given for one utterance', () => {
  const characters = writtenCharacters(TOKENS)
  it.each([
    [['Barbanneau'], `Barbanneau :${WORD_BOOST}`],
    [['Barbanneau', 'Maë'], `Barbanneau :${WORD_BOOST}/Maë :${WORD_BOOST}`],
    [['json-ron'], `json-ron :${WORD_BOOST}`],
    // What the library reads as separating or scoring becomes a space.
    [['Bar/ban:ne'], `Bar ban ne :${WORD_BOOST}`],
    // A character no piece writes, and nothing at all, are left out.
    [['Barbanneau 🎉', 'Bar'], `Bar :${WORD_BOOST}`],
    [['  ', ''], ''],
    [[], '']
  ])('gives %j as %j', (words, given) => {
    expect(hotwords(words, characters)).toBe(given)
  })
})

import { describe, expect, it } from 'vitest'
import { languageOf } from './language.ts'

const both = ['en', 'fr']

describe('languageOf', () => {
  it.each([
    ['A mushroom risotto would work, and it suits your guest.', 'en'],
    ['Do you have the tax notice from last year?', 'en'],
    ['Un risotto aux champignons conviendrait à votre invité.', 'fr'],
    ['Avez-vous le dernier avis ?', 'fr'],
    ["C'est prêt.", 'fr']
  ])('reads %j as %s', (sentence, language) => {
    expect(languageOf(sentence, both, undefined)).toBe(language)
  })

  it('falls back when the sentence does not say', () => {
    expect(languageOf('OK.', both, 'fr')).toBe('fr')
    expect(languageOf('Paris, Berlin, Madrid.', both, undefined)).toBeUndefined()
  })

  it('only ever answers with a candidate', () => {
    expect(languageOf('Un risotto aux champignons conviendrait à votre invité.', ['en'], 'en')).toBe('en')
  })
})

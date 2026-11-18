import { describe, expect, it } from 'vitest'
import { phraseOf, saysPhrase } from './phrase.ts'

describe('a confirmation phrase', () => {
  it('is kept as the fingerprint of its words as heard, and refused under two words', () => {
    expect(phraseOf('blue')).toBeUndefined()
    expect(phraseOf('  ')).toBeUndefined()
    expect(phraseOf('Blue harbour')).toEqual({ hash: expect.stringMatching(/^[0-9a-f]{64}$/), words: 2 })
    expect(phraseOf('Blue, Harbour!')).toEqual(phraseOf('blue harbour'))
  })

  const phrase = phraseOf('Soleil de minuit') as NonNullable<ReturnType<typeof phraseOf>>
  it.each([
    { said: 'soleil de minuit', heard: true },
    { said: 'Oui, soleil de minuit.', heard: true },
    { said: 'soleil de minuit pour la session', heard: true },
    { said: 'SOLEIL DE MINUIT', heard: true },
    { said: 'soleil minuit', heard: false },
    { said: 'soleil de midi', heard: false },
    { said: 'oui', heard: false },
    { said: '', heard: false }
  ])('is heard in “$said”: $heard', ({ said, heard }) => {
    expect(saysPhrase(said, phrase)).toBe(heard)
  })
})

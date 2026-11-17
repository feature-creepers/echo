import { describe, expect, it } from 'vitest'
import { answerOf } from './words.ts'

describe('answerOf', () => {
  it.each(['Allow', 'Give access', 'Run it', 'yes', 'Yes, go ahead.', 'ok do it', 'Oui, vas-y', "d'accord"])('hears "%s" as yes', (said) => {
    expect(answerOf(said)).toBe('yes')
  })

  it.each(["Don't allow", 'no', 'No thanks.', 'Non, annule', 'cancel that'])('hears "%s" as no', (said) => {
    expect(answerOf(said)).toBe('no')
  })

  it.each(['What is in that folder?', 'Show me the weather in Lyon tomorrow please', 'no, yes', 'hmm'])('hears "%s" as neither', (said) => {
    expect(answerOf(said)).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'
import { answerOf, stopsEverything } from './words.ts'

describe('answerOf', () => {
  it.each(['Allow', 'Give access', 'Run it', 'yes', 'Yes, go ahead.', 'ok do it', 'Oui, vas-y', "d'accord"])('hears "%s" as yes', (said) => {
    expect(answerOf(said)).toBe('yes')
  })

  it.each([
    'Allow for the session',
    'Yes, for the session',
    'yes for this session',
    'ok, for the whole session',
    'For the session',
    'Oui, pour la session',
    'oui pour toute la session',
    'Autorise pour cette session'
  ])('hears "%s" as yes for the session', (said) => {
    expect(answerOf(said)).toBe('session')
  })

  it.each(["Don't allow", 'no', 'No thanks.', 'Non, annule', 'cancel that', 'no, not for the session', "don't allow for the session"])(
    'hears "%s" as no',
    (said) => {
      expect(answerOf(said)).toBe('no')
    }
  )

  it.each(['What is in that folder?', 'Show me the weather in Lyon tomorrow please', 'no, yes', 'hmm'])('hears "%s" as neither', (said) => {
    expect(answerOf(said)).toBeUndefined()
  })
})

describe('stopsEverything', () => {
  it.each(['Stop everything', 'stop everything!', 'Echo, stop everything', 'Arrête tout', 'arrête tout !', 'Arrêtez tout.', 'stop it all'])(
    'hears "%s"',
    (said) => {
      expect(stopsEverything(said)).toBe(true)
    }
  )

  it.each(['stop', 'stop the radio', 'Could you stop everything you were saying about the weather yesterday', 'tout arrêter demain'])(
    'does not hear "%s"',
    (said) => {
      expect(stopsEverything(said)).toBe(false)
    }
  )
})

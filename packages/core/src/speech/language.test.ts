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

  const all = ['en', 'fr', 'es', 'de', 'it', 'pt', 'nl', 'ru', 'uk', 'bg', 'ja', 'ko', 'el', 'hi', 'ar', 'pl']

  it.each([
    ['What is the weather in Lyon this week?', 'en'],
    ['Playing Radio FIP for you now.', 'en'],
    ['Il fait beau à Lyon cette semaine.', 'fr'],
    ['Merci beaucoup.', 'fr'],
    ['Quel temps fait-il demain ?', 'fr'],
    ['¿Qué tiempo hace en Madrid?', 'es'],
    ['Wie wird das Wetter morgen in Berlin?', 'de'],
    ['Che tempo fa a Roma domani?', 'it'],
    ['Como está o tempo em Lisboa amanhã?', 'pt'],
    ['Hoe is het weer morgen in Amsterdam?', 'nl'],
    ['Какая погода будет завтра в Москве?', 'ru'],
    ['Яка погода буде завтра в Києві?', 'uk'],
    ['明日の東京の天気は?', 'ja'],
    ['내일 서울 날씨는 어때요?', 'ko'],
    ['Τι καιρό θα κάνει αύριο;', 'el']
  ])('among many languages, reads %j as %s', (sentence, language) => {
    expect(languageOf(sentence, all, undefined)).toBe(language)
  })

  it('falls back for a language it can only tell by letters it does not count', () => {
    expect(languageOf('Jaka będzie jutro pogoda w Warszawie?', all, 'pl')).toBe('pl')
  })

  it('only ever answers with a candidate', () => {
    expect(languageOf('Un risotto aux champignons conviendrait à votre invité.', ['en'], 'en')).toBe('en')
  })
})

import type { VoiceStyles } from '@repo/client'
import { LANGUAGE_CODES, type Persona } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { introduction } from './introductions.ts'
import { firstLanguage } from './voice-picker.tsx'
import { languageOf, paceOf, styleOf, styleOfStance, withPick } from './voice-styles.ts'

const ally: Persona = { id: 'first', name: 'Ada', stance: 'accommodating', accent: 'cyan', look: 'hud' }
const critic: Persona = { id: 'second', name: 'Grace', stance: 'critical', accent: 'red', look: 'lens' }

/** The voice's styles, as its engine names them. */
const STYLES = ['f1', 'f2', 'f3', 'f4', 'f5', 'm1', 'm2', 'm3', 'm4', 'm5']

describe('the style of a stance', () => {
  it.each([
    ['accommodating', 'm3'],
    ['critical', 'm5']
  ] as const)('speaks the %s stance in %s, one of the voice styles', (stance, style) => {
    expect(styleOfStance(stance)).toBe(style)
    expect(STYLES).toContain(style)
  })

  it('sets the two stances apart', () => {
    expect(styleOfStance('accommodating')).not.toBe(styleOfStance('critical'))
  })
})

describe('the style of a persona', () => {
  const picked: VoiceStyles = { first: { fr: 'm1' }, second: { en: 'f1' } }

  it.each([
    ['the style picked in that language', ally, 'fr', 'm1'],
    ['the style picked, from a language written as a sentence writes it', ally, 'fr-CA', 'm1'],
    ["its stance's style in a language with none picked", ally, 'en', 'm3'],
    ["its stance's style in a language the voice does not speak", critic, 'xx', 'm5'],
    ['its own pick, not another persona’s', critic, 'fr', 'm5'],
    ['the other persona’s pick in its language', critic, 'en', 'f1'],
    ["the accommodating stance's style with no persona", undefined, 'en', 'm3']
  ])('is %s', (_case, persona, language, style) => {
    expect(styleOf(persona, language, picked)).toBe(style)
  })

  it('finds nothing an object inherits for a persona or a language named like its properties', () => {
    const named: Persona = { ...ally, id: 'constructor' }
    expect(styleOf(named, 'en', {})).toBe('m3')
    expect(styleOf(ally, 'constructor', { first: {} })).toBe('m3')
  })
})

describe('a pick', () => {
  it.each<[string, VoiceStyles, Persona, string, string, VoiceStyles]>([
    ['adds a language to a persona', { first: { fr: 'm1' } }, ally, 'de', 'm4', { first: { fr: 'm1', de: 'm4' } }],
    ['changes a language picked before', { first: { fr: 'm1' } }, ally, 'fr', 'm2', { first: { fr: 'm2' } }],
    ["lets a pick go when it is the stance's own style", { first: { fr: 'm1', de: 'm4' } }, ally, 'fr', 'm3', { first: { de: 'm4' } }],
    ['lets the persona go with its last pick', { first: { fr: 'm1' }, second: { en: 'f1' } }, ally, 'fr', 'm3', { second: { en: 'f1' } }],
    ['keeps nothing for a pick of the stance’s own style', {}, critic, 'en', 'm5', {}],
    ['keeps the language as a code', {}, critic, 'fr-FR', 'm2', { second: { fr: 'm2' } }],
    ['leaves the other personas as they were', { second: { en: 'f1' } }, ally, 'en', 'f3', { second: { en: 'f1' }, first: { en: 'f3' } }]
  ])('%s', (_case, before, persona, language, style, after) => {
    expect(withPick(before, persona, language, style)).toEqual(after)
  })

  it('does not change the picks it is given', () => {
    const before: VoiceStyles = { first: { fr: 'm1' } }
    withPick(before, ally, 'fr', 'm2')
    expect(before).toEqual({ first: { fr: 'm1' } })
  })
})

describe('the language of a sentence', () => {
  it.each([
    ['en', 'en'],
    ['fr-FR', 'fr'],
    ['pt_BR', 'pt'],
    ['DE', 'de'],
    ['', '']
  ])('is %s for %s', (written, code) => {
    expect(languageOf(written)).toBe(code)
  })
})

describe('the pace of a persona', () => {
  it.each([
    [ally, 1, 1],
    [critic, 1, 0.95],
    [critic, 1.3, 1.235],
    [undefined, 1.15, 1.15]
  ])('from the pace set', (persona, speed, pace) => {
    expect(paceOf(persona, speed)).toBeCloseTo(pace)
  })
})

describe('the language whose voices are shown first', () => {
  it.each([
    ['the one answered in', { spoken: 'auto', answers: 'de' }, 'de'],
    ['the one spoken, when answers follow it', { spoken: 'it', answers: 'spoken' }, 'it'],
    ['English, when both are found from what is said', { spoken: 'auto', answers: 'spoken' }, 'en'],
    ['English, before the settings are known', undefined, 'en']
  ] as const)('is %s', (_case, languages, language) => {
    expect(firstLanguage(languages)).toBe(language)
  })
})

describe('the introduction of a persona', () => {
  it.each(LANGUAGE_CODES)('says its name in %s', (language) => {
    expect(introduction(language, 'Ada')).toContain('Ada')
  })

  it('is in English in a language the voice does not speak', () => {
    expect(introduction('xx', 'Ada')).toBe(introduction('en', 'Ada'))
  })

  it('is in each language its own sentence', () => {
    const sentences = LANGUAGE_CODES.map((language) => introduction(language, 'Ada'))
    expect(new Set(sentences).size).toBe(LANGUAGE_CODES.length)
  })
})

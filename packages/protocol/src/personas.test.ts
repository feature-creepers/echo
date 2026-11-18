import { describe, expect, it } from 'vitest'
import { PERSONA_NAME_MAX_LENGTH, personaSchema, readPersonaName, samePersonaName } from './personas.ts'

describe('readPersonaName', () => {
  it.each([
    ['Ada', 'Ada'],
    ['Unit 9000', 'Unit 9000'],
    ['R2-D2', 'R2-D2'],
    ["O'Neil", "O'Neil"],
    ['Ève', 'Ève'],
    ['小爱', '小爱'],
    ['Dr. Watson', 'Dr. Watson']
  ])('accepts %s', (typed, name) => {
    expect(readPersonaName(typed)).toEqual({ ok: true, name })
  })

  it('drops surrounding spaces and joins runs of spaces', () => {
    expect(readPersonaName('  Mary   Jane \t')).toEqual({ ok: true, name: 'Mary Jane' })
  })

  it('stores composed and decomposed accents the same way', () => {
    const decomposed = 'Ève'
    expect(readPersonaName(decomposed)).toEqual({ ok: true, name: 'Ève' })
  })

  it.each(['', '   ', '\n'])('refuses an empty name (%j)', (typed) => {
    expect(readPersonaName(typed)).toEqual({ ok: false, problem: 'empty' })
  })

  it('counts characters, not bytes, against the limit', () => {
    expect(readPersonaName('é'.repeat(PERSONA_NAME_MAX_LENGTH)).ok).toBe(true)
    expect(readPersonaName('é'.repeat(PERSONA_NAME_MAX_LENGTH + 1))).toEqual({ ok: false, problem: 'too-long' })
  })

  it.each(['<b>', 'a/b', 'name@home', '🙂', 'tab\u0000'])('refuses what cannot be said (%j)', (typed) => {
    expect(readPersonaName(typed)).toEqual({ ok: false, problem: 'characters' })
  })

  it.each(['-', "'", '. .'])('refuses a name with no letter or digit (%j)', (typed) => {
    expect(readPersonaName(typed)).toEqual({ ok: false, problem: 'characters' })
  })
})

describe('samePersonaName', () => {
  it('ignores case', () => {
    expect(samePersonaName('ADA', 'ada')).toBe(true)
    expect(samePersonaName('Ève', 'ÈVE')).toBe(true)
  })

  it('tells different names apart', () => {
    expect(samePersonaName('Ada', 'Adam')).toBe(false)
  })
})

describe('a persona as data', () => {
  it('keeps the look it is given, whatever its accent', () => {
    const persona = personaSchema.parse({ id: 'first', name: 'Ada', stance: 'critical', accent: 'cyan', look: 'lens' })
    expect(persona.look).toBe('lens')
  })

  it.each([
    ['cyan', 'hud'],
    ['red', 'lens']
  ] as const)('gives a persona written before looks existed the look of its accent (%s)', (accent, look) => {
    expect(personaSchema.parse({ id: 'first', name: 'Ada', stance: 'accommodating', accent }).look).toBe(look)
  })

  it('refuses a look it does not know', () => {
    expect(personaSchema.safeParse({ id: 'first', name: 'Ada', stance: 'accommodating', accent: 'cyan', look: 'crystal' }).success).toBe(false)
  })
})

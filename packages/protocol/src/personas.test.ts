import { describe, expect, it } from 'vitest'
import { earlierPersonaName, PERSONA_NAME_MAX_LENGTH, personaSchema, readPersonaName, samePersonaName, spokenPersonaName } from './personas.ts'

describe('readPersonaName', () => {
  it.each([
    ['ADA', 'ADA'],
    ['UNIT-9000', 'UNIT-9000'],
    ['R2-D2', 'R2-D2'],
    ['7', '7']
  ])('accepts %s', (typed, name) => {
    expect(readPersonaName(typed)).toEqual({ ok: true, name })
  })

  it.each([
    ['ada', 'ADA'],
    ['Unit 9000', 'UNIT-9000'],
    ['  Mary   Jane \t', 'MARY-JANE'],
    ['Ève', 'EVE'],
    ['Zoë', 'ZOE']
  ])('writes %j as a name is kept', (typed, name) => {
    expect(readPersonaName(typed)).toEqual({ ok: true, name })
  })

  it('reads composed and decomposed accents the same way', () => {
    expect(readPersonaName('E\u0300ve')).toEqual(readPersonaName('\u00c8ve'))
  })

  it.each(['', '   ', '\n'])('refuses an empty name (%j)', (typed) => {
    expect(readPersonaName(typed)).toEqual({ ok: false, problem: 'empty' })
  })

  it('refuses a name longer than the limit', () => {
    expect(readPersonaName('A'.repeat(PERSONA_NAME_MAX_LENGTH)).ok).toBe(true)
    expect(readPersonaName('A'.repeat(PERSONA_NAME_MAX_LENGTH + 1))).toEqual({ ok: false, problem: 'too-long' })
  })

  it.each(['<b>', 'a/b', 'name@home', '🙂', "O'Neil", 'Dr. Watson', '小爱', 'tab\u0000'])('refuses what is not capitals, digits and hyphens (%j)', (typed) => {
    expect(readPersonaName(typed)).toEqual({ ok: false, problem: 'characters' })
  })

  it.each(['-', '-ADA', 'ADA-', 'A--B'])('refuses hyphens that join nothing (%j)', (typed) => {
    expect(readPersonaName(typed)).toEqual({ ok: false, problem: 'characters' })
  })
})

describe('earlierPersonaName', () => {
  it.each([
    ['Ada', 'ADA'],
    ["O'Neil", 'O-NEIL'],
    ['Dr. Watson', 'DR-WATSON'],
    ['Ève', 'EVE'],
    ['  R2 D2 ', 'R2-D2']
  ])('keeps %j as %j', (kept, name) => {
    expect(earlierPersonaName(kept)).toBe(name)
  })

  it('keeps no name made only of what cannot be written', () => {
    expect(earlierPersonaName('小爱')).toBeUndefined()
    expect(earlierPersonaName("'. .")).toBeUndefined()
  })

  it('cuts a long name at the limit, never on a hyphen', () => {
    const name = earlierPersonaName(`${'A'.repeat(PERSONA_NAME_MAX_LENGTH - 1)} BCD`)
    expect(name).toBe('A'.repeat(PERSONA_NAME_MAX_LENGTH - 1))
    expect(readPersonaName(name ?? '').ok).toBe(true)
  })
})

describe('spokenPersonaName', () => {
  it('says a name as a word', () => {
    expect(spokenPersonaName('ADA')).toBe('Ada')
    expect(spokenPersonaName('UNIT-7')).toBe('Unit 7')
  })
})

describe('samePersonaName', () => {
  it('ignores case', () => {
    expect(samePersonaName('ADA', 'ada')).toBe(true)
    expect(samePersonaName('Ève', 'ÈVE')).toBe(true)
  })

  it('tells different names apart', () => {
    expect(samePersonaName('ADA', 'ADAM')).toBe(false)
  })
})

describe('a persona as data', () => {
  it('reads the blue accent of a persona kept when it was called cyan', () => {
    expect(personaSchema.parse({ id: 'first', name: 'Ada', stance: 'accommodating', accent: 'cyan' }).accent).toBe('blue')
  })

  it('reads a persona kept when each had a look of its own, without it', () => {
    expect(personaSchema.parse({ id: 'first', name: 'Ada', stance: 'critical', accent: 'red', look: 'lens' })).toEqual({
      id: 'first',
      name: 'Ada',
      stance: 'critical',
      accent: 'red'
    })
  })
})

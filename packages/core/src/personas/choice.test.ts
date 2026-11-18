import type { Persona } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { applyChoice, type Cast, checkChoice, readChoice } from './choice.ts'

const first: Persona = { id: 'first', name: 'Ada', stance: 'accommodating', accent: 'cyan', look: 'hud' }
const second: Persona = { id: 'second', name: 'Grace', stance: 'critical', accent: 'red', look: 'lens' }
const cast: Cast = { available: [first, second], active: 'first' }

describe('checkChoice', () => {
  it('accepts new names and puts them in the form they are kept in', () => {
    const check = checkChoice(cast, { names: [{ persona: 'second', name: '  Mary   Jane ' }], active: 'second' })
    expect(check).toEqual({ ok: true, choice: { names: [{ persona: 'second', name: 'Mary Jane' }], active: 'second' } })
  })

  it('accepts a choice that names nobody', () => {
    expect(checkChoice(cast, { names: [], active: 'second' })).toEqual({ ok: true, choice: { names: [], active: 'second' } })
  })

  it('lets two personas swap names', () => {
    const check = checkChoice(cast, {
      names: [
        { persona: 'first', name: 'Grace' },
        { persona: 'second', name: 'Ada' }
      ],
      active: 'first'
    })
    expect(check.ok).toBe(true)
  })

  it.each([
    ['a persona that does not exist', { names: [{ persona: 'third', name: 'Alan' }], active: 'first' }, 'unknown-persona'],
    ['an active persona that does not exist', { names: [], active: 'third' }, 'unknown-persona'],
    ['a persona named twice', { names: [first, first].map((p) => ({ persona: p.id, name: 'Alan' })), active: 'first' }, 'invalid-input'],
    ['an empty name', { names: [{ persona: 'first', name: '   ' }], active: 'first' }, 'invalid-name'],
    ['a name that cannot be said', { names: [{ persona: 'first', name: '<script>' }], active: 'first' }, 'invalid-name'],
    ['the name another persona keeps', { names: [{ persona: 'first', name: 'grace' }], active: 'first' }, 'name-taken'],
    [
      'the same name given to two personas',
      {
        names: [
          { persona: 'first', name: 'Alan' },
          { persona: 'second', name: 'ALAN' }
        ],
        active: 'first'
      },
      'name-taken'
    ]
  ])('refuses %s', (_what, asked, code) => {
    expect(checkChoice(cast, asked)).toMatchObject({ ok: false, error: { code } })
  })
})

describe('applyChoice', () => {
  it('renames the personas named and leaves the others', () => {
    expect(applyChoice(cast, { names: [{ persona: 'second', name: 'Marvin' }], active: 'second' })).toEqual({
      available: [first, { ...second, name: 'Marvin' }],
      active: 'second'
    })
  })

  it('skips what it says about a persona that no longer exists', () => {
    expect(applyChoice(cast, { names: [{ persona: 'gone', name: 'Alan' }], active: 'gone' })).toEqual(cast)
  })
})

describe('readChoice', () => {
  it('reads what was written', () => {
    const choice = { names: [{ persona: 'first', name: 'Alan' }], active: 'first' }
    expect(readChoice(choice)).toEqual(choice)
  })

  it.each([undefined, null, 'text', {}, { names: 'Alan', active: 'first' }, { names: [] }])('gives nothing for %j', (payload) => {
    expect(readChoice(payload)).toBeUndefined()
  })
})

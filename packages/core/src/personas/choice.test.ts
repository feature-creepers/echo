import type { Persona } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { applyChoice, type Cast, checkChoice, readChoice } from './choice.ts'

const first: Persona = { id: 'first', name: 'ADA', stance: 'accommodating', accent: 'blue' }
const second: Persona = { id: 'second', name: 'GRACE', stance: 'critical', accent: 'red' }
const cast: Cast = { available: [first, second], active: 'first' }

describe('checkChoice', () => {
  it('accepts new names and puts them in the form they are kept in', () => {
    const check = checkChoice(cast, { names: [{ persona: 'second', name: '  Mary   Jane ' }], active: 'second' })
    expect(check).toEqual({ ok: true, choice: { names: [{ persona: 'second', name: 'MARY-JANE' }], active: 'second' } })
  })

  it('accepts a choice that names nobody', () => {
    expect(checkChoice(cast, { names: [], active: 'second' })).toEqual({ ok: true, choice: { names: [], active: 'second' } })
  })

  it('lets two personas swap names', () => {
    const check = checkChoice(cast, {
      names: [
        { persona: 'first', name: 'GRACE' },
        { persona: 'second', name: 'ADA' }
      ],
      active: 'first'
    })
    expect(check.ok).toBe(true)
  })

  it.each([
    ['a persona that does not exist', { names: [{ persona: 'third', name: 'ALAN' }], active: 'first' }, 'unknown-persona'],
    ['an active persona that does not exist', { names: [], active: 'third' }, 'unknown-persona'],
    ['a persona named twice', { names: [first, first].map((p) => ({ persona: p.id, name: 'ALAN' })), active: 'first' }, 'invalid-input'],
    ['an empty name', { names: [{ persona: 'first', name: '   ' }], active: 'first' }, 'invalid-name'],
    ['a name that cannot be said', { names: [{ persona: 'first', name: '<script>' }], active: 'first' }, 'invalid-name'],
    ['the name another persona keeps', { names: [{ persona: 'first', name: 'grace' }], active: 'first' }, 'name-taken'],
    [
      'the same name given to two personas',
      {
        names: [
          { persona: 'first', name: 'ALAN' },
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
    expect(applyChoice(cast, { names: [{ persona: 'second', name: 'MARVIN' }], active: 'second' })).toEqual({
      available: [first, { ...second, name: 'MARVIN' }],
      active: 'second'
    })
  })

  it('skips what it says about a persona that no longer exists', () => {
    expect(applyChoice(cast, { names: [{ persona: 'gone', name: 'ALAN' }], active: 'gone' })).toEqual(cast)
  })
})

describe('readChoice', () => {
  it('reads what was written', () => {
    const choice = { names: [{ persona: 'first', name: 'ALAN' }], active: 'first' }
    expect(readChoice(choice)).toEqual(choice)
  })

  it('puts a name an earlier version kept in the form names take now, and drops one with nothing left', () => {
    const earlier = {
      names: [
        { persona: 'first', name: 'Mary Jane' },
        { persona: 'second', name: '小爱' }
      ],
      active: 'second'
    }
    expect(readChoice(earlier)).toEqual({ names: [{ persona: 'first', name: 'MARY-JANE' }], active: 'second' })
  })

  it.each([undefined, null, 'text', {}, { names: 'ALAN', active: 'first' }, { names: [] }])('gives nothing for %j', (payload) => {
    expect(readChoice(payload)).toBeUndefined()
  })
})

import type { Persona } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { NO_EDITS, activeIn, choiceOf, nameIn, problemsOf } from './draft.ts'

const first: Persona = { id: 'first', name: 'Ada', stance: 'accommodating', accent: 'cyan' }
const second: Persona = { id: 'second', name: 'Grace', stance: 'critical', accent: 'red' }
const personas = [first, second]

describe('a draft with no edit', () => {
  it('shows the names the personas have and the one that answers', () => {
    expect(nameIn(NO_EDITS, first)).toBe('Ada')
    expect(activeIn(NO_EDITS, 'second')).toBe('second')
    expect(problemsOf(personas, NO_EDITS)).toEqual({})
  })

  it('is sent as a confirmation that renames nobody', () => {
    expect(choiceOf(personas, 'second', NO_EDITS)).toEqual({ names: [], active: 'second' })
  })

  it('follows a name changed elsewhere meanwhile', () => {
    expect(nameIn(NO_EDITS, { ...first, name: 'Alan' })).toBe('Alan')
  })
})

describe('a draft with edits', () => {
  it('shows what the user typed and picked', () => {
    const draft = { names: { second: 'Marv' }, active: 'second' }
    expect(nameIn(draft, first)).toBe('Ada')
    expect(nameIn(draft, second)).toBe('Marv')
    expect(activeIn(draft, 'first')).toBe('second')
  })

  it('is sent with the names typed, as typed, and no other: the core puts them in their kept form', () => {
    expect(choiceOf(personas, 'first', { names: { second: '  Marvin ' } })).toEqual({ names: [{ persona: 'second', name: '  Marvin ' }], active: 'first' })
  })

  it('does not send back the name of a persona the user left alone, even when it changed elsewhere', () => {
    const renamedElsewhere = [{ ...first, name: 'Alan' }, second]
    expect(choiceOf(renamedElsewhere, 'first', { names: { second: 'Marvin' } }).names).toEqual([{ persona: 'second', name: 'Marvin' }])
  })
})

describe('problemsOf', () => {
  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['x'.repeat(25), 'too-long'],
    ['<b>', 'characters']
  ])('tells the persona whose name is %j', (typed, problem) => {
    expect(problemsOf(personas, { names: { second: typed } })).toEqual({ second: problem })
  })

  it('tells the later of two personas that share a name, whatever the case', () => {
    expect(problemsOf(personas, { names: { first: 'Alan', second: ' alan ' } })).toEqual({ second: 'taken' })
  })

  it('counts the name a persona keeps as taken', () => {
    expect(problemsOf(personas, { names: { second: 'ada' } })).toEqual({ second: 'taken' })
  })

  it('lets two personas swap names', () => {
    expect(problemsOf(personas, { names: { first: 'Grace', second: 'Ada' } })).toEqual({})
  })

  it('reports every field that is wrong', () => {
    expect(problemsOf(personas, { names: { first: '', second: '🙂' } })).toEqual({ first: 'empty', second: 'characters' })
  })
})

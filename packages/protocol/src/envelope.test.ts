import { describe, expect, it } from 'vitest'
import { COMMANDS, isCommandName } from './commands.ts'
import { commandSchema, resultSchema } from './envelope.ts'
import { eventSchema } from './events.ts'
import type { Settings } from './settings.ts'

const settings: Settings = {
  revision: 3,
  personas: {
    available: [
      { id: 'one', name: 'Ada', stance: 'accommodating', accent: 'cyan' },
      { id: 'two', name: 'Grace', stance: 'critical', accent: 'red' }
    ],
    active: 'one',
    confirmed: true
  }
}

describe('commands', () => {
  it('reads a command whatever its input: the input is checked against the definition afterwards', () => {
    expect(commandSchema.safeParse({ type: 'command', id: 'c1', name: 'anything', input: { any: 'thing' } }).success).toBe(true)
    expect(commandSchema.safeParse({ type: 'command', id: '', name: 'settings.read', input: {} }).success).toBe(false)
    expect(commandSchema.safeParse({ type: 'command', name: 'settings.read', input: {} }).success).toBe(false)
  })

  it('knows its own names, and no inherited one', () => {
    expect(isCommandName('settings.read')).toBe(true)
    expect(isCommandName('personas.set')).toBe(true)
    expect(isCommandName('toString')).toBe(false)
    expect(isCommandName('settings.erase')).toBe(false)
  })

  it('takes names as typed, and leaves reading them to the core', () => {
    const input = { names: [{ persona: 'one', name: '  ada ' }], active: 'two' }
    expect(COMMANDS['personas.set'].input.parse(input)).toEqual(input)
    expect(COMMANDS['personas.set'].input.safeParse({ names: [], active: '' }).success).toBe(false)
    expect(COMMANDS['personas.set'].output.parse({ settings })).toEqual({ settings })
  })
})

describe('results', () => {
  it('is either an output or an error, never both', () => {
    expect(resultSchema.parse({ type: 'result', id: 'c1', ok: true, output: { settings } })).toMatchObject({ ok: true })
    expect(resultSchema.parse({ type: 'result', id: 'c1', ok: false, error: { code: 'name-taken', message: 'x' } })).toMatchObject({ ok: false })
    expect(resultSchema.safeParse({ type: 'result', id: 'c1', ok: false, error: { code: 'made-up', message: 'x' } }).success).toBe(false)
    expect(resultSchema.safeParse({ type: 'result', id: 'c1', ok: false }).success).toBe(false)
  })
})

describe('events', () => {
  it('reads the events it knows', () => {
    expect(eventSchema.parse({ type: 'event', name: 'settings.changed', settings })).toEqual({ type: 'event', name: 'settings.changed', settings })
  })

  it('does not read an event from a later version, which a client then ignores', () => {
    expect(eventSchema.safeParse({ type: 'event', name: 'something.new', data: 1 }).success).toBe(false)
  })
})

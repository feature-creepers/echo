import type { Persona, Settings } from '@repo/protocol'
import { describe, expect, it, vi } from 'vitest'
import { PERSONAS_SET } from '../personas/choice.ts'
import { memoryRecords } from '../records/memory.ts'
import { createUserSettings } from './settings.ts'

const first: Persona = { id: 'first', name: 'Ada', stance: 'accommodating', accent: 'cyan' }
const second: Persona = { id: 'second', name: 'Grace', stance: 'critical', accent: 'red' }
const defaults: readonly [Persona, ...Persona[]] = [first, second]

describe('the settings of a new user', () => {
  it('are the defaults, with the first persona answering, not yet confirmed', () => {
    const settings = createUserSettings(memoryRecords(), defaults)
    expect(settings.read()).toEqual({ revision: 0, personas: { available: [first, second], active: 'first', confirmed: false } })
  })
})

describe('setPersonas', () => {
  it('confirms the defaults when the user keeps them', () => {
    const records = memoryRecords()
    const settings = createUserSettings(records, defaults)

    const change = settings.setPersonas({ names: [], active: 'first' })

    expect(change).toEqual({ ok: true, settings: { revision: 1, personas: { available: [first, second], active: 'first', confirmed: true } } })
    expect(records.read([PERSONAS_SET])).toHaveLength(1)
  })

  it('renames, switches and tells the listeners', () => {
    const settings = createUserSettings(memoryRecords(), defaults)
    const heard = vi.fn<(settings: Settings) => void>()
    settings.onChange(heard)

    settings.setPersonas({ names: [{ persona: 'second', name: ' Marvin ' }], active: 'second' })

    const expected: Settings = { revision: 1, personas: { available: [first, { ...second, name: 'Marvin' }], active: 'second', confirmed: true } }
    expect(settings.read()).toEqual(expected)
    expect(heard).toHaveBeenCalledExactlyOnceWith(expected)
  })

  it('changes nothing, writes nothing and tells nobody when the choice is refused', () => {
    const records = memoryRecords()
    const settings = createUserSettings(records, defaults)
    const heard = vi.fn()
    settings.onChange(heard)

    const change = settings.setPersonas({ names: [{ persona: 'first', name: 'grace' }], active: 'first' })

    expect(change).toMatchObject({ ok: false, error: { code: 'name-taken' } })
    expect(settings.read().revision).toBe(0)
    expect(records.read([PERSONAS_SET])).toEqual([])
    expect(heard).not.toHaveBeenCalled()
  })

  it('writes nothing when a confirmed choice is repeated', () => {
    const records = memoryRecords()
    const settings = createUserSettings(records, defaults)
    settings.setPersonas({ names: [{ persona: 'first', name: 'Alan' }], active: 'first' })
    const heard = vi.fn()
    settings.onChange(heard)

    const again = settings.setPersonas({ names: [{ persona: 'first', name: 'Alan' }], active: 'first' })

    expect(again).toMatchObject({ ok: true, settings: { revision: 1 } })
    expect(records.read([PERSONAS_SET])).toHaveLength(1)
    expect(heard).not.toHaveBeenCalled()
  })

  it('stops telling a listener that asked to stop', () => {
    const settings = createUserSettings(memoryRecords(), defaults)
    const heard = vi.fn()
    const stop = settings.onChange(heard)
    stop()

    settings.setPersonas({ names: [], active: 'second' })

    expect(heard).not.toHaveBeenCalled()
  })
})

describe('settings read back from the records', () => {
  it('are what the user left', () => {
    const records = memoryRecords()
    const before = createUserSettings(records, defaults)
    before.setPersonas({ names: [{ persona: 'first', name: 'Alan' }], active: 'first' })
    before.setPersonas({ names: [{ persona: 'second', name: 'Marvin' }], active: 'second' })

    const after = createUserSettings(records, defaults)

    expect(after.read()).toEqual(before.read())
    expect(after.read()).toMatchObject({ revision: 2, personas: { active: 'second', confirmed: true } })
    expect(after.read().personas.available.map((persona) => persona.name)).toEqual(['Alan', 'Marvin'])
  })

  it('give a persona the user never renamed its default name, even when that default changed since', () => {
    const records = memoryRecords()
    createUserSettings(records, defaults).setPersonas({ names: [{ persona: 'first', name: 'Alan' }], active: 'first' })

    const later = createUserSettings(records, [first, { ...second, name: 'Hopper' }])

    expect(later.read().personas.available.map((persona) => persona.name)).toEqual(['Alan', 'Hopper'])
  })

  it('skip a record this version cannot read', () => {
    const records = memoryRecords()
    records.append([
      { type: PERSONAS_SET, payload: { from: 'another version' } },
      { type: PERSONAS_SET, payload: { names: [{ persona: 'gone', name: 'Alan' }], active: 'second' } }
    ])

    const settings = createUserSettings(records, defaults)

    expect(settings.read()).toEqual({ revision: 1, personas: { available: [first, second], active: 'second', confirmed: true } })
  })
})

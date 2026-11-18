import { DEFAULT_ACCESS, DEFAULT_LANGUAGES, type Persona, type Settings } from '@repo/protocol'
import { describe, expect, it, vi } from 'vitest'
import { PERSONAS_SET } from '../personas/choice.ts'
import { memoryRecords } from '../records/memory.ts'
import { createUserSettings, ENGINES_MODEL, ENGINES_PREFERRED } from './settings.ts'

const first: Persona = { id: 'first', name: 'Ada', stance: 'accommodating', accent: 'cyan', look: 'hud' }
const second: Persona = { id: 'second', name: 'Grace', stance: 'critical', accent: 'red', look: 'lens' }
const defaults: readonly [Persona, ...Persona[]] = [first, second]

describe('the settings of a new user', () => {
  it('are the defaults, with the first persona answering, not yet confirmed', () => {
    const settings = createUserSettings(memoryRecords(), defaults)
    expect(settings.read()).toEqual({
      revision: 0,
      personas: { available: [first, second], active: 'first', confirmed: false },
      engines: { models: {} },
      access: DEFAULT_ACCESS,
      languages: DEFAULT_LANGUAGES
    })
  })
})

describe('setPersonas', () => {
  it('confirms the defaults when the user keeps them', () => {
    const records = memoryRecords()
    const settings = createUserSettings(records, defaults)

    const change = settings.setPersonas({ names: [], active: 'first' })

    expect(change).toEqual({
      ok: true,
      settings: {
        revision: 1,
        personas: { available: [first, second], active: 'first', confirmed: true },
        engines: { models: {} },
        access: DEFAULT_ACCESS,
        languages: DEFAULT_LANGUAGES
      }
    })
    expect(records.read([PERSONAS_SET])).toHaveLength(1)
  })

  it('renames, switches and tells the listeners', () => {
    const settings = createUserSettings(memoryRecords(), defaults)
    const heard = vi.fn<(settings: Settings) => void>()
    settings.onChange(heard)

    settings.setPersonas({ names: [{ persona: 'second', name: ' Marvin ' }], active: 'second' })

    const expected: Settings = {
      revision: 1,
      personas: { available: [first, { ...second, name: 'Marvin' }], active: 'second', confirmed: true },
      engines: { models: {} },
      access: DEFAULT_ACCESS,
      languages: DEFAULT_LANGUAGES
    }
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

    expect(settings.read()).toEqual({
      revision: 1,
      personas: { available: [first, second], active: 'second', confirmed: true },
      engines: { models: {} },
      access: DEFAULT_ACCESS,
      languages: DEFAULT_LANGUAGES
    })
  })
})

describe('the engines the user chose', () => {
  it('are none at first: the first harness ready, on its default model', () => {
    expect(createUserSettings(memoryRecords(), defaults).read().engines).toEqual({ models: {} })
  })

  it('keep the harness preferred and the model of each, tell the listeners, and read back the same', () => {
    const records = memoryRecords()
    const settings = createUserSettings(records, defaults)
    const heard = vi.fn()
    settings.onChange(heard)

    settings.prefer('codex')
    settings.chooseModel('claude-code', 'opus')
    settings.chooseModel('codex', 'gpt-6.1-sol')

    expect(settings.read()).toMatchObject({ revision: 3, engines: { preferred: 'codex', models: { 'claude-code': 'opus', codex: 'gpt-6.1-sol' } } })
    expect(heard).toHaveBeenCalledTimes(3)
    expect(createUserSettings(records, defaults).read()).toEqual(settings.read())
  })

  it('go back to the defaults, leaving no trace of the earlier choice', () => {
    const records = memoryRecords()
    const settings = createUserSettings(records, defaults)
    settings.prefer('codex')
    settings.chooseModel('claude-code', 'opus')

    settings.prefer(null)
    settings.chooseModel('claude-code', null)

    expect(settings.read().engines).toEqual({ models: {} })
    expect(createUserSettings(records, defaults).read().engines).toEqual({ models: {} })
  })

  it('write nothing and tell nobody when the choice is the one already made', () => {
    const records = memoryRecords()
    const settings = createUserSettings(records, defaults)
    settings.chooseModel('claude-code', 'sonnet')
    const heard = vi.fn()
    settings.onChange(heard)

    settings.chooseModel('claude-code', 'sonnet')
    settings.prefer(null)

    expect(heard).not.toHaveBeenCalled()
    expect(records.read([ENGINES_MODEL, ENGINES_PREFERRED])).toHaveLength(1)
  })

  it('keep the personas when the engines change, and the engines when the personas do', () => {
    const settings = createUserSettings(memoryRecords(), defaults)
    settings.chooseModel('claude-code', 'opus')
    settings.setPersonas({ names: [{ persona: 'first', name: 'Alan' }], active: 'second' })

    expect(settings.read()).toMatchObject({ personas: { active: 'second' }, engines: { models: { 'claude-code': 'opus' } } })
  })

  it('skip an engine record this version cannot read', () => {
    const records = memoryRecords()
    records.append([
      { type: ENGINES_MODEL, payload: { harness: 'claude-code' } },
      { type: ENGINES_PREFERRED, payload: { harness: 7 } },
      { type: ENGINES_MODEL, payload: { harness: 'codex', model: 'gpt-6-luna' } }
    ])

    expect(createUserSettings(records, defaults).read().engines).toEqual({ models: { codex: 'gpt-6-luna' } })
  })
})

describe('the languages the user set', () => {
  it('are found from what is said, and answered in, at first', () => {
    expect(createUserSettings(memoryRecords(), defaults).read().languages).toEqual({ spoken: 'auto', answers: 'spoken' })
  })

  it('keep what was left out, write nothing when unchanged, and read back the same', () => {
    const records = memoryRecords()
    const settings = createUserSettings(records, defaults)
    const heard = vi.fn()
    settings.onChange(heard)

    settings.setLanguages({ spoken: 'fr' })
    settings.setLanguages({ answers: 'en' })
    settings.setLanguages({ spoken: 'fr', answers: undefined })

    expect(settings.read().languages).toEqual({ spoken: 'fr', answers: 'en' })
    expect(heard).toHaveBeenCalledTimes(2)
    expect(createUserSettings(records, defaults).read()).toEqual(settings.read())
  })
})
